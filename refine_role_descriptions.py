"""
Refine job role descriptions via OpenAI (or compatible) chat completions.

Reads final_roles.json, improves non-empty descriptions, writes final_roles_refined.json.
Does not overwrite the input file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI, RateLimitError, APIError, APIConnectionError
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Environment (.env)
# ---------------------------------------------------------------------------


def _parse_env_line(line: str) -> Optional[Tuple[str, str]]:
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    if line.startswith("export "):
        line = line[7:].strip()
    if "=" not in line:
        return None
    key, _, val = line.partition("=")
    key, val = key.strip(), val.strip()
    if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
        val = val[1:-1]
    return key, val


def bootstrap_env_from_dotenv() -> None:
    """Load OPENAI_* from .env if the real environment does not set them yet."""
    script_dir = Path(__file__).resolve().parent
    for base in (script_dir, Path.cwd()):
        path = base / ".env"
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for raw in text.splitlines():
            parsed = _parse_env_line(raw)
            if not parsed:
                continue
            key, val = parsed
            if not val:
                continue
            if key == "OPENAI_API_KEY" and not os.environ.get("OPENAI_API_KEY"):
                os.environ["OPENAI_API_KEY"] = val
            elif key == "OPENAI_BASE_URL" and not os.environ.get("OPENAI_BASE_URL"):
                os.environ["OPENAI_BASE_URL"] = val
            elif key == "OPENAI_MODEL" and not os.environ.get("OPENAI_MODEL"):
                os.environ["OPENAI_MODEL"] = val
        if os.environ.get("OPENAI_API_KEY"):
            return


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are an expert career writer and job profile designer. You transform raw occupational "
    "text into one clear, engaging, human-readable role description. The goal is not mechanical "
    "summarization: readers should understand what the job feels like, get a realistic picture "
    "of day-to-day work, and find the role tangible and appealing—without inventing or distorting facts."
)

USER_PROMPT_TEMPLATE = """You will receive one or more raw descriptions of the same role. They may be redundant, poorly written, inconsistent, or partially mismatched.

Your task: produce a single final role description as plain text only (no headings, bullets, labels, or meta commentary).

---

PHASE 1 — UNDERSTAND THE ROLE
- Infer the core purpose of the role from the source text only.
- Note main activities, responsibilities, and typical work environment (industry/setting) only if supported by the source.
- Note what distinguishes this role from near neighbors only when the source makes that clear.

PHASE 2 — SYNTHESIZE (do not copy phrases blindly)
- Merge overlapping content; remove redundancy; resolve inconsistencies.
- Drop content that clearly does not belong to this role.
- Group related responsibilities into clear themes in flowing prose (not lists).

PHASE 3 — WRITE THE DESCRIPTION

Structure (use paragraphs only; no bullet points):

1) Opening (2–3 sentences): what the role is, its core purpose, and why it matters—to the extent the source supports this.

2) One or two paragraphs: what people in this role actually do day-to-day; how they work with others; what problems they tackle; how work typically unfolds. Be concrete and tangible (e.g. prefer explaining how and with whom over vague “ensures execution”).

3) One short paragraph: contexts or environments where this role exists, and how it may vary by context—only if the source implies this.

4) Closing paragraph: what kind of person often enjoys this work and what makes the role interesting or distinctive—grounded in the source, not generic fluff.

---

STYLE
- Clear, natural, professional English.
- No bullet points, no numbered lists in the output.
- Avoid empty phrases (“various tasks”, “responsible for multiple duties”), vague claims, and saying the same idea twice in different words.
- Balance clarity, realism, and inspiration.
- Do NOT invent responsibilities, skills, tools, certifications, or requirements.
- Do NOT add details unless clearly implied or stated in the source.
- Preserve domain-specific facts and specificity from the source.

LENGTH: Aim for roughly 900–3200 characters. Stay within 4000 characters total.

---

Job title:
{title}

Raw description(s) to merge and transform:
{description}

