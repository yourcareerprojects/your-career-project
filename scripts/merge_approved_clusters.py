import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple


def load_json_object(path: Path) -> Dict:
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return data


def cluster_members(payload: Dict) -> List[str]:
    canonical = payload.get("canonical_id")
    merged = payload.get("merged_ids", [])
    members: List[str] = []
    if isinstance(canonical, str) and canonical:
        members.append(canonical)
    if isinstance(merged, list):
        members.extend([m for m in merged if isinstance(m, str) and m])
    return members


def normalize_cluster(payload: Dict) -> Dict:
    members = cluster_members(payload)
    if len(members) < 2:
        return {}
    canonical = payload.get("canonical_id")
    if not isinstance(canonical, str) or canonical not in members:
        canonical = members[0]
    merged = [m for m in members if m != canonical]
    return {"canonical_id": canonical, "merged_ids": merged}


def merge_files(
    input_paths: List[Path],
) -> Tuple[Dict[str, Dict], List[Dict[str, str]], Dict[str, str]]:
    """
    Later files override earlier files at occupation-ID level.
    Returns:
      merged_clusters, conflict_rows, id_owner_map
    """
    merged: Dict[str, Dict] = {}
    # Maps occupation ID -> cluster_id currently owning that ID
    id_owner: Dict[str, str] = {}
    # Track conflicts for audit
    conflicts: List[Dict[str, str]] = []

    for input_path in input_paths:
        data = load_json_object(input_path)
        source_name = input_path.name

        for cluster_id, raw_payload in data.items():
            if not isinstance(raw_payload, dict):
                continue
            payload = normalize_cluster(raw_payload)
            if not payload:
                continue

            canonical = payload["canonical_id"]
            members = [canonical] + payload["merged_ids"]

            # Remove incoming members from their previous clusters (older precedence).
            for occ_id in members:
                old_cluster = id_owner.get(occ_id)
                if old_cluster is None:
                    continue
                if old_cluster == cluster_id:
                    continue

                old_payload = merged.get(old_cluster)
                if old_payload:
                    old_members = [old_payload["canonical_id"]] + old_payload["merged_ids"]
                    old_members = [m for m in old_members if m != occ_id]
                    if len(old_members) >= 2:
                        old_canonical = old_payload["canonical_id"]
                        if old_canonical not in old_members:
                            old_canonical = old_members[0]
                        merged[old_cluster] = {
                            "canonical_id": old_canonical,
                            "merged_ids": [m for m in old_members if m != old_canonical],
                        }
                    else:
                        merged.pop(old_cluster, None)

                conflicts.append(
                    {
                        "occupation_id": occ_id,
                        "from_cluster": old_cluster,
                        "to_cluster": cluster_id,
                        "source_file": source_name,
                    }
                )

            # Before writing new cluster version, detach any IDs that were previously in this cluster but
            # are now absent in incoming payload (to keep id_owner consistent).
            previous_payload = merged.get(cluster_id)
            if previous_payload:
                previous_members = [previous_payload["canonical_id"]] + previous_payload["merged_ids"]
                for prev_id in previous_members:
                    if prev_id not in members and id_owner.get(prev_id) == cluster_id:
                        del id_owner[prev_id]

            merged[cluster_id] = payload
            for occ_id in members:
                id_owner[occ_id] = cluster_id

    # Final cleanup: drop clusters reduced below 2 members (defensive).
    cleaned: Dict[str, Dict] = {}
    for cluster_id, payload in merged.items():
        members = [payload["canonical_id"]] + payload["merged_ids"]
        unique_members = []
        seen = set()
        for m in members:
            if m not in seen:
                seen.add(m)
                unique_members.append(m)
        if len(unique_members) < 2:
            continue
        canonical = payload["canonical_id"] if payload["canonical_id"] in unique_members else unique_members[0]
        cleaned[cluster_id] = {
            "canonical_id": canonical,
            "merged_ids": [m for m in unique_members if m != canonical],
        }

    return cleaned, conflicts, id_owner


def write_conflicts_csv(rows: List[Dict[str, str]], path: Path) -> None:
    import csv

    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["occupation_id", "from_cluster", "to_cluster", "source_file"],
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge multiple approved_clusters*.json files with precedence by order."
    )
    parser.add_argument(
        "--inputs",
        nargs="+",
        required=True,
        help="Input files in precedence order (later overrides earlier).",
    )
    parser.add_argument("--output", default="approved_clusters_final.json")
    parser.add_argument("--conflicts-csv", default="approved_clusters_merge_conflicts.csv")
    args = parser.parse_args()

    input_paths = [Path(p) for p in args.inputs]
    merged, conflicts, id_owner = merge_files(input_paths)

    output_path = Path(args.output)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    conflicts_path = Path(args.conflicts_csv)
    write_conflicts_csv(conflicts, conflicts_path)

    print("Merge complete.")
    print(f"  Output clusters : {output_path.resolve()}")
    print(f"  Total clusters  : {len(merged)}")
    print(f"  Occupations used: {len(id_owner)}")
    print(f"  Conflicts logged: {len(conflicts)}")
    print(f"  Conflicts CSV   : {conflicts_path.resolve()}")


if __name__ == "__main__":
    main()

