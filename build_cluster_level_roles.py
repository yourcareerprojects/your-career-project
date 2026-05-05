"""
Build a final, cluster-based role dataset for embedding/matching.

Input: esco_cluster_harmonizations.json (cluster-level harmonization output)
Output: final_roles_clustered.json (one role per cluster, sorted by title)

This script does NOT call any LLM or external APIs.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union


DEFAULT_INPUT = Path(r"C:\Users\nicol\Documents\7.Development\esco_cluster_harmonizations.json")
DEFAULT_OUTPUT = Path(r"C:\Users\nicol\Documents\7.Development\final_roles_clustered.json")
DEFAULT_MAX_REQUIRED_SKILLS = 25
DEFAULT_MAX_OPTIONAL_SKILLS = 20


def load_data(path: Path) -> Union[Dict[str, Any], List[Any]]:
    """Load JSON from disk.

    Accepts either:
      - dict (e.g. {"version": 1, "clusters": [...]})
      - list (e.g. row-level roles array)
    """
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) or isinstance(data, list):
        return data
    raise ValueError("Input JSON must be either an object or an array at the top-level.")


def clean_text(text: Any) -> str:
    """Strip whitespace; return empty string for non-string/empty inputs."""
    if text is None:
        return ""
    if not isinstance(text, str):
        text = str(text)
    # Normalize whitespace (but keep newlines if present; embedding_text will collapse).
    text = text.strip()
    # Remove zero-width chars that can break deterministic comparisons.
    text = re.sub(r"[\u200b-\u200f\uFEFF]", "", text)
    return text


def clean_text_list(items: Any) -> List[str]:
    """Clean a list of strings: strip, remove empty, dedupe case-insensitively preserving order."""
    if not items:
        return []
    if not isinstance(items, list):
        items = [items]
    out: List[str] = []
    seen: set[str] = set()
    for x in items:
        t = clean_text(x)
        if not t:
            continue
        # Case-insensitive dedupe; also normalize extra whitespace.
        k = " ".join(t.split()).lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(t)
    return out


def dedupe_similar_titles(titles: List[str]) -> List[str]:
    """
    Optional nicety: dedupe titles that are effectively the same after removing punctuation.
    Keeps the first occurrence.
    """
    if not titles:
        return []
    out: List[str] = []
    seen: set[str] = set()
    for t in titles:
        # Remove punctuation and collapse spaces for similarity checks.
        normalized = re.sub(r"[^a-zA-Z0-9\s]", "", t)
        normalized = " ".join(normalized.split()).lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        out.append(t)
    return out


def _extract_string_from_item(item: Any) -> str:
    """Best-effort conversion of 'skills/tasks' items into a plain string."""
    if item is None:
        return ""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        for k in ("name", "skill", "task", "title", "text", "value"):
            v = item.get(k)
            if isinstance(v, str) and v.strip():
                return v
        # As a last resort, stringify the dict deterministically-ish.
        # (We do NOT sort keys here to keep it simple; we only need a stable-ish string.)
        return json_dumps_compact(item)
    return str(item)


def json_dumps_compact(obj: Any) -> str:
    try:
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    except Exception:
        return str(obj)


def clean_text_list_from_mixed(items: Any) -> List[str]:
    """Like clean_text_list, but handles lists of dicts (e.g. skill objects)."""
    if not items:
        return []
    if not isinstance(items, list):
        items = [items]
    extracted = [_extract_string_from_item(x) for x in items]
    return clean_text_list(extracted)


def build_embedding_text(
    *,
    title: str,
    description: str,
    alternative_titles: Sequence[str],
    skills: Sequence[str],
    required_skills: Sequence[str],
    optional_skills: Sequence[str],
    tasks: Sequence[str],
    max_len: int,
) -> str:
    """Build a deterministic embedding input string, truncated to max_len characters."""
    # Collapse whitespace to make embeddings more stable.
    def collapse(s: str) -> str:
        return re.sub(r"\s+", " ", (s or "").strip())

    parts: List[str] = []
    parts.append(f"Title: {collapse(title)}")
    parts.append(f"Description: {collapse(description)}")
    if alternative_titles:
        parts.append("Alternative titles: " + ", ".join(collapse(x) for x in alternative_titles[:10]))
    if skills:
        parts.append("Skills: " + ", ".join(collapse(x) for x in skills))
    if required_skills:
        parts.append("Required skills: " + ", ".join(collapse(x) for x in required_skills))
    if optional_skills:
        parts.append("Optional skills: " + ", ".join(collapse(x) for x in optional_skills))
    if tasks:
        parts.append("Tasks: " + ", ".join(collapse(x) for x in tasks))

    text = "\n".join(parts).strip()
    if not text:
        text = collapse(description)  # last resort
    if len(text) > max_len:
        text = text[: max_len - 1].rstrip() + "…"
    return text


_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def extract_responsibilities_from_description(description: str, *, max_items: int = 12) -> List[str]:
    """
    Deterministically extract responsibility-like sentences from a description.

    This does NOT invent new content; it selects sentences already present in `description`.
    """
    desc = clean_text(description)
    if not desc:
        return []

    # Common action/behavior verbs seen in your source descriptions.
    verbs = [
        "coordinate",
        "manage",
        "monitor",
        "ensure",
        "prepare",
        "conduct",
        "perform",
        "operate",
        "maintain",
        "test",
        "inspect",
        "analyze",
        "assess",
        "adapt",
        "develop",
        "implement",
        "supervise",
        "train",
        "teach",
        "deliver",
        "support",
        "assist",
        "organize",
        "review",
        "communicate",
        "report",
        "schedule",
        "negotiate",
        "evaluate",
        "design",
        "plan",
        "handle",
        "execute",
        "collaborate",
    ]
    verbs_re = re.compile(r"(^|\b)(" + "|".join(re.escape(v) for v in verbs) + r")\b", re.IGNORECASE)

    sentences = [s.strip() for s in _SENT_SPLIT_RE.split(desc) if s and s.strip()]
    candidates: List[Tuple[int, str]] = []
    for s in sentences:
        # Skip very short fragments.
        if len(s) < 40:
            continue
        # Skip overly long sentences to keep embedding/task-friendly.
        if len(s) > 240:
            continue

        s_norm = " ".join(s.split())
        score = 0

        # Prefer sentences that start with an action verb or clearly describe "They/They may" behavior.
        s_low = s_norm.lower()
        if s_low.startswith(("they ", "they may ")):
            score += 3
        if verbs_re.search(s_norm):
            score += 5

        # Prefer sentences mentioning work products / outputs (often present in responsibilities).
        if any(k in s_low for k in ("process", "program", "project", "equipment", "tools", "data", "results", "reports", "tasks", "work", "plans")):
            score += 1

        if score > 0:
            candidates.append((score, s_norm))

    # Preserve original order among equal scores by using stable sorting key.
    candidates_sorted = sorted(enumerate(candidates), key=lambda x: (-x[1][0], x[0]))
    out: List[str] = []
    seen: set[str] = set()
    for _, (_, s_norm) in candidates_sorted:
        k = " ".join(s_norm.split()).lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(s_norm)
        if len(out) >= max_items:
            break
    return out


def ensure_min_items(items: List[str], *, min_items: int, warn_name: str, cluster_id: str, warnings: List[str]) -> None:
    """Log a warning if list has fewer than min_items (keeps content unchanged)."""
    if len(items) < min_items:
        warnings.append(f"Cluster {cluster_id}: {warn_name} has {len(items)} items (<{min_items}).")


def process_cluster(
    cluster: Dict[str, Any],
    *,
    max_embedding_len: int,
    warnings: List[str],
    skipped: List[Tuple[str, str]],
    seen_ids: set[str],
) -> Optional[Dict[str, Any]]:
    """
    Convert one cluster object into one output role object.
    Returns None if skipped.
    """
    if not isinstance(cluster, dict):
        skipped.append(("unknown", "invalid_cluster_type"))
        return None

    esco_id = clean_text(cluster.get("esco_id"))
    if not esco_id:
        skipped.append((clean_text(cluster.get("canonical_title")), "missing_esco_id"))
        return None

    if esco_id in seen_ids:
        skipped.append((esco_id, "id_collision_duplicate_esco_id"))
        return None
    seen_ids.add(esco_id)

    canonical_title = clean_text(cluster.get("canonical_title"))
    alternative_titles_raw = cluster.get("alternative_titles")
    alternative_titles = clean_text_list(alternative_titles_raw)
    alternative_titles = dedupe_similar_titles(alternative_titles)

    # Title handling rule
    title = canonical_title
    if not title:
        title = alternative_titles[0] if alternative_titles else ""
    if not title:
        skipped.append((esco_id, "empty_title_after_fallback"))
        return None
    title = title.strip()

    # Alternative titles cleanup:
    # - Remove duplicates (already done)
    # - Remove title if present (case-insensitive)
    alt_filtered: List[str] = []
    title_key = title.strip().lower()
    for t in alternative_titles:
        if clean_text(t).strip().lower() == title_key:
            continue
        alt_filtered.append(t.strip())
        if len(alt_filtered) >= 10:
            break

    description = clean_text(cluster.get("harmonized_description"))
    if not description:
        # Also try common alternative key names defensively.
        description = clean_text(cluster.get("description"))
    if not description:
        skipped.append((esco_id, "missing_or_empty_harmonized_description"))
        return None

    cluster_size_val = cluster.get("cluster_size")
    try:
        cluster_size = int(cluster_size_val) if cluster_size_val is not None else 0
        if cluster_size < 0:
            cluster_size = 0
    except (TypeError, ValueError):
        cluster_size = 0

    # Keep responsibilities & skills if present; otherwise default to empty lists.
    skills = clean_text_list_from_mixed(cluster.get("skills") or cluster.get("skill_names") or [])
    tasks = clean_text_list_from_mixed(cluster.get("tasks") or cluster.get("task_names") or [])
    required_skills = clean_text_list_from_mixed(cluster.get("required_skills") or cluster.get("core_skills") or [])
    optional_skills = clean_text_list_from_mixed(cluster.get("optional_skills") or [])
    occupation_group = clean_text(
        cluster.get("occupation_group")
        or cluster.get("occupationGroup")
        or cluster.get("iscoGroup")
        or cluster.get("isco_group")
        or cluster.get("isco")
    )

    ensure_min_items(skills, min_items=3, warn_name="skills", cluster_id=esco_id, warnings=warnings)
    ensure_min_items(tasks, min_items=3, warn_name="tasks", cluster_id=esco_id, warnings=warnings)

    embedding_text = build_embedding_text(
        title=title,
        description=description,
        alternative_titles=alt_filtered,
        skills=skills,
        required_skills=required_skills,
        optional_skills=optional_skills,
        tasks=tasks,
        max_len=max_embedding_len,
    )

    role: Dict[str, Any] = {
        "id": str(esco_id),
        "esco_id": str(esco_id),
        "title": title,
        "alternative_titles": alt_filtered,
        "description": description,
        "occupation_group": occupation_group,
        "cluster_size": cluster_size,
        "embedding_text": embedding_text,
        "skills": skills,
        "tasks": tasks,
        "required_skills": required_skills,
        "optional_skills": optional_skills,
    }

    # Data cleaning guarantee for text fields
    role["title"] = clean_text(role["title"])
    role["description"] = clean_text(role["description"])
    role["occupation_group"] = clean_text(role.get("occupation_group"))
    role["embedding_text"] = clean_text(role["embedding_text"])
    role["alternative_titles"] = [clean_text(x) for x in role["alternative_titles"] if clean_text(x)]
    role["skills"] = [clean_text(x) for x in role.get("skills", []) if clean_text(x)]
    role["tasks"] = [clean_text(x) for x in role.get("tasks", []) if clean_text(x)]
    role["required_skills"] = [clean_text(x) for x in role.get("required_skills", []) if clean_text(x)]
    role["optional_skills"] = [clean_text(x) for x in role.get("optional_skills", []) if clean_text(x)]

    # Missing fields detection (soft validation)
    missing_fields: List[str] = []
    for k in ("id", "esco_id", "title", "description", "embedding_text"):
        if not clean_text(role.get(k)):
            missing_fields.append(k)
    if missing_fields:
        warnings.append(f"Cluster {esco_id}: missing/empty fields: {', '.join(missing_fields)}")

    return role


def maybe_get_unclustered_roles(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Best-effort support for 'roles not sorted into clusters'.

    The provided spec doesn't include this, but the pipeline description does.
    We accept a few common key names if present.
    """
    for key in ("unclustered_roles", "roles_not_in_clusters", "unclustered", "orphans", "remaining_roles"):
        v = data.get(key)
        if isinstance(v, list):
            # Only dict items
            return [x for x in v if isinstance(x, dict)]
    return []


