import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Set


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def build_manual_lookup(manual_approved: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    for row in manual_approved:
        esco_id = row.get("esco_id")
        if not esco_id:
            continue
        lookup[esco_id] = {
            "esco_id": esco_id,
            "esco_title": row.get("esco_title", ""),
            "onet_id": row.get("onet_id"),
            "onet_title": row.get("onet_title"),
            "confidence_score": row.get("confidence_score"),
            "scores": row.get("scores", {}),
            "method": "hybrid+manual",
            "alternatives": [
                {
                    "onet_id": alt.get("onet_id"),
                    "onet_title": alt.get("onet_title"),
                    "score": alt.get("score"),
                }
                for alt in row.get("alternatives", [])
            ],
        }
    return lookup


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge auto-accepted + manual-approved mappings")
    parser.add_argument(
        "--auto_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_nodups_review_auto_accepted.json"),
    )
    parser.add_argument(
        "--manual_approved_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_manual_review_approved.json"),
    )
    parser.add_argument(
        "--manual_queue_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_nodups_review_manual_review_queue.json"),
    )
    parser.add_argument(
        "--rejected_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_manual_review_rejected.json"),
    )
    parser.add_argument(
        "--final_output_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_onet_mapping_final.json"),
    )
    parser.add_argument(
        "--unmatched_output_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_onet_mapping_unmatched.json"),
    )
    parser.add_argument(
        "--summary_output_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_onet_mapping_final_summary.json"),
    )
    args = parser.parse_args()

    auto_accepted: List[Dict[str, Any]] = load_json(args.auto_path)
    manual_approved: List[Dict[str, Any]] = load_json(args.manual_approved_path)
    manual_queue: List[Dict[str, Any]] = load_json(args.manual_queue_path)
    rejected: List[Dict[str, Any]] = load_json(args.rejected_path) if args.rejected_path.exists() else []

    manual_lookup = build_manual_lookup(manual_approved)
    auto_lookup: Dict[str, Dict[str, Any]] = {
        row["esco_id"]: row for row in auto_accepted if row.get("esco_id")
    }

    # Manual approval overrides any auto mapping for the same ESCO id.
    merged_lookup = dict(auto_lookup)
    merged_lookup.update(manual_lookup)

    final_mappings = list(merged_lookup.values())
    final_mappings.sort(key=lambda x: (x.get("esco_title") or "", x.get("esco_id") or ""))

    queue_ids: Set[str] = {x.get("esco_id") for x in manual_queue if x.get("esco_id")}
    manual_approved_ids: Set[str] = set(manual_lookup.keys())
    rejected_ids: Set[str] = {x.get("esco_id") for x in rejected if x.get("esco_id")}

    # Skipped or rejected in manual queue => explicitly unmatched (no O*NET mapping).
    unmatched_ids = (queue_ids - manual_approved_ids) | rejected_ids
    queue_by_id = {x.get("esco_id"): x for x in manual_queue if x.get("esco_id")}
    unmatched = [
        {
            "esco_id": esco_id,
            "esco_title": queue_by_id.get(esco_id, {}).get("esco_title", ""),
            "status": "no_match",
            "reason": "manual_review_skipped_or_rejected",
        }
        for esco_id in sorted(unmatched_ids)
    ]

    summary = {
        "auto_accepted_count": len(auto_lookup),
        "manual_approved_count": len(manual_lookup),
        "final_matched_count": len(final_mappings),
        "manual_queue_count": len(queue_ids),
        "unmatched_count": len(unmatched),
    }

    save_json(args.final_output_path, final_mappings)
    save_json(args.unmatched_output_path, unmatched)
    save_json(args.summary_output_path, summary)

    print("Final merge completed")
    print(f"Final matched: {summary['final_matched_count']}")
    print(f"Unmatched: {summary['unmatched_count']}")
    print(f"Final file: {args.final_output_path}")


if __name__ == "__main__":
    main()
