import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


_DEV_ROOT = Path(__file__).resolve().parent
DEFAULT_ESCO_PATH = Path(r"C:\Users\nicol\Documents\7.Development\mapping_representation_final.json")
DEFAULT_ONET_PATH = Path(r"C:\Users\nicol\Documents\7.Development\onet_prepared.json")
DEFAULT_MAPPING_PATH = Path(r"C:\Users\nicol\Documents\7.Development\esco_onet_mapping_final.json")
DEFAULT_OUTPUT_PATH = Path(r"C:\Users\nicol\Documents\7.Development\final_roles.json")
DEFAULT_ESCO_SKILLS_CSV = _DEV_ROOT / "ESCO dataset - v1.2.0 - classification - en - csv" / "skills_en.csv"
DEFAULT_ESCO_OCC_SKILL_REL_CSV = _DEV_ROOT / "ESCO dataset - v1.2.0 - classification - en - csv" / "occupationSkillRelations_en.csv"

# Base weights for ESCO skills from official relations (before cluster boost).
ESCO_ESSENTIAL_SKILL_WEIGHT = 0.72
ESCO_OPTIONAL_SKILL_WEIGHT = 0.55
# When the same skill label appears across multiple ESCO URIs in a cluster, nudge weight slightly.
ESCO_CLUSTER_SKILL_BOOST = 0.04

DESCRIPTION_MAX_CHARS = 1200
MIN_SENTENCE_CHARS = 15

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "their",
    "this",
    "to",
    "with",
}


def load_data(esco_path: Path, onet_path: Path, mapping_path: Path) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    with esco_path.open("r", encoding="utf-8") as f:
        esco_roles = json.load(f)
    with onet_path.open("r", encoding="utf-8") as f:
        onet_roles = json.load(f)
    with mapping_path.open("r", encoding="utf-8") as f:
        mappings = json.load(f)
    return esco_roles, onet_roles, mappings


def load_esco_skill_uri_labels(skills_csv: Path) -> Dict[str, str]:
    if not skills_csv.exists():
        return {}
    df = pd.read_csv(skills_csv, dtype=str, keep_default_na=False, encoding="utf-8")
    if "conceptUri" not in df.columns or "preferredLabel" not in df.columns:
        return {}
    out: Dict[str, str] = {}
    for _, row in df.iterrows():
        uri = normalize_text(row.get("conceptUri"))
        label = normalize_text(row.get("preferredLabel"))
        if uri and label:
            out[uri] = label
    return out


def load_per_occupation_esco_skill_labels(
    relations_csv: Path,
    uri_to_label: Dict[str, str],
) -> Dict[str, Dict[str, List[str]]]:
    """
    occupationUri -> {"essential": [preferredLabel, ...], "optional": [...]}
    Labels are deduped per occupation and relation type (by normalized name).
    """
    if not relations_csv.exists() or not uri_to_label:
        return {}
    df = pd.read_csv(relations_csv, dtype=str, keep_default_na=False, encoding="utf-8")
    needed = {"occupationUri", "relationType", "skillUri"}
    if not needed.issubset(df.columns):
        return {}

    buckets: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: {"essential": [], "optional": []})
    for _, row in df.iterrows():
        occ = normalize_text(row.get("occupationUri"))
        rel = normalize_text(row.get("relationType")).lower()
        skill_uri = normalize_text(row.get("skillUri"))
        if not occ or not skill_uri:
            continue
        label = uri_to_label.get(skill_uri)
        if not label:
            continue
        if rel == "essential":
            buckets[occ]["essential"].append(label)
        elif rel == "optional":
            buckets[occ]["optional"].append(label)

    def dedupe_preserve_order(labels: List[str]) -> List[str]:
        seen = set()
        out: List[str] = []
        for lab in labels:
            nk = normalize_key(lab)
            if not nk or nk in seen:
                continue
            seen.add(nk)
            out.append(lab)
        return out

    return {occ: {"essential": dedupe_preserve_order(v["essential"]), "optional": dedupe_preserve_order(v["optional"])} for occ, v in buckets.items()}


