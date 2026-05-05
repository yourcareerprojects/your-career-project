"""
Split weighted `skills` into `required_skills` and `optional_skills`.

Classification logic:
  - ESCO-sourced skills:
      * use ESCO source-level optional labels from occupationSkillRelations_en.csv
      * optional if relationType=optional, required if relationType=essential
  - ONET-sourced skills:
      * required if weight >= threshold, optional otherwise
  - Mixed ESCO+ONET skills:
      * combine both source signals (ESCO relation + ONET threshold)
      * if signals conflict, prefer required

Applies in-place to one or more JSON files. Supports:
  1) top-level list of roles
  2) top-level object with `roles` list
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple


DEFAULT_FILES = [
    Path(r"C:\Users\nicol\Documents\7.Development\final_roles.json"),
    Path(r"C:\Users\nicol\Documents\7.Development\final_roles_refined.json"),
    Path(r"C:\Users\nicol\Documents\7.Development\final_roles_cluster_harmonized.json"),
]

DEFAULT_ESCO_SKILLS_CSV = Path(
    r"C:\Users\nicol\Documents\7.Development\ESCO dataset - v1.2.0 - classification - en - csv\skills_en.csv"
)
DEFAULT_ESCO_OCC_REL_CSV = Path(
    r"C:\Users\nicol\Documents\7.Development\ESCO dataset - v1.2.0 - classification - en - csv\occupationSkillRelations_en.csv"
)


def normalize_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def normalize_key(value: Any) -> str:
    text = normalize_text(value).lower()
    out_chars: List[str] = []
    for ch in text:
        if ch.isalnum() or ch in {" ", "-", "/"}:
            out_chars.append(ch)
        else:
            out_chars.append(" ")
    text = "".join(out_chars)
    return " ".join(text.split())


def unique_preserve(items: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        key = item.lower()
        if not item or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _load_skill_uri_to_label(skills_csv: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not skills_csv.exists():
        return out
    with skills_csv.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            uri = normalize_text(row.get("conceptUri"))
            label = normalize_text(row.get("preferredLabel"))
            if uri and label:
                out[uri] = label
    return out


def _load_esco_optional_map(
    occ_rel_csv: Path,
    uri_to_label: Dict[str, str],
) -> Dict[str, Dict[str, Set[str]]]:
    """
    Returns:
      occupationUri -> {
        "essential": {normalized skill label, ...},
        "optional":  {normalized skill label, ...}
      }
    """
    out: Dict[str, Dict[str, Set[str]]] = {}
    if not occ_rel_csv.exists():
        return out
    with occ_rel_csv.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            occ = normalize_text(row.get("occupationUri"))
            rel = normalize_text(row.get("relationType")).lower()
            skill_uri = normalize_text(row.get("skillUri"))
            if not occ or not rel or not skill_uri:
                continue
            label = uri_to_label.get(skill_uri)
            if not label:
                continue
            nk = normalize_key(label)
            if not nk:
                continue
            if occ not in out:
                out[occ] = {"essential": set(), "optional": set()}
            if rel == "optional":
                out[occ]["optional"].add(nk)
            elif rel == "essential":
                out[occ]["essential"].add(nk)
    return out


def _get_role_esco_ids(role: Dict[str, Any]) -> List[str]:
    ids: List[str] = []
    prov = role.get("provenance")
    if isinstance(prov, dict):
        esco_ids = prov.get("esco_ids")
        if isinstance(esco_ids, list):
            for x in esco_ids:
                v = normalize_text(x)
                if v:
                    ids.append(v)
    rid = normalize_text(role.get("id"))
    if rid:
        ids.append(rid)
    out: List[str] = []
    seen = set()
    for x in ids:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def split_skills(
    role: Dict[str, Any],
    threshold: float,
    esco_rel_map: Dict[str, Dict[str, Set[str]]],
    max_required_skills: int,
    max_optional_skills: int,
) -> Tuple[int, int]:
    """
    Adds/updates:
      - required_skills: List[str]
      - optional_skills: List[str]
    Returns counts (required_count, optional_count)
    """
    required: List[str] = []
    optional: List[str] = []

    # Aggregate ESCO relation labels for all ESCO IDs represented by this row.
    role_esco_ids = _get_role_esco_ids(role)
    esco_optional_labels: Set[str] = set()
    esco_essential_labels: Set[str] = set()
    for esco_id in role_esco_ids:
        rel = esco_rel_map.get(esco_id)
        if not rel:
            continue
        esco_optional_labels |= rel.get("optional", set())
        esco_essential_labels |= rel.get("essential", set())

    skills = role.get("skills", [])
    if isinstance(skills, list):
        for item in skills:
            if isinstance(item, dict):
                name = normalize_text(item.get("name") or item.get("skill") or item.get("label"))
                try:
                    weight = float(item.get("weight", item.get("importance", 0.0)))
                except (TypeError, ValueError):
                    weight = 0.0
                sources = item.get("source")
                if isinstance(sources, list):
                    src = {normalize_text(x).upper() for x in sources if normalize_text(x)}
                else:
                    src = set()
            elif isinstance(item, str):
                # If skills are plain strings and no weight exists, treat as required.
                name = normalize_text(item)
                weight = threshold
                src = set()
            else:
                continue

            if not name:
                continue

            nk = normalize_key(name)
            has_onet = "ONET" in src
            has_esco = "ESCO" in src

            # Combine source-specific signals.
            decisions: Set[str] = set()

            if has_esco:
                if nk in esco_optional_labels:
                    decisions.add("optional")
                if nk in esco_essential_labels:
                    decisions.add("required")

            if has_onet:
                if weight >= threshold:
                    decisions.add("required")
                else:
                    decisions.add("optional")

            if "required" in decisions:
                # deterministic tie-break for conflicts: required wins
                required.append(name)
            elif "optional" in decisions:
                optional.append(name)
            else:
                if weight >= threshold:
                    required.append(name)
                else:
                    optional.append(name)

    role["required_skills"] = unique_preserve(required)[:max_required_skills]
    role["optional_skills"] = unique_preserve(optional)[:max_optional_skills]
    return len(role["required_skills"]), len(role["optional_skills"])


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def process_file(
    path: Path,
    threshold: float,
    esco_rel_map: Dict[str, Dict[str, Set[str]]],
    max_required_skills: int,
    max_optional_skills: int,
) -> Dict[str, int]:
    data = load_json(path)

    if isinstance(data, dict) and isinstance(data.get("roles"), list):
        roles = data["roles"]
    elif isinstance(data, list):
        roles = data
    else:
        raise ValueError(f"Unsupported JSON shape in {path}")

    updated = 0
    empty_skills = 0
    total_required = 0
    total_optional = 0
    for row in roles:
        if not isinstance(row, dict):
            continue
        req_n, opt_n = split_skills(
            row,
            threshold,
            esco_rel_map,
            max_required_skills=max_required_skills,
            max_optional_skills=max_optional_skills,
        )
        updated += 1
        total_required += req_n
        total_optional += opt_n
        if req_n + opt_n == 0:
            empty_skills += 1

    save_json(path, data)
    return {
        "updated_roles": updated,
        "empty_after_split": empty_skills,
        "required_total": total_required,
        "optional_total": total_optional,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Split weighted skills into required/optional skill lists.")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.6,
        help="Required/core threshold. required_skills if weight >= threshold.",
    )
    parser.add_argument(
        "--files",
        nargs="*",
        type=Path,
        default=DEFAULT_FILES,
        help="JSON files to update in-place.",
    )
    parser.add_argument(
        "--esco-skills-csv",
        type=Path,
        default=DEFAULT_ESCO_SKILLS_CSV,
        help="Path to ESCO skills_en.csv (conceptUri -> preferredLabel).",
    )
    parser.add_argument(
        "--esco-occ-skill-rel-csv",
        type=Path,
        default=DEFAULT_ESCO_OCC_REL_CSV,
        help="Path to ESCO occupationSkillRelations_en.csv.",
    )
    parser.add_argument(
        "--max-required-skills",
        type=int,
        default=25,
        help="Cap for required_skills list per role.",
    )
    parser.add_argument(
        "--max-optional-skills",
        type=int,
        default=20,
        help="Cap for optional_skills list per role.",
    )
    args = parser.parse_args()

    print(
        f"Using threshold: {args.threshold} | "
        f"max_required_skills={args.max_required_skills} | "
        f"max_optional_skills={args.max_optional_skills}"
    )
    print("Loading ESCO optional/essential relation map...")
    uri_to_label = _load_skill_uri_to_label(args.esco_skills_csv)
    esco_rel_map = _load_esco_optional_map(args.esco_occ_skill_rel_csv, uri_to_label)
    print(
        f"Loaded ESCO relation map for {len(esco_rel_map)} occupations "
        f"(skills map size: {len(uri_to_label)})."
    )

    for path in args.files:
        if not path.exists():
            print(f"[SKIP] Missing file: {path}")
            continue
        stats = process_file(
            path,
            args.threshold,
            esco_rel_map,
            max_required_skills=args.max_required_skills,
            max_optional_skills=args.max_optional_skills,
        )
        print(f"[OK] {path}")
        print(
            f"     roles={stats['updated_roles']} | "
            f"required_total={stats['required_total']} | "
            f"optional_total={stats['optional_total']} | "
            f"empty_after_split={stats['empty_after_split']}"
        )


if __name__ == "__main__":
    main()