def process_unclustered_role(
    role_in: Dict[str, Any],
    *,
    max_embedding_len: int,
    warnings: List[str],
    skipped: List[Tuple[str, str]],
    seen_ids: set[str],
) -> Optional[Dict[str, Any]]:
    """Convert a non-cluster role input to the same output schema."""
    rid = clean_text(role_in.get("id") or role_in.get("esco_id") or role_in.get("cluster_id"))
    if not rid:
        skipped.append((clean_text(role_in.get("title")), "unclustered_missing_id"))
        return None
    # Collision strategy: keep cluster role; skip duplicates.
    if rid in seen_ids:
        skipped.append((rid, "id_collision_with_cluster_or_other_role"))
        return None
    seen_ids.add(rid)

    esco_id = clean_text(role_in.get("esco_id") or rid)
    title = clean_text(role_in.get("title") or role_in.get("canonical_title"))
    alt_titles = clean_text_list(role_in.get("alternative_titles") or [])
    if not title:
        title = alt_titles[0] if alt_titles else ""
    if not title:
        skipped.append((rid, "unclustered_empty_title"))
        return None

    # Clean alt titles and remove title if present
    title_key = title.lower()
    alt_filtered: List[str] = []
    for t in dedupe_similar_titles(alt_titles):
        if t.strip().lower() == title_key:
            continue
        alt_filtered.append(t.strip())
        if len(alt_filtered) >= 10:
            break

    description = clean_text(role_in.get("description") or role_in.get("harmonized_description"))
    if not description:
        skipped.append((rid, "unclustered_missing_description"))
        return None

    skills = clean_text_list_from_mixed(role_in.get("skills") or [])
    required_skills = clean_text_list_from_mixed(role_in.get("required_skills") or role_in.get("core_skills") or [])
    optional_skills = clean_text_list_from_mixed(role_in.get("optional_skills") or [])
    occupation_group = clean_text(
        role_in.get("occupation_group")
        or role_in.get("occupationGroup")
        or role_in.get("iscoGroup")
        or role_in.get("isco_group")
        or role_in.get("isco")
    )
    tasks = clean_text_list_from_mixed(role_in.get("tasks") or [])
    ensure_min_items(skills, min_items=3, warn_name="skills", cluster_id=rid, warnings=warnings)
    if len(tasks) < 3:
        before_n = len(tasks)
        extracted = extract_responsibilities_from_description(description, max_items=12)
        if extracted:
            tasks = clean_text_list(tasks + extracted)
            warnings.append(
                f"Cluster {rid}: tasks had {before_n}<3 upstream; extracted {len(extracted)} responsibility sentences from description."
            )
    ensure_min_items(tasks, min_items=3, warn_name="tasks", cluster_id=rid, warnings=warnings)

    embedding_text = build_embedding_text(
        title=title,
        description=description,
        alternative_titles=alt_filtered,
        skills=skills,
        required_skills=required_skills,
        optional_skills=optional_skills,
        tasks=tasks,
        max_len=max_embedding_len,
    )

    # Cluster size unknown for unclustered roles.
    cluster_size = 0

    return {
        "id": str(rid),
        "esco_id": str(esco_id),
        "title": title,
        "alternative_titles": alt_filtered,
        "description": description,
        "occupation_group": occupation_group,
        "cluster_size": cluster_size,
        "embedding_text": embedding_text,
        "skills": skills,
        "required_skills": required_skills,
        "optional_skills": optional_skills,
        "tasks": tasks,
    }