def _merge_esco_skill_names_across_uris(
    occupation_uris: List[str],
    per_occ: Dict[str, Dict[str, List[str]]],
    relation_key: str,
    base_weight: float,
) -> List[Dict[str, Any]]:
    """
    Union ESCO skills linked to any of occupation_uris; boost weight slightly when the same
    normalized label appears under multiple occupation URIs (cluster merge signal).
    """
    by_norm: Dict[str, Dict[str, Any]] = {}
    for occ in occupation_uris:
        labels = (per_occ.get(occ) or {}).get(relation_key) or []
        for lab in labels:
            nk = normalize_key(lab)
            if not nk:
                continue
            if nk not in by_norm:
                by_norm[nk] = {"name": lab, "base_w": base_weight, "occs": {occ}}
            else:
                by_norm[nk]["occs"].add(occ)
                by_norm[nk]["base_w"] = max(by_norm[nk]["base_w"], base_weight)

    merged: List[Dict[str, Any]] = []
    for info in by_norm.values():
        n_occ = len(info["occs"])
        boost = ESCO_CLUSTER_SKILL_BOOST * max(0, n_occ - 1)
        w = float(np.clip(info["base_w"] + boost, 0.0, 1.0))
        merged.append({"name": info["name"], "weight": w})
    merged.sort(key=lambda x: (-x["weight"], x["name"].lower()))
    return merged


def enrich_esco_role_with_csv_skills(
    esco_role: Dict[str, Any],
    per_occ: Dict[str, Dict[str, List[str]]],
) -> Dict[str, Any]:
    """
    Attach ESCO `skills` (essential) and `optional_skills` from official ESCO CSVs so
    merge_skills can combine them with O*NET.
    """
    if not per_occ:
        return esco_role
    occ_uris = get_esco_ids(esco_role)
    if not occ_uris:
        return esco_role

    essential = _merge_esco_skill_names_across_uris(
        occ_uris, per_occ, "essential", ESCO_ESSENTIAL_SKILL_WEIGHT
    )
    optional = _merge_esco_skill_names_across_uris(
        occ_uris, per_occ, "optional", ESCO_OPTIONAL_SKILL_WEIGHT
    )
    if not essential and not optional:
        return esco_role

    enriched = dict(esco_role)
    if essential:
        enriched["skills"] = essential
    if optional:
        enriched["optional_skills"] = optional
    return enriched


