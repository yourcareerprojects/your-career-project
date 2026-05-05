import argparse
import json
from pathlib import Path
from typing import Any, Dict, List


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def run_review_pass(reranked_rows: List[Dict[str, Any]], high_threshold: float) -> Dict[str, Any]:
    auto_accept: List[Dict[str, Any]] = []
    manual_review: List[Dict[str, Any]] = []

    for row in reranked_rows:
        esco_id = row.get("esco_id", "")
        esco_title = row.get("esco_title", "")
        candidates = row.get("candidates", [])
        if not candidates:
            continue

        top3 = candidates[:3]
        best = top3[0]
        score = float(best.get("final_score", best.get("hybrid_score", 0.0)))

        selected_record = {
            "esco_id": esco_id,
            "esco_title": esco_title,
            "onet_id": best.get("onet_id"),
            "onet_title": best.get("onet_title"),
            "confidence_score": round(score, 6),
            "scores": {
                "cosine": best.get("scores", {}).get("cosine"),
                "title_similarity": best.get("scores", {}).get("title_similarity"),
                "skill_overlap": best.get("scores", {}).get("skill_overlap"),
                "llm_score": best.get("llm_score"),
            },
            "method": "hybrid+auto",
            "alternatives": [
                {
                    "onet_id": c.get("onet_id"),
                    "onet_title": c.get("onet_title"),
                    "score": round(float(c.get("final_score", c.get("hybrid_score", 0.0))), 6),
                }
                for c in top3[1:]
            ],
        }

        if score >= high_threshold:
            auto_accept.append(selected_record)
        else:
            manual_review.append(
                {
                    "esco_id": esco_id,
                    "esco_title": esco_title,
                    "best_candidate": selected_record,
                    "top_3_candidates": [
                        {
                            "rank": idx + 1,
                            "onet_id": c.get("onet_id"),
                            "onet_title": c.get("onet_title"),
                            "score": round(float(c.get("final_score", c.get("hybrid_score", 0.0))), 6),
                            "scores": c.get("scores", {}),
                            "llm_score": c.get("llm_score"),
                            "llm_explanation": c.get("llm_explanation", ""),
                        }
                        for idx, c in enumerate(top3)
                    ],
                    "review_action": "manual_validation_required",
                }
            )

    total = len(auto_accept) + len(manual_review)
    return {
        "summary": {
            "high_confidence_threshold": high_threshold,
            "total_roles": total,
            "auto_accepted_count": len(auto_accept),
            "manual_review_count": len(manual_review),
            "auto_accept_rate": round((len(auto_accept) / total), 4) if total else 0.0,
        },
        "auto_accept": auto_accept,
        "manual_review": manual_review,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Split reranked mappings into auto-accept and manual-review sets")
    parser.add_argument(
        "--reranked_path",
        type=Path,
        default=Path(r"C:\Users\nicol\Documents\7.Development\esco_deduplicated_final_reranked_candidates.json"),
    )
    parser.add_argument("--output_dir", type=Path, default=Path(r"C:\Users\nicol\Documents\7.Development"))
    parser.add_argument("--high_threshold", type=float, default=0.45)
    parser.add_argument("--prefix", type=str, default="esco_deduplicated_final_review")
    args = parser.parse_args()

    reranked_rows = load_json(args.reranked_path)
    results = run_review_pass(reranked_rows, args.high_threshold)

    auto_path = args.output_dir / f"{args.prefix}_auto_accepted.json"
    review_path = args.output_dir / f"{args.prefix}_manual_review_queue.json"
    summary_path = args.output_dir / f"{args.prefix}_summary.json"

    save_json(auto_path, results["auto_accept"])
    save_json(review_path, results["manual_review"])
    save_json(summary_path, results["summary"])

    print("Review pass completed")
    print(f"Threshold: {args.high_threshold}")
    print(f"Auto-accepted: {results['summary']['auto_accepted_count']}")
    print(f"Manual review: {results['summary']['manual_review_count']}")
    print(f"Summary file: {summary_path}")


if __name__ == "__main__":
    main()