def clean_role_after_cluster_creation(role: Dict[str, Any]) -> Dict[str, Any]:
    """Extra defensive cleaning for all text fields."""
    role["id"] = clean_text(role.get("id"))
    role["esco_id"] = clean_text(role.get("esco_id"))
    role["title"] = clean_text(role.get("title"))
    role["description"] = clean_text(role.get("description"))
    role["occupation_group"] = clean_text(role.get("occupation_group"))
    role["embedding_text"] = clean_text(role.get("embedding_text"))

    role["alternative_titles"] = clean_text_list(role.get("alternative_titles"))
    if "skills" in role:
        role["skills"] = clean_text_list_from_mixed(role.get("skills"))
    if "required_skills" in role:
        role["required_skills"] = clean_text_list_from_mixed(role.get("required_skills"))
    if "optional_skills" in role:
        role["optional_skills"] = clean_text_list_from_mixed(role.get("optional_skills"))
    if "required_skills" in role:
        role["required_skills"] = role["required_skills"][:DEFAULT_MAX_REQUIRED_SKILLS]
    if "optional_skills" in role:
        role["optional_skills"] = role["optional_skills"][:DEFAULT_MAX_OPTIONAL_SKILLS]
    if "tasks" in role:
        role["tasks"] = clean_text_list_from_mixed(role.get("tasks"))
    if "occupation_group_members" in role:
        role["occupation_group_members"] = clean_text_list_from_mixed(role.get("occupation_group_members"))

    # Ensure cluster_size int-ish
    try:
        role["cluster_size"] = int(role.get("cluster_size") or 0)
    except (TypeError, ValueError):
        role["cluster_size"] = 0
    return role