def normalize_text(text: Optional[str]) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_key(text: Optional[str]) -> str:
    text = normalize_text(text).lower()
    text = re.sub(r"[^a-z0-9\s\-/]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def split_sentences(text: str) -> List[str]:
    if not text:
        return []
    chunks = re.split(r"(?<=[.!?])\s+", text.strip())
    return [normalize_text(x) for x in chunks if normalize_text(x)]


def dedupe_sentences(sentences: List[str]) -> List[str]:
    seen = set()
    merged = []
    for s in sentences:
        key = normalize_key(s)
        if len(key) < MIN_SENTENCE_CHARS:
            continue
        if key not in seen:
            seen.add(key)
            merged.append(s)
    return merged


def merge_titles(esco_role: Dict[str, Any], onet_role: Optional[Dict[str, Any]]) -> Tuple[str, List[str]]:
    primary_title = (
        normalize_text(esco_role.get("title"))
        or normalize_text(esco_role.get("esco_title"))
        or normalize_text(esco_role.get("preferredLabel"))
        or "Unknown role"
    )

    alternatives = esco_role.get("alternative_titles") or []
    if not alternatives:
        alt_labels = esco_role.get("altLabels")
        if isinstance(alt_labels, str):
            alternatives = [x for x in alt_labels.splitlines() if normalize_text(x)]
        elif isinstance(alt_labels, list):
            alternatives = alt_labels

    alt_titles = [normalize_text(x) for x in alternatives if normalize_text(x)]

    if onet_role:
        onet_title = normalize_text(onet_role.get("title"))
        if onet_title and normalize_key(onet_title) not in {normalize_key(primary_title), *(normalize_key(t) for t in alt_titles)}:
            alt_titles.append(onet_title)

    deduped = []
    seen = set()
    for t in alt_titles:
        key = normalize_key(t)
        if key and key not in seen:
            seen.add(key)
            deduped.append(t)
    return primary_title, deduped


def maybe_llm_merge_description(sentences: List[str], use_llm: bool) -> List[str]:
    if not use_llm:
        return sentences

    # Optional hook point for environments that have an LLM client configured.
    # Keeping default behavior deterministic and safe for local execution.
    _ = os.getenv("OPENAI_API_KEY")
    return sentences


def merge_descriptions(
    esco_role: Dict[str, Any],
    onet_role: Optional[Dict[str, Any]],
    use_llm: bool = False,
    max_chars: int = DESCRIPTION_MAX_CHARS,
) -> str:
    esco_desc = normalize_text(
        esco_role.get("representative_description")
        or esco_role.get("description")
        or esco_role.get("definition")
        or esco_role.get("scopeNote")
    )
    onet_desc = normalize_text(onet_role.get("description") if onet_role else "")

    base_sentences = split_sentences(esco_desc) + split_sentences(onet_desc)
    base_sentences = dedupe_sentences(base_sentences)
    merged_sentences = maybe_llm_merge_description(base_sentences, use_llm=use_llm)

    description = normalize_text(" ".join(merged_sentences))
    if len(description) > max_chars:
        description = description[: max_chars - 1].rstrip() + "..."
    return description


def _extract_esco_skill_candidates(esco_role: Dict[str, Any]) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    raw_skills = []
    for key in ("skills", "essential_skills", "optional_skills"):
        values = esco_role.get(key)
        if isinstance(values, list):
            raw_skills.extend(values)

    for item in raw_skills:
        if isinstance(item, str):
            name = normalize_text(item)
            weight = 0.6
        elif isinstance(item, dict):
            name = normalize_text(item.get("name") or item.get("label") or item.get("skill"))
            weight = float(item.get("weight", 0.6))
        else:
            name = ""
            weight = 0.6
        if name:
            candidates.append({"name": name, "weight": weight, "source": ["ESCO"]})
    return candidates


def _merge_skill_entry(existing: Dict[str, Any], new_weight: float, new_source: str, in_both_boost: float) -> Dict[str, Any]:
    old_sources = set(existing["source"])
    old_weight = float(existing["weight"])

    combined_sources = old_sources | {new_source}
    combined_weight = max(old_weight, new_weight)
    if len(combined_sources) > 1 and len(old_sources) == 1:
        combined_weight = min(1.0, combined_weight + in_both_boost)

    existing["source"] = sorted(combined_sources)
    existing["weight"] = float(np.clip(combined_weight, 0.0, 1.0))
    return existing


def merge_skills(
    esco_role: Dict[str, Any],
    onet_role: Optional[Dict[str, Any]],
    max_skills: Optional[int] = None,
    in_both_boost: float = 0.1,
) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}

    for skill in _extract_esco_skill_candidates(esco_role):
        key = normalize_key(skill["name"])
        if not key:
            continue
        merged[key] = {
            "name": normalize_text(skill["name"]),
            "weight": float(np.clip(skill["weight"], 0.0, 1.0)),
            "source": ["ESCO"],
        }

    if onet_role:
        for item in onet_role.get("skills", []):
            if isinstance(item, str):
                name = normalize_text(item)
                weight = 0.6
            else:
                name = normalize_text(item.get("name"))
                weight = float(item.get("importance", 0.6))
            key = normalize_key(name)
            if not key:
                continue
            if key in merged:
                merged[key] = _merge_skill_entry(merged[key], weight, "ONET", in_both_boost)
            else:
                merged[key] = {
                    "name": name,
                    "weight": float(np.clip(weight, 0.0, 1.0)),
                    "source": ["ONET"],
                }

    sorted_skills = sorted(
        merged.values(),
        key=lambda x: (-x["weight"], x["name"].lower()),
    )
    if max_skills is None or max_skills <= 0:
        return sorted_skills
    return sorted_skills[:max_skills]


def _build_esco_relation_sets(
    esco_ids: List[str],
    per_occupation_esco_skills: Optional[Dict[str, Dict[str, List[str]]]],
) -> Tuple[set[str], set[str]]:
    optional_keys: set[str] = set()
    essential_keys: set[str] = set()
    if not per_occupation_esco_skills:
        return optional_keys, essential_keys
    for occ in esco_ids:
        rel = per_occupation_esco_skills.get(occ) or {}
        for lab in rel.get("optional", []):
            nk = normalize_key(lab)
            if nk:
                optional_keys.add(nk)
        for lab in rel.get("essential", []):
            nk = normalize_key(lab)
            if nk:
                essential_keys.add(nk)
    return optional_keys, essential_keys


