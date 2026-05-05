"""
Harmonize role descriptions per ESCO occupation cluster (shared `id`).

Groups rows by ESCO URI, merges multiple source descriptions via LLM into ONE
paragraph per cluster, and assigns that text to every row in the cluster.

Reads a roles JSON file; writes a new file (does not overwrite input by default).

Use ``--review`` for human-in-the-loop: each cluster proposal is printed in the
terminal; answer y/n/edit before the merged description is written.
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
from typing import Any, Dict, List, Optional, Sequence, Tuple

from openai import OpenAI, APIConnectionError, APIError, RateLimitError
from tqdm import tqdm

from refine_role_descriptions import bootstrap_env_from_dotenv, RateLimiter

# ---------------------------------------------------------------------------
# Prompts (cluster harmonization)
# ---------------------------------------------------------------------------

CLUSTER_SYSTEM_PROMPT = (
    "You are an expert occupational writer specializing in career guidance content. "
    "You merge several descriptions of the same occupation into one accurate, readable text."
)

CLUSTER_USER_TEMPLATE = """You are given a cluster of role descriptions that all refer to the same occupation (same ESCO ID), but originate from different sources (e.g. ESCO, O*NET, merged datasets).

Your task is to create ONE single, high-quality, human-readable, and harmonized role description.

INPUT:

canonical_title:
{canonical_title}

alternative_titles:
{alternative_titles}

descriptions (from different sources / rows; each block is distinct input):
{descriptions_block}

INSTRUCTIONS:

1. Understand the common core of the role across all descriptions.
2. Identify overlapping responsibilities, tasks, and skills.
3. Remove redundancy and contradictions.
4. Prefer concrete, specific wording over generic phrases.
5. Keep the description realistic and grounded (not overly promotional).
6. Write in a clear, professional, and engaging tone suitable for career guidance.
7. Do NOT mention sources or that this is merged content.
8. Do NOT list bullet points – write a coherent paragraph (5–8 sentences).
9. If descriptions differ slightly, generalize to the most representative version of the role.
10. Incorporate useful detail from O*NET-style task descriptions where helpful.