Return only the final improved role description."""

# Bumped when prompt strategy changes (invalidates LLM cache entries).
PROMPT_VERSION = "v2-career-writer"

MIN_OUTPUT_LEN = 250
MAX_OUTPUT_LEN = 4000


# ---------------------------------------------------------------------------
# Data I/O
# ---------------------------------------------------------------------------


def load_data(path: Path) -> List[Dict[str, Any]]:
    """Load roles from JSON. Returns the full list (order preserved).

    Roles with empty ``description`` are kept as-is and are not sent to the LLM.
    """
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("Expected a JSON array of role objects")
    return data


def save_output(path: Path, roles: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(roles, f, indent=2, ensure_ascii=False)


def _role_key(role: Dict[str, Any], index: int) -> str:
    rid = role.get("id")
    if isinstance(rid, str) and rid.strip():
        return rid
    return f"__index_{index}"


def _cache_key(title: str, description: str) -> str:
    payload = f"{PROMPT_VERSION}\x00{title.strip()}\x00{description.strip()}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _load_cache(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_cache(path: Path, cache: Dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def _load_resume_map(output_path: Path) -> Dict[str, Dict[str, Any]]:
    """Map role key -> refined role dict from existing output (for --resume)."""
    if not output_path.exists():
        return {}
    try:
        with output_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, list):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for i, role in enumerate(data):
        if not isinstance(role, dict):
            continue
        if "description_original" not in role:
            continue
        k = _role_key(role, i)
        out[k] = role
    return out


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_output(text: str) -> bool:
    if not text or not text.strip():
        return False
    t = text.strip()
    if len(t) < MIN_OUTPUT_LEN:
        return False
    if len(t) > MAX_OUTPUT_LEN:
        return False
    return True


# ---------------------------------------------------------------------------
# LLM
# ---------------------------------------------------------------------------


class RateLimiter:
    """Simple thread-safe minimum spacing between calls."""

    def __init__(self, min_interval_sec: float) -> None:
        self._min_interval = max(0.0, min_interval_sec)
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        if self._min_interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            elapsed = now - self._last
            need = self._min_interval - elapsed
            if need > 0:
                time.sleep(need)
            self._last = time.monotonic()


def call_llm(
    client: OpenAI,
    model: str,
    title: str,
    description: str,
    *,
    max_retries: int = 6,
    base_delay_sec: float = 1.0,
    max_delay_sec: float = 60.0,
    rate_limiter: Optional[RateLimiter] = None,
    use_seed: bool = True,
) -> str:
    user_content = USER_PROMPT_TEMPLATE.format(title=title, description=description)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    last_err: Optional[Exception] = None
    for attempt in range(max_retries):
        if rate_limiter:
            rate_limiter.wait()
        try:
            kwargs: Dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": 0,
            }
            if use_seed:
                kwargs["seed"] = 42
            try:
                resp = client.chat.completions.create(**kwargs)
            except TypeError:
                kwargs.pop("seed", None)
                resp = client.chat.completions.create(**kwargs)
            except APIError as e:
                code = getattr(e, "status_code", None)
                if use_seed and code in (400, 422) and "seed" in kwargs:
                    kwargs.pop("seed", None)
                    resp = client.chat.completions.create(**kwargs)
                else:
                    raise
            choice = resp.choices[0]
            content = (choice.message.content or "").strip()
            return content
        except RateLimitError as e:
            last_err = e
        except APIConnectionError as e:
            last_err = e
        except APIError as e:
            # Retry only likely-transient errors
            code = getattr(e, "status_code", None)
            if code is not None and code >= 500:
                last_err = e
            else:
                raise

        delay = min(max_delay_sec, base_delay_sec * (2**attempt))
        delay *= 0.8 + 0.4 * random.random()
        time.sleep(delay)

    if last_err:
        raise last_err
    raise RuntimeError("call_llm failed without specific error")


def refine_description(
    client: OpenAI,
    model: str,
    title: str,
    description: str,
    *,
    cache: Optional[Dict[str, str]] = None,
    use_cache: bool = True,
    rate_limiter: Optional[RateLimiter] = None,
    cache_lock: Optional[threading.Lock] = None,
    use_seed: bool = True,
) -> Tuple[str, bool]:
    """
    Returns (final_text, used_llm). If cache hit, used_llm is False.
    """
    desc = (description or "").strip()
    if not desc:
        return "", False

    ck = _cache_key(title or "", desc)
    if use_cache and cache is not None:
        if cache_lock:
            with cache_lock:
                hit = cache.get(ck)
        else:
            hit = cache.get(ck)
        if hit is not None:
            cached = hit.strip()
            if validate_output(cached):
                return cached, False

    raw = call_llm(
        client,
        model,
        title or "",
        desc,
        rate_limiter=rate_limiter,
        use_seed=use_seed,
    )
    if use_cache and cache is not None and validate_output(raw):
        if cache_lock:
            with cache_lock:
                cache[ck] = raw
        else:
            cache[ck] = raw
    return raw, True


# ---------------------------------------------------------------------------
# Human review
# ---------------------------------------------------------------------------


def review_loop(title: str, original: str, improved: str) -> str:
    print("\n" + "=" * 80)
    print(f"Title: {title}")
    print("-" * 80)
    print("ORIGINAL:")
    print(original)
    print("-" * 80)
    print("IMPROVED:")
    print(improved)
    print("-" * 80)

    while True:
        choice = input("Accept improved version? (y/n/edit): ").strip().lower()
        if choice == "y":
            return improved
        if choice == "n":
            return original
        if choice == "edit":
            print("Enter replacement description (end with EOF on empty line is not used); single line:")
            line = input("> ").strip()
            return line if line else original
        print("Please enter y, n, or edit.")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _apply_refinement(
    role: Dict[str, Any],
    original_description: str,
    improved: str,
    validated: bool,
) -> None:
    role["description_original"] = original_description
    role["description"] = improved if validated else original_description


def run_pipeline(args: argparse.Namespace) -> None:
    input_path = Path(args.input)
    output_path = Path(args.output)
    cache_path = Path(args.cache_path) if args.cache_path else output_path.with_suffix(".llm_cache.json")

    roles = load_data(input_path)
    resume_map = _load_resume_map(output_path) if args.resume else {}
    cache: Dict[str, str] = {} if args.no_cache else _load_cache(cache_path)

    client: Optional[OpenAI] = None
    if not args.dry_run:
        if not os.environ.get("OPENAI_API_KEY"):
            raise SystemExit(
                "OPENAI_API_KEY is not set.\n"
                "  • PowerShell (current session):  $env:OPENAI_API_KEY = 'sk-...'\n"
                "  • Or add OPENAI_API_KEY=sk-... to a .env file in this folder or the script folder.\n"
                "  • Or use --dry-run to test without API calls."
            )
        client = OpenAI(
            api_key=os.environ.get("OPENAI_API_KEY"),
            base_url=args.base_url or os.environ.get("OPENAI_BASE_URL") or None,
        )

    stats = {
        "processed": 0,
        "improved": 0,
        "fallback": 0,
        "skipped_empty": 0,
        "resumed": 0,
        "cache_hits": 0,
    }

    # Deterministic refinement order: stable sort by role key (id or index)
    indexed: List[Tuple[int, Dict[str, Any], str, str]] = []
    for i, role in enumerate(roles):
        desc = (role.get("description") or "").strip()
        if not desc:
            stats["skipped_empty"] += 1
            continue
        indexed.append((i, role, (role.get("title") or "").strip(), desc))

    indexed.sort(key=lambda x: _role_key(x[1], x[0]))

    # Apply resume: overlay saved descriptions onto current rows (preserves new input fields)
    if args.resume and resume_map:
        for i, role, title, desc in indexed:
            key = _role_key(role, i)
            if key in resume_map:
                prev = resume_map[key]
                if "description_original" in prev:
                    role["description_original"] = prev["description_original"]
                    role["description"] = prev.get("description", role.get("description", ""))
                stats["resumed"] += 1

    to_run = [
        (i, role, title, desc)
        for (i, role, title, desc) in indexed
        if "description_original" not in role
    ]

    rate_limiter = RateLimiter(args.min_interval_sec)
    model = args.model
    cache_lock = threading.Lock() if args.max_concurrent > 1 and not args.review else None

    def process_one(idx: int, role: Dict[str, Any], title: str, desc: str) -> Dict[str, int]:
        ns = {"improved": 0, "fallback": 0, "cache_hit": 0}

        if args.dry_run:
            _apply_refinement(role, desc, desc, True)
            return ns

        assert client is not None
        try:
            text, used_llm = refine_description(
                client,
                model,
                title,
                desc,
                cache=cache,
                use_cache=not args.no_cache,
                rate_limiter=rate_limiter,
                cache_lock=cache_lock,
                use_seed=not args.no_seed,
            )
            if not used_llm:
                ns["cache_hit"] = 1
        except Exception:
            _apply_refinement(role, desc, desc, False)
            ns["fallback"] = 1
            return ns

        ok = validate_output(text)
        final_text = text if ok else desc
        if args.review and ok:
            final_text = review_loop(title, desc, text)
            ok = validate_output(final_text) or final_text == desc

        _apply_refinement(role, desc, final_text, ok)
        if ok and final_text != desc:
            ns["improved"] = 1
        else:
            ns["fallback"] = 1

        return ns

    if args.review:
        for i, role, title, desc in tqdm(to_run, desc="Refining (review)", unit="role"):
            stats["processed"] += 1
            ns = process_one(i, role, title, desc)
            stats["improved"] += ns["improved"]
            stats["fallback"] += ns["fallback"]
            stats["cache_hits"] += ns["cache_hit"]
            if not args.no_cache:
                _save_cache(cache_path, cache)
            save_output(output_path, roles)
    elif args.max_concurrent <= 1 or args.dry_run:
        for i, role, title, desc in tqdm(to_run, desc="Refining", unit="role"):
            stats["processed"] += 1
            ns = process_one(i, role, title, desc)
            stats["improved"] += ns["improved"]
            stats["fallback"] += ns["fallback"]
            stats["cache_hits"] += ns["cache_hit"]
            if not args.no_cache and stats["processed"] % args.cache_save_every == 0:
                _save_cache(cache_path, cache)
            if args.incremental_save and stats["processed"] % args.save_every == 0:
                save_output(output_path, roles)
    else:
        # Parallel workers; shared rate limiter serializes spacing; cache writes use cache_lock inside refine_description
        lock = threading.Lock()
        done_count = [0]

        def worker(item: Tuple[int, Dict[str, Any], str, str]) -> Tuple[int, int, int]:
            i, role, title, desc = item
            ns = process_one(i, role, title, desc)
            imp, fb, ch = ns["improved"], ns["fallback"], ns["cache_hit"]
            with lock:
                done_count[0] += 1
                n = done_count[0]
                if not args.no_cache and n % args.cache_save_every == 0:
                    _save_cache(cache_path, cache)
                if args.incremental_save and n % args.save_every == 0:
                    save_output(output_path, roles)
            return imp, fb, ch

        with ThreadPoolExecutor(max_workers=args.max_concurrent) as ex:
            futures = {ex.submit(worker, item): item for item in to_run}
            with tqdm(total=len(to_run), desc="Refining", unit="role") as pbar:
                while futures:
                    done, _ = wait(futures.keys(), return_when=FIRST_COMPLETED, timeout=3600)
                    for fut in done:
                        futures.pop(fut, None)
                        try:
                            imp, fb, ch = fut.result()
                        except Exception:
                            imp, fb, ch = 0, 1, 0
                        stats["processed"] += 1
                        stats["improved"] += imp
                        stats["fallback"] += fb
                        stats["cache_hits"] += ch
                        pbar.update(1)

    if not args.no_cache:
        _save_cache(cache_path, cache)
    save_output(output_path, roles)

    print("\n--- Summary ---")
    print(f"Total roles in file: {len(roles)}")
    print(f"Skipped (empty description): {stats['skipped_empty']}")
    print(f"Restored from resume: {stats['resumed']}")
    print(f"Processed (LLM path): {stats['processed']}")
    print(f"Improved descriptions accepted: {stats['improved']}")
    print(f"Fallbacks (original kept): {stats['fallback']}")
    print(f"Cache hits: {stats['cache_hits']}")
    if args.dry_run:
        print("(Dry-run: API skipped; description_original added, description unchanged.)")
    print(f"Output written to: {output_path}")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Refine job role descriptions with an LLM.")
    p.add_argument(
        "--input",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\final_roles.json"),
    )
    p.add_argument(
        "--output",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\final_roles_refined.json"),
    )
    p.add_argument("--model", type=str, default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"))
    p.add_argument(
        "--base-url",
        type=str,
        default=None,
        help="OpenAI-compatible API base URL (or set OPENAI_BASE_URL).",
    )
    p.add_argument("--review", action="store_true", help="Human-in-the-loop after each refinement.")
    p.add_argument("--dry-run", action="store_true", help="Skip API calls; keep original descriptions.")
    p.add_argument(
        "--no-seed",
        action="store_true",
        help="Do not pass seed=42 (for OpenAI-compatible servers that reject it).",
    )
    p.add_argument("--max-concurrent", type=int, default=4, help="Parallel API calls (ignored with --review).")
    p.add_argument(
        "--min-interval-sec",
        type=float,
        default=0.0,
        help="Minimum seconds between API calls per worker (rate limiting).",
    )
    p.add_argument("--resume", action="store_true", help="Skip roles already present in output with description_original.")
    p.add_argument("--no-cache", action="store_true", help="Disable LLM response cache.")
    p.add_argument(
        "--cache-path",
        type=Path,
        default=None,
        help="Path for cache JSON (default: alongside output with .llm_cache.json).",
    )
    p.add_argument("--incremental-save", action="store_true", help="Save output periodically during run.")
    p.add_argument("--save-every", type=int, default=25, help="With --incremental-save, save every N roles.")
    p.add_argument("--cache-save-every", type=int, default=10, help="Flush cache to disk every N roles (sequential mode).")
    return p


def main() -> None:
    bootstrap_env_from_dotenv()
    args = build_arg_parser().parse_args()
    if args.review and args.max_concurrent > 1:
        print("Note: --review forces sequential processing (ignoring --max-concurrent > 1).")
    run_pipeline(args)


if __name__ == "__main__":
    main()