def split_and_cap_skills(
    skills: List[Dict[str, Any]],
    *,
    esco_optional_keys: set[str],
    esco_essential_keys: set[str],
    onet_threshold: float,
    max_required_skills: int,
    max_optional_skills: int,
) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
    required_names: List[str] = []
    optional_names: List[str] = []
    required_seen: set[str] = set()
    optional_seen: set[str] = set()
    selected_skill_dicts: List[Dict[str, Any]] = []
    selected_seen: set[str] = set()

    for skill in skills:
        name = normalize_text(skill.get("name"))
        if not name:
            continue
        nk = normalize_key(name)
        if not nk:
            continue

        src = skill.get("source")
        sources = {normalize_text(x).upper() for x in src if normalize_text(x)} if isinstance(src, list) else set()
        has_esco = "ESCO" in sources
        has_onet = "ONET" in sources
        try:
            weight = float(skill.get("weight", 0.0))
        except (TypeError, ValueError):
            weight = 0.0

        decisions: set[str] = set()
        if has_esco:
            if nk in esco_optional_keys:
                decisions.add("optional")
            if nk in esco_essential_keys:
                decisions.add("required")
        if has_onet:
            if weight >= onet_threshold:
                decisions.add("required")
            else:
                decisions.add("optional")
        if not decisions:
            # Fallback for items without explicit source signals.
            if weight >= onet_threshold:
                decisions.add("required")
            else:
                decisions.add("optional")

        # Deterministic tie-break: required wins conflicts.
        bucket = "required" if "required" in decisions else "optional"
        if bucket == "required":
            if nk in required_seen or len(required_names) >= max_required_skills:
                continue
            required_seen.add(nk)
            required_names.append(name)
        else:
            if nk in optional_seen or len(optional_names) >= max_optional_skills:
                continue
            optional_seen.add(nk)
            optional_names.append(name)

        if nk not in selected_seen:
            selected_seen.add(nk)
            selected_skill_dicts.append(skill)

    return selected_skill_dicts, required_names, optional_names


def merge_tasks(onet_role: Optional[Dict[str, Any]], max_tasks: int = 12) -> List[str]:
    if not onet_role:
        return []
    tasks = [normalize_text(t) for t in onet_role.get("tasks", []) if normalize_text(t)]
    deduped = dedupe_sentences(tasks)
    return deduped[:max_tasks]


def build_embedding_text(title: str, alternative_titles: List[str], description: str, skills: List[Dict[str, Any]], tasks: List[str]) -> str:
    skill_names = [s["name"] for s in skills]
    parts = [f"{title}."]
    if alternative_titles:
        parts.append(f"Also known as: {', '.join(alternative_titles)}.")
    if description:
        parts.append(description)
    if skill_names:
        parts.append(f"Key skills: {', '.join(skill_names)}.")
    if tasks:
        parts.append(f"Tasks: {' '.join(tasks)}")
    return normalize_text(" ".join(parts))


def build_feature_vectors(skills: List[Dict[str, Any]], tasks: List[str]) -> Dict[str, Dict[str, float]]:
    skill_vector = {normalize_key(s["name"]): float(s["weight"]) for s in skills}
    task_vector = {normalize_key(t): 1.0 for t in tasks}
    return {"skill_vector": skill_vector, "task_vector": task_vector}


