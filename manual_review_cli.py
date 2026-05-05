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


def format_score(candidate: Dict[str, Any]) -> float:
    return float(candidate.get("score", candidate.get("confidence_score", 0.0)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Interactive manual review for ESCO -> O*NET queue")
    parser.add_argument(
        "--queue_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_review_manual_review_queue.json"),
    )
    parser.add_argument(
        "--decisions_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_manual_review_decisions.json"),
    )
    parser.add_argument(
        "--approved_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_manual_review_approved.json"),
    )
    parser.add_argument(
        "--rejected_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_manual_review_rejected.json"),
    )
    args = parser.parse_args()

    queue: List[Dict[str, Any]] = load_json(args.queue_path)

    decisions: List[Dict[str, Any]] = []
    approved: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    done_ids: Set[str] = set()

    if args.decisions_path.exists():
        decisions = load_json(args.decisions_path)
        done_ids = {x["esco_id"] for x in decisions if "esco_id" in x}
    if args.approved_path.exists():
        approved = load_json(args.approved_path)
    if args.rejected_path.exists():
        rejected = load_json(args.rejected_path)

    pending = [row for row in queue if row.get("esco_id") not in done_ids]
    print(f"Total in queue: {len(queue)} | Already reviewed: {len(done_ids)} | Pending: {len(pending)}")
    print("Commands: 1/2/3 = choose candidate, s = skip for now, r = reject all 3, q = quit\n")

    for idx, row in enumerate(pending, start=1):
        esco_id = row.get("esco_id", "")
        esco_title = row.get("esco_title", "")
        top3 = row.get("top_3_candidates", [])[:3]
        if not top3:
            continue

        print("=" * 100)
        print(f"[{idx}/{len(pending)}] ESCO: {esco_title}")
        print(f"ID: {esco_id}")
        for cand in top3:
            cidx = cand.get("rank", 0)
            print(
                f"{cidx}. {cand.get('onet_title', '')} ({cand.get('onet_id', '')}) | "
                f"score={format_score(cand):.4f} | "
                f"cos={cand.get('scores', {}).get('cosine', 0):.4f} "
                f"title={cand.get('scores', {}).get('title_similarity', 0):.4f} "
                f"overlap={cand.get('scores', {}).get('skill_overlap', 0):.4f}"
            )
            if cand.get("llm_explanation"):
                print(f"   LLM: {cand['llm_explanation']}")

        choice = input("Select [1/2/3/s/r/q]: ").strip().lower()
        if choice == "q":
            print("Stopping review session.")
            break
        if choice == "s":
            continue

        if choice == "r":
            decision = {"esco_id": esco_id, "esco_title": esco_title, "decision": "reject_all_top3"}
            decisions.append(decision)
            rejected.append(decision)
        elif choice in {"1", "2", "3"}:
            selected = top3[int(choice) - 1]
            decision = {
                "esco_id": esco_id,
                "esco_title": esco_title,
                "decision": "approved",
                "selected_rank": int(choice),
                "onet_id": selected.get("onet_id"),
                "onet_title": selected.get("onet_title"),
                "confidence_score": round(format_score(selected), 6),
                "scores": {
                    "cosine": selected.get("scores", {}).get("cosine"),
                    "title_similarity": selected.get("scores", {}).get("title_similarity"),
                    "skill_overlap": selected.get("scores", {}).get("skill_overlap"),
                    "llm_score": selected.get("llm_score"),
                },
                "alternatives": [
                    {
                        "rank": c.get("rank"),
                        "onet_id": c.get("onet_id"),
                        "onet_title": c.get("onet_title"),
                        "score": round(format_score(c), 6),
                    }
                    for c in top3
                    if c.get("rank") != int(choice)
                ],
            }
            decisions.append(decision)
            approved.append(decision)
        else:
            print("Invalid input. Item left pending.")
            continue

        save_json(args.decisions_path, decisions)
        save_json(args.approved_path, approved)
        save_json(args.rejected_path, rejected)

    print("\nReview summary")
    print(f"Approved: {len(approved)}")
    print(f"Rejected: {len(rejected)}")
    print(f"Decisions saved: {args.decisions_path}")


if __name__ == "__main__":
    main()