OUTPUT:
Return only the harmonized description as plain text. No headings, labels, or commentary."""

PROMPT_VERSION = "v1-cluster-harmonize"

MIN_OUTPUT_LEN = 200
MAX_OUTPUT_LEN = 3500


def validate_harmonized(text: str) -> bool:
    if not text or not text.strip():
        return False
    t = text.strip()
    if len(t) < MIN_OUTPUT_LEN:
        return False
    if len(t) > MAX_OUTPUT_LEN:
        return False
    return True


def cluster_review_loop(
    cluster_num: int,
    cluster_total: int,
    esco_id: str,
    cluster_size: int,
    canonical_title: str,
    alternative_titles: List[str],
    source_previews: List[str],
    proposed_text: str,
    *,
    generation_note: str,
) -> Optional[str]:
    """
    Terminal human-in-the-loop for one cluster.

    Returns the description text to apply to all rows in the cluster, or ``None``
    if the user rejects (rows are left unchanged).
    """
    width = 88
    print("\n" + "=" * width)
    print(f"CLUSTER {cluster_num}/{cluster_total}   |   {cluster_size} dataset rows share this ESCO occupation")
    disp = esco_id
    if len(disp) > width - 12:
        disp = disp[: max(0, width - 15)] + "..."
    print(f"ESCO URI: {disp}")
    print(f"Source of proposed text: {generation_note}")
    print("-" * width)
    print(f"Canonical title: {canonical_title}")
    if alternative_titles:
        print("Alternative titles (sample):")
        for t in alternative_titles[:12]:
            print(f"  • {t}")
        if len(alternative_titles) > 12:
            print(f"  … (+{len(alternative_titles) - 12} more)")
    print("-" * width)
    print("Source variants (excerpt; the model saw the full text of each):")
    for i, excerpt in enumerate(source_previews, 1):
        print(f"--- Variant {i} ---")
        print(excerpt)
        if i < len(source_previews):
            print()
    print("-" * width)
    print("PROPOSED harmonized description (what will be written to every row in this cluster):")
    print(proposed_text)
    print("-" * width)
    print("Commands:  y = accept   n = reject (leave all rows in this cluster unchanged)")
    print("           edit = type your replacement on the next line; or enter MULTILINE for paragraph mode")
    while True:
        choice = input("Accept? (y/n/edit): ").strip().lower()
        if choice == "y":
            return proposed_text
        if choice == "n":
            return None
        if choice == "edit":
            mode = input("Replacement (one line), or type MULTILINE: ").strip()
            if mode.upper() == "MULTILINE":
                print("Enter your paragraph; finish with a line containing only a dot (.).")
                lines: List[str] = []
                while True:
                    try:
                        line = input()
                    except EOFError:
                        break
                    if line == ".":
                        break
                    lines.append(line)
                replacement = "\n".join(lines).strip()
            else:
                replacement = mode
            return replacement if replacement else proposed_text
        print("Please enter y, n, or edit.")


def load_roles(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("Expected JSON array of role objects")
    return data


def save_roles(path: Path, roles: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(roles, f, indent=2, ensure_ascii=False)


def _dedupe_preserve(seq: Sequence[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for s in seq:
        t = (s or "").strip()
        if not t:
            continue
        key = " ".join(t.split()).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def merge_alternative_titles(rows: List[Dict[str, Any]]) -> List[str]:
    acc: List[str] = []
    for r in rows:
        for t in r.get("alternative_titles") or []:
            if isinstance(t, str) and t.strip():
                acc.append(t.strip())
    return _dedupe_preserve(acc)


def collect_cluster_descriptions(
    rows: List[Dict[str, Any]],
    *,
    include_refined: bool,
) -> List[str]:
    acc: List[str] = []
    for r in rows:
        o = r.get("description_original")
        if isinstance(o, str) and o.strip():
            acc.append(o.strip())
    if not acc:
        for r in rows:
            d = r.get("description")
            if isinstance(d, str) and d.strip():
                acc.append(d.strip())
    if include_refined:
        for r in rows:
            d = r.get("description")
            if isinstance(d, str) and d.strip():
                acc.append(d.strip())
    return _dedupe_preserve(acc)


def pick_canonical_title(rows: List[Dict[str, Any]]) -> str:
    """Use the title from the row with the richest source text (deterministic tie-break)."""
    best_title = ""
    best_len = -1
    best_title_sort = ""
    for r in rows:
        src = (r.get("description_original") or r.get("description") or "").strip()
        t = (r.get("title") or "").strip() or "(untitled)"
        L = len(src)
        if L > best_len or (L == best_len and t.lower() < best_title_sort):
            best_len = L
            best_title = t
            best_title_sort = t.lower()
    return best_title


def build_descriptions_block(descriptions: List[str]) -> str:
    parts: List[str] = []
    for i, d in enumerate(descriptions, start=1):
        parts.append(f"[Source variant {i}]\n{d}")
    return "\n\n".join(parts)


def cluster_cache_key(esco_id: str, canonical_title: str, descriptions: List[str]) -> str:
    payload = "|".join(
        [PROMPT_VERSION, esco_id, canonical_title.strip().lower()]
        + [hashlib.sha256(d.encode("utf-8")).hexdigest() for d in descriptions]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def call_llm_messages(
    client: OpenAI,
    model: str,
    system: str,
    user: str,
    *,
    max_retries: int = 6,
    base_delay_sec: float = 1.0,
    max_delay_sec: float = 60.0,
    rate_limiter: Optional[RateLimiter] = None,
    use_seed: bool = True,
) -> str:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
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
            return (resp.choices[0].message.content or "").strip()
        except RateLimitError as e:
            last_err = e
        except APIConnectionError as e:
            last_err = e
        except APIError as e:
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
    raise RuntimeError("LLM call failed without specific error")


def group_by_esco_id(roles: List[Dict[str, Any]]) -> Dict[str, List[Tuple[int, Dict[str, Any]]]]:
    groups: Dict[str, List[Tuple[int, Dict[str, Any]]]] = {}
    for i, r in enumerate(roles):
        if not isinstance(r, dict):
            continue
        rid = r.get("id")
        if not isinstance(rid, str) or not rid.strip():
            continue
        groups.setdefault(rid.strip(), []).append((i, r))
    return groups


def harmonize_cluster_text(
    client: OpenAI,
    model: str,
    esco_id: str,
    rows: List[Dict[str, Any]],
    *,
    include_refined: bool,
    cache: Optional[Dict[str, str]],
    cache_lock: Optional[threading.Lock],
    rate_limiter: Optional[RateLimiter],
    use_seed: bool,
    use_cache: bool,
    commit_to_cache: bool = True,
) -> Tuple[str, str]:
    """
    Returns (text, reason_ok).
    reason_ok is "llm", "cache", or "fallback_short".
    On failure after fallback, text is best-effort concatenation stub (caller should use per-row description).
    """
    descs = collect_cluster_descriptions(rows, include_refined=include_refined)
    if not descs:
        return "", "fallback_short"

    title = pick_canonical_title(rows)
    alt = merge_alternative_titles(rows)
    alt_block = "\n".join(f"- {t}" for t in alt) if alt else "(none listed)"

    ck = cluster_cache_key(esco_id, title, descs)
    if use_cache and cache is not None:
        if cache_lock:
            with cache_lock:
                hit = cache.get(ck)
        else:
            hit = cache.get(ck)
        if hit is not None and validate_harmonized(hit):
            return hit, "cache"

    block = build_descriptions_block(descs)
    user = CLUSTER_USER_TEMPLATE.format(
        canonical_title=title,
        alternative_titles=alt_block,
        descriptions_block=block,
    )
    try:
        raw = call_llm_messages(
            client,
            model,
            CLUSTER_SYSTEM_PROMPT,
            user,
            rate_limiter=rate_limiter,
            use_seed=use_seed,
        )
    except Exception:
        raw = ""
    if validate_harmonized(raw):
        if commit_to_cache and use_cache and cache is not None:
            if cache_lock:
                with cache_lock:
                    cache[ck] = raw
            else:
                cache[ck] = raw
        return raw, "llm"
    # Fallback: longest source variant
    fb = max(descs, key=len)
    return fb.strip(), "fallback_short"


def apply_cluster_updates(
    indexed_rows: List[Tuple[int, Dict[str, Any]]],
    text: str,
) -> None:
    for _, r in indexed_rows:
        r.setdefault("description_before_cluster_harmonization", r.get("description", ""))
        r["description"] = text
        r["esco_cluster_size"] = len(indexed_rows)
        r["description_cluster_harmonized"] = True


def run(args: argparse.Namespace) -> None:
    input_path = Path(args.input)
    output_path = Path(args.output)
    cache_path = Path(args.cache_path) if args.cache_path else output_path.with_suffix(".cluster_cache.json")

    roles = load_roles(input_path)
    groups = group_by_esco_id(roles)

    multi = {k: v for k, v in groups.items() if len(v) > 1}
    single = {k: v for k, v in groups.items() if len(v) == 1}

    cache: Dict[str, str] = {} if args.no_cache else _load_json_dict(cache_path)
    rate_limiter = RateLimiter(args.min_interval_sec)

    if args.review and args.max_concurrent > 1:
        print("Note: --review processes one cluster at a time; parallel workers are disabled.")

    effective_concurrent = 1 if args.review else args.max_concurrent
    cache_lock = threading.Lock() if effective_concurrent > 1 else None

    client: Optional[OpenAI] = None
    if not args.dry_run:
        if not os.environ.get("OPENAI_API_KEY"):
            raise SystemExit(
                "OPENAI_API_KEY is not set. Use .env, export the variable, or --dry-run."
            )
        client = OpenAI(
            api_key=os.environ.get("OPENAI_API_KEY"),
            base_url=args.base_url or os.environ.get("OPENAI_BASE_URL") or None,
        )

    stats = {
        "singleton_clusters": len(single),
        "multi_clusters": len(multi),
        "rows_in_multi": sum(len(v) for v in multi.values()),
        "llm_ok": 0,
        "cache_ok": 0,
        "fallback": 0,
        "review_rejected": 0,
        "clusters_applied": 0,
    }

    cluster_items = sorted(multi.items(), key=lambda x: x[0])
    n_clusters = len(cluster_items)

    gen_notes = {
        "llm": "Model output",
        "cache": "Cache hit (identical cluster inputs seen before)",
        "fallback_short": "Automatic fallback: longest raw source variant (model output missing or failed validation)",
    }

    # --- Human-in-the-loop: one cluster at a time, save after each decision ---
    if args.review:
        for ci, item in enumerate(cluster_items, start=1):
            esco_id, indexed_rows = item
            rows_only = [r for _, r in indexed_rows]
            if args.dry_run:
                merged = collect_cluster_descriptions(rows_only, include_refined=args.include_refined)
                text = max(merged, key=len) if merged else (rows_only[0].get("description") or "").strip()
                reason = "fallback_short"
            else:
                assert client is not None
                text, reason = harmonize_cluster_text(
                    client,
                    args.model,
                    esco_id,
                    rows_only,
                    include_refined=args.include_refined,
                    cache=cache,
                    cache_lock=cache_lock,
                    rate_limiter=rate_limiter,
                    use_seed=not args.no_seed,
                    use_cache=not args.no_cache,
                    commit_to_cache=False,
                )
            if reason == "llm":
                stats["llm_ok"] += 1
            elif reason == "cache":
                stats["cache_ok"] += 1
            else:
                stats["fallback"] += 1

            title = pick_canonical_title(rows_only)
            descs = collect_cluster_descriptions(rows_only, include_refined=args.include_refined)
            previews = [(d if len(d) <= 600 else d[:600] + "…") for d in descs[:5]]

            final_text = cluster_review_loop(
                ci,
                n_clusters,
                esco_id,
                len(indexed_rows),
                title,
                merge_alternative_titles(rows_only),
                previews,
                text,
                generation_note=gen_notes.get(reason, reason),
            )
            if final_text is None:
                stats["review_rejected"] += 1
                continue
            if not args.no_cache and descs:
                ck = cluster_cache_key(esco_id, title, descs)
                if validate_harmonized(final_text):
                    cache[ck] = final_text

            apply_cluster_updates(indexed_rows, final_text)
            stats["clusters_applied"] += 1
            if not args.no_cache:
                _save_json_dict(cache_path, cache)
            save_roles(output_path, roles)
            print(f"[Saved {stats['clusters_applied']} accepted cluster(s) → {output_path}]")

    elif effective_concurrent <= 1 or args.dry_run:
        n_done = 0
        for item in tqdm(cluster_items, desc="Harmonizing clusters", unit="cluster"):
            esco_id, indexed_rows = item
            rows_only = [r for _, r in indexed_rows]
            if args.dry_run:
                merged = collect_cluster_descriptions(rows_only, include_refined=args.include_refined)
                proposal = max(merged, key=len) if merged else (rows_only[0].get("description") or "").strip()
                reason = "fallback_short"
            else:
                assert client is not None
                proposal, reason = harmonize_cluster_text(
                    client,
                    args.model,
                    esco_id,
                    rows_only,
                    include_refined=args.include_refined,
                    cache=cache,
                    cache_lock=cache_lock,
                    rate_limiter=rate_limiter,
                    use_seed=not args.no_seed,
                    use_cache=not args.no_cache,
                    commit_to_cache=True,
                )
            if reason == "llm":
                stats["llm_ok"] += 1
            elif reason == "cache":
                stats["cache_ok"] += 1
            else:
                stats["fallback"] += 1
            apply_cluster_updates(indexed_rows, proposal)
            stats["clusters_applied"] += 1
            n_done += 1
            if not args.no_cache and n_done % args.cache_save_every == 0:
                _save_json_dict(cache_path, cache)

        if not args.no_cache:
            _save_json_dict(cache_path, cache)
        save_roles(output_path, roles)

    else:
        lock = threading.Lock()
        done = [0]

        def process_cluster_parallel(
            item: Tuple[str, List[Tuple[int, Dict[str, Any]]]],
        ) -> Tuple[int, int, int]:
            esco_id, indexed_rows = item
            rows_only = [r for _, r in indexed_rows]
            proposal, reason = harmonize_cluster_text(
                client,  # type: ignore[arg-type]
                args.model,
                esco_id,
                rows_only,
                include_refined=args.include_refined,
                cache=cache,
                cache_lock=cache_lock,
                rate_limiter=rate_limiter,
                use_seed=not args.no_seed,
                use_cache=not args.no_cache,
                commit_to_cache=True,
            )
            llm, ch, fb = (1, 0, 0) if reason == "llm" else ((0, 1, 0) if reason == "cache" else (0, 0, 1))
            apply_cluster_updates(indexed_rows, proposal)
            with lock:
                done[0] += 1
                if not args.no_cache and done[0] % args.cache_save_every == 0:
                    _save_json_dict(cache_path, cache)
            return llm, ch, fb

        assert client is not None
        with ThreadPoolExecutor(max_workers=effective_concurrent) as ex:
            futures = {ex.submit(process_cluster_parallel, it): it for it in cluster_items}
            with tqdm(total=len(cluster_items), desc="Harmonizing clusters", unit="cluster") as pbar:
                while futures:
                    completed, _ = wait(futures.keys(), return_when=FIRST_COMPLETED, timeout=7200)
                    for fut in completed:
                        futures.pop(fut, None)
                        try:
                            llm, ch, fb = fut.result()
                        except Exception:
                            llm, ch, fb = 0, 0, 1
                        stats["llm_ok"] += llm
                        stats["cache_ok"] += ch
                        stats["fallback"] += fb
                        stats["clusters_applied"] += 1
                        pbar.update(1)

        if not args.no_cache:
            _save_json_dict(cache_path, cache)
        save_roles(output_path, roles)

    print("\n--- Cluster harmonization summary ---")
    print(f"Total rows: {len(roles)}")
    print(f"Unique ESCO ids: {len(groups)}")
    print(f"Singleton clusters (unchanged): {stats['singleton_clusters']}")
    print(f"Multi-row clusters (in input): {stats['multi_clusters']} ({stats['rows_in_multi']} rows)")
    print(f"Clusters applied to the file: {stats['clusters_applied']}")
    if args.review:
        print(f"Review: rejected (left rows unchanged): {stats['review_rejected']}")
    print(f"Generation — LLM successes: {stats['llm_ok']}")
    print(f"Generation — cache hits: {stats['cache_ok']}")
    print(f"Generation — fallbacks before review: {stats['fallback']}")
    print(f"Output: {output_path}")


def _load_json_dict(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_json_dict(path: Path, data: Dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Harmonize descriptions per ESCO id cluster.")
    p.add_argument(
        "--input",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\final_roles_refined.json"),
    )
    p.add_argument(
        "--output",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\final_roles_cluster_harmonized.json"),
    )
    p.add_argument("--model", type=str, default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"))
    p.add_argument("--base-url", type=str, default=None)
    p.add_argument(
        "--include-refined",
        action="store_true",
        help="Also feed each row's per-row refined `description` into the merge (in addition to description_original).",
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument(
        "--review",
        action="store_true",
        help="Human-in-the-loop: print each cluster proposal in the terminal; y/n/edit before writing.",
    )
    p.add_argument("--max-concurrent", type=int, default=3)
    p.add_argument("--min-interval-sec", type=float, default=0.0)
    p.add_argument("--no-cache", action="store_true")
    p.add_argument("--cache-path", type=Path, default=None)
    p.add_argument("--cache-save-every", type=int, default=5)
    p.add_argument("--no-seed", action="store_true")
    return p


def main() -> None:
    bootstrap_env_from_dotenv()
    run(build_arg_parser().parse_args())


if __name__ == "__main__":
    main()