def build_mapping_index(mappings: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    by_esco_id: Dict[str, Dict[str, Any]] = {}
    for row in mappings:
        esco_id = normalize_text(row.get("esco_id"))
        if esco_id:
            by_esco_id[esco_id] = row
    return by_esco_id


def _listify(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [normalize_text(x) for x in value if normalize_text(x)]
    if isinstance(value, str):
        if "\n" in value:
            return [normalize_text(x) for x in value.splitlines() if normalize_text(x)]
        return [normalize_text(value)] if normalize_text(value) else []
    return []


def get_esco_ids(esco_role: Dict[str, Any]) -> List[str]:
    ids: List[str] = []
    for key in ("source_ids", "merged_ids"):
        ids.extend(_listify(esco_role.get(key)))

    for key in ("canonical_id", "conceptUri"):
        v = normalize_text(esco_role.get(key))
        if v:
            ids.append(v)

    out = []
    seen = set()
    for item in ids:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def get_role_id(esco_role: Dict[str, Any], idx: int) -> str:
    for key in ("id", "canonical_id", "conceptUri", "preferredLabel"):
        value = normalize_text(esco_role.get(key))
        if value:
            return value
    return f"role_{idx:05d}"


def get_occupation_group(esco_role: Dict[str, Any]) -> str:
    for key in ("occupation_group", "occupationGroup", "iscoGroup", "isco_group", "isco"):
        raw = esco_role.get(key)
        value = normalize_text(str(raw) if raw is not None else "")
        if value:
            return value
    return ""


def is_merged_cluster(esco_role: Dict[str, Any]) -> bool:
    cluster_size = esco_role.get("cluster_size")
    if isinstance(cluster_size, (int, float)) and cluster_size > 1:
        return True
    merged_ids = _listify(esco_role.get("merged_ids"))
    return len(merged_ids) > 1


def build_onet_index(onet_roles: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    by_onet_id: Dict[str, Dict[str, Any]] = {}
    for row in onet_roles:
        onet_id = normalize_text(row.get("onet_id"))
        if onet_id:
            by_onet_id[onet_id] = row
    return by_onet_id


def find_mapping_for_esco_role(esco_role: Dict[str, Any], mapping_index: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    candidates = get_esco_ids(esco_role)

    best = None
    best_score = -1.0
    for cid in candidates:
        m = mapping_index.get(cid)
        if not m:
            continue
        score = float(m.get("confidence_score", 0.0))
        if score > best_score:
            best = m
            best_score = score
    return best


def create_unified_roles(
    esco_roles: List[Dict[str, Any]],
    onet_roles: List[Dict[str, Any]],
    mappings: List[Dict[str, Any]],
    use_llm: bool,
    max_skills: int,
    max_required_skills: int,
    max_optional_skills: int,
    onet_threshold: float,
    max_tasks: int,
    per_occupation_esco_skills: Optional[Dict[str, Dict[str, List[str]]]] = None,
) -> List[Dict[str, Any]]:
    mapping_index = build_mapping_index(mappings)
    onet_index = build_onet_index(onet_roles)

    unified = []
    for idx, esco_role in enumerate(esco_roles):
        esco_role = enrich_esco_role_with_csv_skills(esco_role, per_occupation_esco_skills or {})
        selected_mapping = find_mapping_for_esco_role(esco_role, mapping_index)
        onet_role = None
        onet_reference = None

        if selected_mapping:
            onet_id = normalize_text(selected_mapping.get("onet_id"))
            onet_role = onet_index.get(onet_id)
            onet_reference = {
                "onet_id": onet_id,
                "onet_title": normalize_text(selected_mapping.get("onet_title")),
                "confidence_score": float(np.clip(selected_mapping.get("confidence_score", 0.0), 0.0, 1.0)),
            }

        title, alternative_titles = merge_titles(esco_role, onet_role)
        description = merge_descriptions(esco_role, onet_role, use_llm=use_llm)
        source_ids = get_esco_ids(esco_role)
        pre_split_max_skills = max_skills if max_skills > 0 else None
        merged_skills = merge_skills(esco_role, onet_role, max_skills=pre_split_max_skills)
        esco_optional_keys, esco_essential_keys = _build_esco_relation_sets(
            source_ids, per_occupation_esco_skills
        )
        skills, required_skills, optional_skills = split_and_cap_skills(
            merged_skills,
            esco_optional_keys=esco_optional_keys,
            esco_essential_keys=esco_essential_keys,
            onet_threshold=onet_threshold,
            max_required_skills=max_required_skills,
            max_optional_skills=max_optional_skills,
        )
        tasks = merge_tasks(onet_role, max_tasks=max_tasks)
        vectors = build_feature_vectors(skills, tasks)
        embedding_text = build_embedding_text(title, alternative_titles, description, skills, tasks)

        role_id = get_role_id(esco_role, idx)

        unified_role = {
            "id": role_id,
            "title": title,
            "alternative_titles": alternative_titles,
            "description": description,
            "occupation_group": get_occupation_group(esco_role),
            "skills": skills,
            "required_skills": required_skills,
            "optional_skills": optional_skills,
            "tasks": tasks,
            "embedding_text": embedding_text,
            "features": vectors,
            "onet_reference": onet_reference,
            "provenance": {
                "esco_ids": source_ids,
                "merged_from_cluster": is_merged_cluster(esco_role),
            },
        }
        unified.append(unified_role)

    return unified


def save_output(output_path: Path, rows: List[Dict[str, Any]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)


def print_summary(rows: List[Dict[str, Any]]) -> None:
    df = pd.DataFrame(
        {
            "skills_count": [len(r.get("skills", [])) for r in rows],
            "has_onet": [r.get("onet_reference") is not None for r in rows],
        }
    )
    total_roles = int(len(rows))
    avg_skills = float(df["skills_count"].mean()) if not df.empty else 0.0
    mapped_pct = float(df["has_onet"].mean() * 100.0) if not df.empty else 0.0

    print("Build complete")
    print(f"- Final roles: {total_roles}")
    print(f"- Avg skills per role: {avg_skills:.2f}")
    print(f"- % with O*NET mapping: {mapped_pct:.2f}%")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build final unified ESCO + O*NET role objects.")
    parser.add_argument("--esco_path", type=Path, default=DEFAULT_ESCO_PATH)
    parser.add_argument("--onet_path", type=Path, default=DEFAULT_ONET_PATH)
    parser.add_argument("--mapping_path", type=Path, default=DEFAULT_MAPPING_PATH)
    parser.add_argument("--output_path", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--use_llm", action="store_true", help="Enable optional LLM merging hook for descriptions.")
    parser.add_argument(
        "--max_skills",
        type=int,
        default=0,
        help="Optional pre-split cap for merged skills. Use 0 for no pre-split cap.",
    )
    parser.add_argument("--max_required_skills", type=int, default=25)
    parser.add_argument("--max_optional_skills", type=int, default=20)
    parser.add_argument(
        "--onet_threshold",
        type=float,
        default=0.6,
        help="Threshold used for ONET required vs optional split.",
    )
    parser.add_argument("--max_tasks", type=int, default=12)
    parser.add_argument(
        "--esco_skills_csv",
        type=Path,
        default=DEFAULT_ESCO_SKILLS_CSV,
        help="ESCO skills_en.csv (conceptUri -> preferredLabel).",
    )
    parser.add_argument(
        "--esco_occ_skill_relations_csv",
        type=Path,
        default=DEFAULT_ESCO_OCC_SKILL_REL_CSV,
        help="ESCO occupationSkillRelations_en.csv.",
    )
    parser.add_argument(
        "--skip_esco_skill_csv",
        action="store_true",
        help="Do not load ESCO CSVs; skills come only from JSON + O*NET.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    esco_roles, onet_roles, mappings = load_data(args.esco_path, args.onet_path, args.mapping_path)

    per_occ: Dict[str, Dict[str, List[str]]] = {}
    if not args.skip_esco_skill_csv:
        uri_labels = load_esco_skill_uri_labels(args.esco_skills_csv)
        per_occ = load_per_occupation_esco_skill_labels(args.esco_occ_skill_relations_csv, uri_labels)
        if not per_occ:
            print(
                "Warning: ESCO occupation-skill index is empty "
                f"(check paths: {args.esco_skills_csv}, {args.esco_occ_skill_relations_csv})."
            )
        else:
            print(f"Loaded ESCO occupation-skill links for {len(per_occ)} occupations.")

    unified_rows = create_unified_roles(
        esco_roles=esco_roles,
        onet_roles=onet_roles,
        mappings=mappings,
        use_llm=args.use_llm,
        max_skills=args.max_skills,
        max_required_skills=args.max_required_skills,
        max_optional_skills=args.max_optional_skills,
        onet_threshold=args.onet_threshold,
        max_tasks=args.max_tasks,
        per_occupation_esco_skills=per_occ if per_occ else None,
    )
    save_output(args.output_path, unified_rows)
    print_summary(unified_rows)


if __name__ == "__main__":
    main()
