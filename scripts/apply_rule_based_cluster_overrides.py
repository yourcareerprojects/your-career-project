import json
from pathlib import Path
from typing import Dict, List, Set, Tuple

import pandas as pd


RULES: List[str] = [
    "import export specialist",
    "import export manager",
    "wholesale merchant",
    "leather",
    "specialised seller",
    "technical sales representative",
    "rental service representative",
    "shop manager",
    "control room operator",
]


def normalize_text(s: str) -> str:
    return str(s or "").strip().lower()


def cluster_members(cluster_payload: Dict) -> List[str]:
    canonical = cluster_payload.get("canonical_id")
    merged = cluster_payload.get("merged_ids", [])
    out: List[str] = []
    if isinstance(canonical, str) and canonical:
        out.append(canonical)
    if isinstance(merged, list):
        out.extend([m for m in merged if isinstance(m, str) and m])
    return out


def choose_canonical(ids: List[str], id_to_title: Dict[str, str]) -> str:
    # Prefer shorter preferred labels for readability/stability, then URI.
    return sorted(ids, key=lambda x: (len(id_to_title.get(x, "")), id_to_title.get(x, ""), x))[0]


def main() -> None:
    root = Path(r"c:\Users\nicol\Documents\7.Development")
    occ_path = root / r"ESCO dataset - v1.2.0 - classification - en - csv" / "occupations_en.csv"
    approved_path = root / "approved_clusters.json"
    if not approved_path.exists():
        approved_path = root / "approved_clusters_final.json"
    backup_path = root / f"{approved_path.stem}.before_rule_override.json"

    if not occ_path.exists():
        raise FileNotFoundError(f"Occupations CSV not found: {occ_path}")
    if not approved_path.exists():
        raise FileNotFoundError(f"Approved clusters file not found: {approved_path}")

    df = pd.read_csv(occ_path)
    if "conceptUri" not in df.columns or "preferredLabel" not in df.columns:
        raise KeyError("Expected columns conceptUri and preferredLabel in occupations_en.csv")

    with approved_path.open("r", encoding="utf-8") as f:
        approved = json.load(f)
    if not isinstance(approved, dict):
        raise ValueError("approved_clusters.json must be a JSON object.")

    # Keep a backup snapshot.
    with backup_path.open("w", encoding="utf-8") as f:
        json.dump(approved, f, ensure_ascii=False, indent=2)

    id_to_title: Dict[str, str] = {
        str(row["conceptUri"]): str(row["preferredLabel"] or "")
        for _, row in df.iterrows()
    }

    # Rule assignment with precedence: first matching rule wins.
    assigned_ids: Set[str] = set()
    rule_to_ids: Dict[str, List[str]] = {r: [] for r in RULES}

    for _, row in df.iterrows():
        occ_id = str(row["conceptUri"])
        title = normalize_text(row["preferredLabel"])
        if not occ_id or not title:
            continue

        for rule in RULES:
            if occ_id in assigned_ids:
                break
            if rule in title:
                rule_to_ids[rule].append(occ_id)
                assigned_ids.add(occ_id)
                break

    # IDs to override from manual clusters.
    overridden_ids: Set[str] = set()
    for ids in rule_to_ids.values():
        overridden_ids.update(ids)

    # Remove overridden IDs from existing clusters while preserving all other decisions.
    pruned: Dict[str, Dict] = {}
    for cluster_id, payload in approved.items():
        if not isinstance(payload, dict):
            continue
        members = cluster_members(payload)
        remaining = [m for m in members if m not in overridden_ids]

        # Keep only clusters with 2+ remaining members.
        if len(remaining) < 2:
            continue

        old_canonical = payload.get("canonical_id")
        if isinstance(old_canonical, str) and old_canonical in remaining:
            canonical = old_canonical
            merged = [m for m in remaining if m != canonical]
        else:
            canonical = remaining[0]
            merged = remaining[1:]

        pruned[cluster_id] = {
            "canonical_id": canonical,
            "merged_ids": merged,
        }

    # Add rule-based clusters (override behavior).
    for rule in RULES:
        members = sorted(set(rule_to_ids[rule]))
        if len(members) < 2:
            continue
        canonical = choose_canonical(members, id_to_title)
        merged = [m for m in members if m != canonical]
        cluster_id = f"rule_{rule.replace(' ', '_')}"
        pruned[cluster_id] = {
            "canonical_id": canonical,
            "merged_ids": merged,
        }

    with approved_path.open("w", encoding="utf-8") as f:
        json.dump(pruned, f, ensure_ascii=False, indent=2)

    print("Rule-based cluster overrides applied.")
    print(f"Backup written: {backup_path}")
    print(f"Updated file : {approved_path}")
    for rule in RULES:
        print(f"  {rule}: {len(rule_to_ids[rule])} matched occupations")


if __name__ == "__main__":
    main()