def _group_rows_by_esco_id(rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        esco_id = clean_text(r.get("esco_id") or r.get("id") or r.get("cluster_id"))
        if not esco_id:
            continue
        groups.setdefault(esco_id, []).append(r)
    return groups


def _merge_alternative_titles_from_rows(rows: List[Dict[str, Any]], title: str) -> List[str]:
    alts: List[str] = []
    for r in rows:
        alts.extend(clean_text_list_from_mixed(r.get("alternative_titles") or []))
    alts = dedupe_similar_titles(clean_text_list(alts))
    title_key = clean_text(title).lower()
    filtered: List[str] = []
    for t in alts:
        if clean_text(t).lower() == title_key:
            continue
        if t not in filtered:
            filtered.append(t)
        if len(filtered) >= 10:
            break
    return filtered


def _pick_title_from_rows(rows: List[Dict[str, Any]]) -> str:
    # Prefer 'title' that is longest/most informative; deterministic tie-break on lowercased title.
    best = ""
    for r in rows:
        t = clean_text(r.get("title") or r.get("canonical_title"))
        if not t:
            continue
        if len(t) > len(best) or (len(t) == len(best) and t.lower() < best.lower()):
            best = t
    return best


def _pick_description_from_rows(rows: List[Dict[str, Any]]) -> str:
    # Prefer harmonized cluster output if present (description_cluster_harmonized True), else use description.
    candidates: List[Tuple[int, str]] = []
    for r in rows:
        desc = clean_text(r.get("description") or r.get("harmonized_description") or "")
        if not desc:
            continue
        score = 0
        if r.get("description_cluster_harmonized") is True:
            score += 10
        # Also reward longer, but avoid selecting massive garbage.
        score += min(len(desc), 2000) / 2000.0
        candidates.append((int(score * 1000), desc))
    if not candidates:
        return ""
    candidates.sort(reverse=True, key=lambda x: x[0])
    return candidates[0][1]


def _extract_occupation_group_from_row(row: Dict[str, Any]) -> str:
    for key in ("occupation_group", "occupationGroup", "iscoGroup", "isco_group", "isco"):
        v = clean_text(row.get(key))
        if v:
            return v
    return ""


def _aggregate_occupation_group_from_rows(rows: List[Dict[str, Any]]) -> Tuple[str, List[str]]:
    values = clean_text_list([_extract_occupation_group_from_row(r) for r in rows])
    if not values:
        return "", []
    counts: Dict[str, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    canonical = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))[0][0]
    return canonical, values


