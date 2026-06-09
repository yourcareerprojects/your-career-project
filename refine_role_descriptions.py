"""
Refine job role descriptions via OpenAI (or compatible) chat completions.

Sources:
  - json (default): reads a JSON array of roles, writes a refined output file.
  - mongo: reads CareerPath documents from MongoDB and updates description.en in place.

Does not overwrite JSON input files.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import random
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI, RateLimitError, APIError, APIConnectionError
from tqdm import tqdm

DEFAULT_MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/career-path-explorer")
DEFAULT_MONGO_DB = os.environ.get("MONGODB_DB", "career-path-explorer")
DEFAULT_MONGO_COLLECTION = "careerpaths"

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
            elif key == "MONGODB_URI" and not os.environ.get("MONGODB_URI"):
                os.environ["MONGODB_URI"] = val
            elif key == "MONGODB_DB" and not os.environ.get("MONGODB_DB"):
                os.environ["MONGODB_DB"] = val
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


def _require_pymongo() -> Any:
    try:
        import pymongo  # type: ignore

        return pymongo
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "pymongo is required for --source mongo. Install with: pip install pymongo"
        ) from exc


def _parse_mongo_db_from_uri(mongo_uri: str) -> Optional[str]:
    match = re.search(r"/([^/?]+)(?:\?|$)", mongo_uri)
    return match.group(1) if match else None


def get_localized_en(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict) and value.get("en") is not None:
        return str(value["en"]).strip()
    return ""


def get_localized_de(value: Any) -> Optional[str]:
    if not isinstance(value, dict):
        return None
    de = value.get("de")
    if de is None or de == "":
        return None
    return str(de).strip()


def load_esco_ids_from_file(path: Path) -> List[str]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and isinstance(data.get("roles"), list):
        roles = data["roles"]
    elif isinstance(data, list):
        roles = data
    else:
        raise ValueError("Expected a JSON array or an object with a 'roles' array")

    esco_ids: List[str] = []
    for role in roles:
        if not isinstance(role, dict):
            continue
        esco_id = role.get("escoId") or role.get("id") or role.get("esco_id")
        if esco_id and str(esco_id).strip():
            esco_ids.append(str(esco_id).strip())
    if not esco_ids:
        raise ValueError(f"No escoId values found in {path}")
    return esco_ids


def load_roles_from_mongo(
    *,
    mongo_uri: str,
    mongo_db: Optional[str],
    collection_name: str,
    query: Dict[str, Any],
    max_en_len: int,
    resume_min_en_len: int,
    resume: bool,
    limit: int,
) -> Tuple[Any, Any, List[Dict[str, Any]], Dict[str, int]]:
    pymongo = _require_pymongo()
    db_name = mongo_db or _parse_mongo_db_from_uri(mongo_uri) or DEFAULT_MONGO_DB
    client = pymongo.MongoClient(mongo_uri)
    collection = client[db_name][collection_name]

    projection = {
        "_id": 1,
        "escoId": 1,
        "title": 1,
        "description": 1,
    }
    cursor = collection.find(query, projection).sort("escoId", 1)
    if limit > 0:
        cursor = cursor.limit(limit)

    roles: List[Dict[str, Any]] = []
    stats = {
        "matched": 0,
        "skipped_empty": 0,
        "skipped_too_long": 0,
        "skipped_resume": 0,
    }

    for doc in cursor:
        stats["matched"] += 1
        esco_id = str(doc.get("escoId") or "").strip()
        if not esco_id:
            continue

        desc_en = get_localized_en(doc.get("description"))
        if not desc_en:
            stats["skipped_empty"] += 1
            continue

        if max_en_len > 0 and len(desc_en) > max_en_len:
            stats["skipped_too_long"] += 1
            continue

        if resume and resume_min_en_len > 0 and len(desc_en) >= resume_min_en_len:
            stats["skipped_resume"] += 1
            continue

        roles.append(
            {
                "escoId": esco_id,
                "_mongo_id": doc["_id"],
                "title": get_localized_en(doc.get("title")),
                "description": desc_en,
                "description_de": get_localized_de(doc.get("description")),
            }
        )

    return client, collection, roles, stats


def persist_role_description(
    collection: Any,
    role: Dict[str, Any],
    refined_en: str,
    *,
    clear_de: bool,
    dry_run: bool,
) -> bool:
    if dry_run:
        return True

    existing_de = role.get("description_de")
    description = {
        "en": refined_en,
        "de": None if clear_de else existing_de,
    }
    result = collection.update_one(
        {"escoId": role["escoId"]},
        {
            "$set": {
                "description": description,
                "lastUpdated": dt.datetime.now(dt.timezone.utc),
            }
        },
    )
    return result.matched_count > 0


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
    for field in ("escoId", "id"):
        rid = role.get(field)
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


def _build_openai_client(args: argparse.Namespace) -> Optional[OpenAI]:
    if args.dry_run:
        return None
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit(
            "OPENAI_API_KEY is not set.\n"
            "  • PowerShell (current session):  $env:OPENAI_API_KEY = 'sk-...'\n"
            "  • Or add OPENAI_API_KEY=sk-... to a .env file in this folder or the script folder.\n"
            "  • Or use --dry-run to test without API calls."
        )
    return OpenAI(
        api_key=os.environ.get("OPENAI_API_KEY"),
        base_url=args.base_url or os.environ.get("OPENAI_BASE_URL") or None,
    )


def _refine_roles(
    args: argparse.Namespace,
    roles: List[Dict[str, Any]],
    *,
    client: Optional[OpenAI],
    cache: Dict[str, str],
    cache_path: Path,
    on_role_done: Optional[Any] = None,
) -> Dict[str, int]:
    stats = {
        "processed": 0,
        "improved": 0,
        "fallback": 0,
        "skipped_empty": 0,
        "resumed": 0,
        "cache_hits": 0,
        "db_updated": 0,
    }

    indexed: List[Tuple[int, Dict[str, Any], str, str]] = []
    for i, role in enumerate(roles):
        desc = (role.get("description") or "").strip()
        if not desc:
            stats["skipped_empty"] += 1
            continue
        indexed.append((i, role, (role.get("title") or "").strip(), desc))

    indexed.sort(key=lambda x: _role_key(x[1], x[0]))
    to_run = [
        (i, role, title, desc)
        for (i, role, title, desc) in indexed
        if "description_original" not in role
    ]

    rate_limiter = RateLimiter(args.min_interval_sec)
    model = args.model
    cache_lock = threading.Lock() if args.max_concurrent > 1 and not args.review else None

    def process_one(idx: int, role: Dict[str, Any], title: str, desc: str) -> Dict[str, int]:
        ns = {"improved": 0, "fallback": 0, "cache_hit": 0, "db_updated": 0}

        if args.dry_run:
            _apply_refinement(role, desc, desc, True)
            if on_role_done is not None:
                ns["db_updated"] = 1 if on_role_done(role, desc, desc, True) else 0
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
            if on_role_done is not None:
                on_role_done(role, desc, desc, False)
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

        if on_role_done is not None:
            ns["db_updated"] = 1 if on_role_done(role, desc, final_text, ok) else 0

        return ns

    if args.review:
        for i, role, title, desc in tqdm(to_run, desc="Refining (review)", unit="role"):
            stats["processed"] += 1
            ns = process_one(i, role, title, desc)
            stats["improved"] += ns["improved"]
            stats["fallback"] += ns["fallback"]
            stats["cache_hits"] += ns["cache_hit"]
            stats["db_updated"] += ns["db_updated"]
            if not args.no_cache:
                _save_cache(cache_path, cache)
    elif args.max_concurrent <= 1 or args.dry_run:
        for i, role, title, desc in tqdm(to_run, desc="Refining", unit="role"):
            stats["processed"] += 1
            ns = process_one(i, role, title, desc)
            stats["improved"] += ns["improved"]
            stats["fallback"] += ns["fallback"]
            stats["cache_hits"] += ns["cache_hit"]
            stats["db_updated"] += ns["db_updated"]
            if not args.no_cache and stats["processed"] % args.cache_save_every == 0:
                _save_cache(cache_path, cache)
    else:
        lock = threading.Lock()
        done_count = [0]

        def worker(item: Tuple[int, Dict[str, Any], str, str]) -> Tuple[int, int, int, int]:
            i, role, title, desc = item
            ns = process_one(i, role, title, desc)
            imp, fb, ch, db = ns["improved"], ns["fallback"], ns["cache_hit"], ns["db_updated"]
            with lock:
                done_count[0] += 1
                n = done_count[0]
                if not args.no_cache and n % args.cache_save_every == 0:
                    _save_cache(cache_path, cache)
            return imp, fb, ch, db

        with ThreadPoolExecutor(max_workers=args.max_concurrent) as ex:
            futures = {ex.submit(worker, item): item for item in to_run}
            with tqdm(total=len(to_run), desc="Refining", unit="role") as pbar:
                while futures:
                    done, _ = wait(futures.keys(), return_when=FIRST_COMPLETED, timeout=3600)
                    for fut in done:
                        futures.pop(fut, None)
                        try:
                            imp, fb, ch, db = fut.result()
                        except Exception:
                            imp, fb, ch, db = 0, 1, 0, 0
                        stats["processed"] += 1
                        stats["improved"] += imp
                        stats["fallback"] += fb
                        stats["cache_hits"] += ch
                        stats["db_updated"] += db
                        pbar.update(1)

    if not args.no_cache:
        _save_cache(cache_path, cache)

    return stats


def run_mongo_pipeline(args: argparse.Namespace) -> None:
    cache_path = Path(args.cache_path) if args.cache_path else Path(".refine_role_descriptions.llm_cache.json")
    cache: Dict[str, str] = {} if args.no_cache else _load_cache(cache_path)

    query: Dict[str, Any] = {}
    if args.query.strip():
        parsed = json.loads(args.query)
        if not isinstance(parsed, dict):
            raise SystemExit("--query must be a JSON object")
        query = parsed

    if args.esco_ids_file:
        esco_ids = load_esco_ids_from_file(Path(args.esco_ids_file))
        query = {**query, "escoId": {"$in": esco_ids}}

    mongo_uri = args.mongo_uri or os.environ.get("MONGODB_URI", DEFAULT_MONGO_URI)
    mongo_db = args.mongo_db or os.environ.get("MONGODB_DB", DEFAULT_MONGO_DB)

    client, collection, roles, load_stats = load_roles_from_mongo(
        mongo_uri=mongo_uri,
        mongo_db=mongo_db,
        collection_name=args.mongo_collection,
        query=query,
        max_en_len=args.max_en_len,
        resume_min_en_len=args.resume_min_en_len,
        resume=args.resume,
        limit=args.limit,
    )

    print(f"MongoDB: {mongo_uri}")
    print(f"Database: {mongo_db}  Collection: {args.mongo_collection}")
    print(f"Matched documents: {load_stats['matched']}")
    print(f"Selected for refinement: {len(roles)}")
    print(f"Skipped empty description: {load_stats['skipped_empty']}")
    print(f"Skipped EN too long (>{args.max_en_len}): {load_stats['skipped_too_long']}")
    if args.resume:
        print(f"Skipped already refined (>={args.resume_min_en_len} chars): {load_stats['skipped_resume']}")

    if not roles:
        client.close()
        print("No roles to refine.")
        return

    openai_client = _build_openai_client(args)
    db_lock = threading.Lock() if args.max_concurrent > 1 and not args.review else None

    def on_role_done(role: Dict[str, Any], original: str, final_text: str, validated: bool) -> bool:
        if not validated or final_text == original:
            return False
        if db_lock:
            with db_lock:
                return persist_role_description(
                    collection,
                    role,
                    final_text,
                    clear_de=args.clear_de,
                    dry_run=args.dry_run,
                )
        return persist_role_description(
            collection,
            role,
            final_text,
            clear_de=args.clear_de,
            dry_run=args.dry_run,
        )

    try:
        stats = _refine_roles(
            args,
            roles,
            client=openai_client,
            cache=cache,
            cache_path=cache_path,
            on_role_done=on_role_done,
        )
    finally:
        client.close()

    print("\n--- Summary ---")
    print(f"Selected roles: {len(roles)}")
    print(f"Processed (LLM path): {stats['processed']}")
    print(f"Improved descriptions accepted: {stats['improved']}")
    print(f"Database updates: {stats['db_updated']}")
    print(f"Fallbacks (original kept): {stats['fallback']}")
    print(f"Cache hits: {stats['cache_hits']}")
    if args.dry_run:
        print("(Dry-run: API and database writes skipped.)")
    if args.clear_de and not args.dry_run:
        print("description.de was cleared for updated roles — re-run DE translation when ready.")


def run_pipeline(args: argparse.Namespace) -> None:
    input_path = Path(args.input)
    output_path = Path(args.output)
    cache_path = Path(args.cache_path) if args.cache_path else output_path.with_suffix(".llm_cache.json")

    roles = load_data(input_path)
    resume_map = _load_resume_map(output_path) if args.resume else {}
    cache: Dict[str, str] = {} if args.no_cache else _load_cache(cache_path)

    resumed = 0
    if args.resume and resume_map:
        for i, role in enumerate(roles):
            key = _role_key(role, i)
            if key in resume_map:
                prev = resume_map[key]
                if "description_original" in prev:
                    role["description_original"] = prev["description_original"]
                    role["description"] = prev.get("description", role.get("description", ""))
                resumed += 1

    openai_client = _build_openai_client(args)

    save_counter = {"n": 0}

    def on_role_done_json(role: Dict[str, Any], original: str, final_text: str, validated: bool) -> bool:
        save_counter["n"] += 1
        if args.incremental_save and save_counter["n"] % args.save_every == 0:
            save_output(output_path, roles)
        return True

    stats = _refine_roles(
        args,
        roles,
        client=openai_client,
        cache=cache,
        cache_path=cache_path,
        on_role_done=on_role_done_json if args.incremental_save else None,
    )
    stats["resumed"] = resumed

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
        "--source",
        choices=("json", "mongo"),
        default="json",
        help="Input source: JSON file (default) or MongoDB CareerPath collection.",
    )
    p.add_argument(
        "--mongo-uri",
        type=str,
        default=None,
        help=f"MongoDB URI (default: MONGODB_URI env or {DEFAULT_MONGO_URI!r}).",
    )
    p.add_argument(
        "--mongo-db",
        type=str,
        default=None,
        help=f"MongoDB database name (default: MONGODB_DB env or {DEFAULT_MONGO_DB!r}).",
    )
    p.add_argument(
        "--mongo-collection",
        type=str,
        default=DEFAULT_MONGO_COLLECTION,
        help=f"MongoDB collection name (default: {DEFAULT_MONGO_COLLECTION!r}).",
    )
    p.add_argument(
        "--esco-ids-file",
        type=Path,
        default=None,
        help="JSON file with roles to target (uses escoId from each entry).",
    )
    p.add_argument(
        "--query",
        type=str,
        default="{}",
        help='Extra MongoDB query filter as JSON (merged with --esco-ids-file).',
    )
    p.add_argument(
        "--max-en-len",
        type=int,
        default=500,
        help="Only refine roles whose English description is at most this long (0 = no limit).",
    )
    p.add_argument(
        "--resume-min-en-len",
        type=int,
        default=600,
        help="With --resume in mongo mode, skip roles whose EN description is already at least this long.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Process at most N matching MongoDB documents (0 = no limit).",
    )
    p.add_argument(
        "--clear-de",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Clear description.de when EN is updated in MongoDB (default: true).",
    )
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
    p.add_argument(
        "--resume",
        action="store_true",
        help="JSON: skip roles already present in output with description_original. "
        "Mongo: skip roles whose EN description already looks refined.",
    )
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
    if args.source == "mongo":
        run_mongo_pipeline(args)
    else:
        run_pipeline(args)


if __name__ == "__main__":
    main()