def process_row_group(
    esco_id: str,
    rows: List[Dict[str, Any]],
    *,
    max_embedding_len: int,
    warnings: List[str],
    skipped: List[Tuple[str, str]],
    seen_ids: set[str],
) -> Optional[Dict[str, Any]]:
    """Create exactly one role from a set of row variants for the same ESCO id."""
    if not rows:
        return None
    if esco_id in seen_ids:
        skipped.append((esco_id, "id_collision_duplicate_esco_id"))
        return None
    seen_ids.add(esco_id)

    title = _pick_title_from_rows(rows)
    if not title:
        # Fallback: first alt title
        alt0 = ""
        for r in rows:
            alts = clean_text_list_from_mixed(r.get("alternative_titles") or [])
            if alts:
                alt0 = alts[0]
                break
        title = alt0
    title = clean_text(title)
    if not title:
        skipped.append((esco_id, "empty_title_after_fallback"))
        return None

    description = _pick_description_from_rows(rows)
    if not description:
        skipped.append((esco_id, "missing_description_for_group"))
        return None

    alt_titles = _merge_alternative_titles_from_rows(rows, title)
    occupation_group, occupation_group_members = _aggregate_occupation_group_from_rows(rows)

    # Merge skills/tasks/core/optional across variants.
    skills: List[str] = []
    required_skills: List[str] = []
    optional_skills: List[str] = []
    tasks: List[str] = []
    for r in rows:
        skills.extend(clean_text_list_from_mixed(r.get("skills") or []))
        required_skills.extend(clean_text_list_from_mixed(r.get("required_skills") or r.get("core_skills") or []))
        optional_skills.extend(clean_text_list_from_mixed(r.get("optional_skills") or []))
        tasks.extend(clean_text_list_from_mixed(r.get("tasks") or []))
    # Deduplicate while preserving order.
    skills = clean_text_list(skills)
    required_skills = clean_text_list(required_skills)
    optional_skills = clean_text_list(optional_skills)
    tasks = clean_text_list(tasks)

    ensure_min_items(skills, min_items=3, warn_name="skills", cluster_id=esco_id, warnings=warnings)
    if len(tasks) < 3:
        before_n = len(tasks)
        # If tasks are missing upstream, extract responsibility-like sentences from the chosen description.
        extracted = extract_responsibilities_from_description(description, max_items=12)
        if extracted:
            # Merge extracted responsibilities into existing tasks.
            tasks = clean_text_list(tasks + extracted)
            warnings.append(
                f"Cluster {esco_id}: tasks had {before_n}<3 upstream; extracted {len(extracted)} responsibility sentences from description."
            )

    ensure_min_items(tasks, min_items=3, warn_name="tasks", cluster_id=esco_id, warnings=warnings)

    embedding_text = build_embedding_text(
        title=title,
        description=description,
        alternative_titles=alt_titles,
        skills=skills,
        required_skills=required_skills,
        optional_skills=optional_skills,
        tasks=tasks,
        max_len=max_embedding_len,
    )

    return {
        "id": esco_id,
        "esco_id": esco_id,
        "title": title,
        "alternative_titles": alt_titles,
        "description": description,
        "occupation_group": occupation_group,
        "occupation_group_members": occupation_group_members,
        "cluster_size": len(rows),
        "embedding_text": clean_text(embedding_text),
        "skills": skills,
        "required_skills": required_skills,
        "optional_skills": optional_skills,
        "tasks": tasks,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build final deduplicated cluster-based roles dataset.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--max-embedding-length", type=int, default=1200)
    args = parser.parse_args()

    if not args.input.exists():
        hint = ""
        candidate = Path(r"C:\Users\nicol\Documents\7.Development\final_roles_cluster_harmonized.json")
        if candidate.exists():
            hint = f"\nHint: you can run with --input \"{candidate}\" (row-level format is also supported)."
        print(f"ERROR: input file does not exist: {args.input}{hint}", file=sys.stderr)
        sys.exit(1)

    data = load_data(args.input)

    warnings: List[str] = []
    skipped: List[Tuple[str, str]] = []
    seen_ids: set[str] = set()

    roles: List[Dict[str, Any]] = []

    # Input format A: cluster-level JSON with top-level `clusters` list.
    if isinstance(data, dict) and isinstance(data.get("clusters"), list):
        clusters = data["clusters"]
        print(f"Input format detected: cluster-level (clusters={len(clusters)})")
        clusters_created = 0
        for cluster in clusters:
            role = process_cluster(
                cluster,
                max_embedding_len=args.max_embedding_length,
                warnings=warnings,
                skipped=skipped,
                seen_ids=seen_ids,
            )
            if role is None:
                continue
            role = clean_role_after_cluster_creation(role)
            if not role.get("id") or not role.get("title") or not role.get("description"):
                skipped.append((role.get("id") or "unknown", "post_clean_missing_core_fields"))
                continue
            roles.append(role)
            clusters_created += 1

        # Optional: merge in roles that were not assigned to any cluster.
        unclustered_roles_in = maybe_get_unclustered_roles(data)
        unclustered_added = 0
        for r in unclustered_roles_in:
            role = process_unclustered_role(
                r,
                max_embedding_len=args.max_embedding_length,
                warnings=warnings,
                skipped=skipped,
                seen_ids=seen_ids,
            )
            if role is None:
                continue
            role = clean_role_after_cluster_creation(role)
            roles.append(role)
            unclustered_added += 1

    # Input format B: row-level JSON array (e.g. final_roles_cluster_harmonized.json).
    else:
        if not isinstance(data, list):
            print("ERROR: unsupported input JSON shape. Expected dict with 'clusters' or a list of roles.", file=sys.stderr)
            sys.exit(1)
        rows = [x for x in data if isinstance(x, dict)]
        print(f"Input format detected: row-level (rows={len(rows)})")
        groups = _group_rows_by_esco_id(rows)
        total_groups = len(groups)
        print(f"Unique ESCO ids found: {total_groups}")
        clusters_created = 0
        unclustered_added = 0  # tracked implicitly; all groups become roles
        for esco_id, group_rows in groups.items():
            role = process_row_group(
                esco_id,
                group_rows,
                max_embedding_len=args.max_embedding_length,
                warnings=warnings,
                skipped=skipped,
                seen_ids=seen_ids,
            )
            if role is None:
                continue
            role = clean_role_after_cluster_creation(role)
            roles.append(role)
            clusters_created += 1

        # No separate unclustered addition needed; singletons are included via groups.

    # Sort roles by title alphabetically (deterministic)
    roles.sort(key=lambda x: (clean_text(x.get("title")).lower(), clean_text(x.get("id"))))

    out = {
        "version": 1,
        "role_count": len(roles),
        "roles": roles,
    }

    # Logging
    print(f"Roles created: {len(roles)}")
    if 'clusters_created' in locals():
        print(f"Roles created from clusters/ids: {clusters_created}")
    if 'unclustered_added' in locals():
        print(f"Roles added from unclustered input: {unclustered_added}")

    if skipped:
        print(f"Clusters skipped: {len(skipped)}")
        # Print a small representative sample.
        for i, (cluster_key, reason) in enumerate(skipped[:25], start=1):
            print(f"  {i}. {cluster_key}: {reason}")
        if len(skipped) > 25:
            print(f"  … and {len(skipped) - 25} more")
    else:
        print("Clusters skipped: 0")

    if warnings:
        # Basic validation report at end.
        print(f"Warnings: {len(warnings)}")
        for w in warnings[:25]:
            print(f"  - {w}")
        if len(warnings) > 25:
            print(f"  … and {len(warnings) - 25} more")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f"Output written to: {args.output}")
    print(f"Total output roles: {len(roles)}")


if __name__ == "__main__":
    main()

