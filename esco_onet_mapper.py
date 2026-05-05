import argparse
import json
import logging
import os
import pickle
import re
import hashlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np
import pandas as pd
from rapidfuzz import fuzz
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from tqdm import tqdm


MODEL_NAME = "all-MiniLM-L6-v2"
STOPWORDS = {
    "and", "the", "for", "with", "from", "that", "this", "your", "their", "into", "about", "role",
    "occupation", "work", "works", "using", "used", "use", "are", "is", "a", "an", "of", "to", "in",
    "on", "by", "at", "or", "as", "be", "can", "provide", "provides", "support", "services",
}


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")


def load_json(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"Expected list at {path}, got {type(data)}")
    return data


def validate_and_clean_esco(data: List[Dict[str, Any]], exclude_duplicates: bool = False) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for row in data:
        if exclude_duplicates and bool(row.get("is_duplicate")):
            continue

        esco_id = str(row.get("id") or row.get("conceptUri") or "").strip()
        title = str(row.get("title") or row.get("preferredLabel") or "").strip()
        description = str(row.get("representative_description") or row.get("description") or "").strip()

        raw_alt = row.get("alternative_titles")
        if isinstance(raw_alt, list):
            alternative_titles = [str(x).strip() for x in raw_alt if str(x).strip()]
        else:
            alt_labels = str(row.get("altLabels") or "").strip()
            alternative_titles = [x.strip() for x in alt_labels.split("\n") if x.strip()]

        combined = str(row.get("combined_text_for_embedding") or "").strip()
        if not combined:
            alt_text = ", ".join(alternative_titles)
            parts = [f"{title}."]
            if alt_text:
                parts.append(f"Alternative titles: {alt_text}.")
            if description:
                parts.append(f"Description: {description}")
            combined = " ".join(parts).strip()

        if not esco_id or not title or not combined:
            continue

        normalized = dict(row)
        normalized["id"] = esco_id
        normalized["title"] = title
        normalized["representative_description"] = description
        normalized["alternative_titles"] = alternative_titles
        normalized["combined_text_for_embedding"] = " ".join(combined.split())
        normalized["source_ids"] = normalized.get("source_ids") or [esco_id]
        normalized["cluster_size"] = normalized.get("cluster_size") or 1
        cleaned.append(normalized)
    return cleaned


def validate_and_clean_onet(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for row in data:
        onet_id = str(row.get("onet_id", "")).strip()
        title = str(row.get("title", "")).strip()
        combined = str(row.get("combined_text_for_embedding", "")).strip()
        if not onet_id or not title or not combined:
            continue
        row["onet_id"] = onet_id
        row["title"] = title
        row["description"] = str(row.get("description", "")).strip()
        row["skills"] = row.get("skills", []) or []
        row["tasks"] = row.get("tasks", []) or []
        row["combined_text_for_embedding"] = " ".join(combined.split())
        cleaned.append(row)
    return cleaned


def load_data(esco_path: Path, onet_path: Path, exclude_duplicates: bool = False) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    logging.info("Loading ESCO data: %s", esco_path)
    esco_raw = load_json(esco_path)
    logging.info("Loading O*NET data: %s", onet_path)
    onet_raw = load_json(onet_path)

    esco = validate_and_clean_esco(esco_raw, exclude_duplicates=exclude_duplicates)
    onet = validate_and_clean_onet(onet_raw)

    # Basic structural sanity checks with pandas for quick diagnostics.
    esco_df = pd.DataFrame(esco)
    onet_df = pd.DataFrame(onet)
    logging.info("ESCO valid rows: %d | O*NET valid rows: %d", len(esco_df), len(onet_df))
    if esco_df.empty or onet_df.empty:
        raise ValueError("One or both datasets are empty after validation.")
    return esco, onet


def hash_texts(texts: List[str]) -> str:
    payload = "\n".join(texts).encode("utf-8", errors="ignore")
    return hashlib.sha256(payload).hexdigest()


def compute_embeddings(
    texts: List[str],
    ids: List[str],
    cache_path: Path,
    model: SentenceTransformer,
    cache_key: str,
    batch_size: int = 64,
) -> np.ndarray:
    cache: Dict[str, Any] = {}
    if cache_path.exists():
        with cache_path.open("rb") as f:
            cache = pickle.load(f)

    text_hash = hash_texts(texts)
    item = cache.get(cache_key)
    if item and item.get("model_name") == MODEL_NAME and item.get("text_hash") == text_hash and item.get("ids") == ids:
        logging.info("Loaded cached embeddings for %s from %s", cache_key, cache_path)
        return np.asarray(item["embeddings"], dtype=np.float32)

    logging.info("Computing embeddings for %s (%d records)", cache_key, len(texts))
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype(np.float32)

    cache[cache_key] = {
        "model_name": MODEL_NAME,
        "text_hash": text_hash,
        "ids": ids,
        "embeddings": embeddings,
    }
    with cache_path.open("wb") as f:
        pickle.dump(cache, f)
    logging.info("Saved embedding cache to %s", cache_path)
    return embeddings


def retrieve_candidates(
    esco: List[Dict[str, Any]],
    onet: List[Dict[str, Any]],
    esco_embeddings: np.ndarray,
    onet_embeddings: np.ndarray,
    top_n: int,
    candidates_path: Path,
    resume: bool = True,
) -> List[Dict[str, Any]]:
    existing_by_id: Dict[str, Dict[str, Any]] = {}
    if resume and candidates_path.exists():
        with candidates_path.open("r", encoding="utf-8") as f:
            prev = json.load(f)
        existing_by_id = {row["esco_id"]: row for row in prev if "esco_id" in row}
        logging.info("Resuming retrieval with %d existing candidate rows", len(existing_by_id))

    onet_ids = [x["onet_id"] for x in onet]
    onet_titles = [x["title"] for x in onet]
    sim_matrix = cosine_similarity(esco_embeddings, onet_embeddings)

    rows: List[Dict[str, Any]] = []
    for i, esco_row in enumerate(tqdm(esco, desc="Retrieving top candidates")):
        esco_id = esco_row["id"]
        if esco_id in existing_by_id:
            rows.append(existing_by_id[esco_id])
            continue

        sims = sim_matrix[i]
        top_idx = np.argpartition(-sims, range(min(top_n, len(sims))))[:top_n]
        top_idx = top_idx[np.argsort(-sims[top_idx])]
        candidates = [
            {
                "onet_id": onet_ids[idx],
                "title": onet_titles[idx],
                "cosine_score": round(float(sims[idx]), 6),
            }
            for idx in top_idx
        ]
        rows.append({"esco_id": esco_id, "candidates": candidates})

    with candidates_path.open("w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
    logging.info("Saved candidate retrieval output: %s", candidates_path)
    return rows


def tokenize_for_overlap(text: str) -> Set[str]:
    tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{2,}", text.lower())
    return {t for t in tokens if t not in STOPWORDS}


def extract_esco_skill_terms(esco_row: Dict[str, Any]) -> Set[str]:
    terms: Set[str] = set()
    if isinstance(esco_row.get("skills"), list):
        for s in esco_row["skills"]:
            terms |= tokenize_for_overlap(str(s))
    title = esco_row.get("title", "")
    alt_titles = " ".join(esco_row.get("alternative_titles", []))
    description = esco_row.get("representative_description", "")
    combined = f"{title} {alt_titles} {description}"
    terms |= tokenize_for_overlap(combined)
    return terms


def onet_skill_terms(onet_row: Dict[str, Any]) -> Set[str]:
    names = []
    for s in onet_row.get("skills", []):
        if isinstance(s, dict) and s.get("name"):
            names.append(str(s["name"]))
    return tokenize_for_overlap(" ".join(names))


def jaccard(a: Set[str], b: Set[str]) -> float:
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def compute_hybrid_score(
    esco: List[Dict[str, Any]],
    onet: List[Dict[str, Any]],
    candidates: List[Dict[str, Any]],
    reranked_path: Path,
    resume: bool = True,
) -> List[Dict[str, Any]]:
    esco_by_id = {x["id"]: x for x in esco}
    onet_by_id = {x["onet_id"]: x for x in onet}

    existing_by_id: Dict[str, Dict[str, Any]] = {}
    if resume and reranked_path.exists():
        with reranked_path.open("r", encoding="utf-8") as f:
            prev = json.load(f)
        existing_by_id = {row["esco_id"]: row for row in prev if "esco_id" in row}
        logging.info("Resuming rerank with %d existing rows", len(existing_by_id))

    output: List[Dict[str, Any]] = []
    for row in tqdm(candidates, desc="Hybrid reranking"):
        esco_id = row["esco_id"]
        if esco_id in existing_by_id:
            output.append(existing_by_id[esco_id])
            continue

        esco_row = esco_by_id[esco_id]
        esco_terms = extract_esco_skill_terms(esco_row)
        esco_title = esco_row.get("title", "")

        scored: List[Dict[str, Any]] = []
        for cand in row.get("candidates", []):
            onet_row = onet_by_id.get(cand["onet_id"])
            if onet_row is None:
                continue
            cosine_score = float(cand.get("cosine_score", 0.0))
            title_sim = fuzz.token_sort_ratio(esco_title, onet_row.get("title", "")) / 100.0
            skill_overlap = jaccard(esco_terms, onet_skill_terms(onet_row))
            hybrid = (0.5 * cosine_score) + (0.2 * title_sim) + (0.3 * skill_overlap)
            scored.append(
                {
                    "onet_id": onet_row["onet_id"],
                    "onet_title": onet_row["title"],
                    "scores": {
                        "cosine": round(cosine_score, 6),
                        "title_similarity": round(float(title_sim), 6),
                        "skill_overlap": round(float(skill_overlap), 6),
                    },
                    "hybrid_score": round(float(hybrid), 6),
                }
            )

        scored.sort(key=lambda x: x["hybrid_score"], reverse=True)
        output.append({"esco_id": esco_id, "esco_title": esco_title, "candidates": scored})

    with reranked_path.open("w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    logging.info("Saved reranked candidates: %s", reranked_path)
    return output


def llm_rerank(
    reranked_rows: List[Dict[str, Any]],
    esco_by_id: Dict[str, Dict[str, Any]],
    onet_by_id: Dict[str, Dict[str, Any]],
    top_k: int = 3,
) -> List[Dict[str, Any]]:
    try:
        from openai import OpenAI
    except ImportError:
        logging.warning("openai package not installed; skipping LLM rerank.")
        return reranked_rows

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        logging.warning("OPENAI_API_KEY not set; skipping LLM rerank.")
        return reranked_rows

    client = OpenAI(api_key=api_key)
    logging.info("Running optional LLM rerank for top-%d candidates", top_k)

    for row in tqdm(reranked_rows, desc="LLM judging"):
        esco_row = esco_by_id.get(row["esco_id"], {})
        for cand in row.get("candidates", [])[:top_k]:
            onet_row = onet_by_id.get(cand["onet_id"], {})
            prompt = (
                "Compare the following ESCO role and O*NET role. "
                "Return strict JSON with keys: score_1_to_5 (integer 1-5), explanation (string).\n\n"
                f"ESCO:\nTitle: {esco_row.get('title', '')}\nDescription: {esco_row.get('representative_description', '')}\n\n"
                f"O*NET:\nTitle: {onet_row.get('title', '')}\nDescription: {onet_row.get('description', '')}\n"
            )
            try:
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    temperature=0,
                    messages=[{"role": "user", "content": prompt}],
                )
                content = response.choices[0].message.content or ""
                score_match = re.search(r'"score_1_to_5"\s*:\s*(\d)', content)
                explanation_match = re.search(r'"explanation"\s*:\s*"([^"]*)"', content, flags=re.S)
                score_raw = int(score_match.group(1)) if score_match else 3
                llm_score = max(1, min(score_raw, 5)) / 5.0
                explanation = explanation_match.group(1).strip() if explanation_match else content.strip()
            except Exception as exc:
                logging.warning("LLM judge failed for %s -> %s: %s", row["esco_id"], cand["onet_id"], exc)
                llm_score = 0.5
                explanation = "LLM evaluation failed; fallback score used."

            cand["llm_score"] = round(float(llm_score), 6)
            cand["llm_explanation"] = explanation
            cand["final_score"] = round((0.7 * cand["hybrid_score"]) + (0.3 * cand["llm_score"]), 6)

        # Non-judged candidates use hybrid score as final score for consistency.
        for cand in row.get("candidates", [])[top_k:]:
            cand["llm_score"] = None
            cand["llm_explanation"] = ""
            cand["final_score"] = cand["hybrid_score"]

        row["candidates"].sort(key=lambda x: x["final_score"], reverse=True)

    return reranked_rows


def review_matches(
    reranked_rows: List[Dict[str, Any]],
    output_path: Path,
    auto_accept_threshold: Optional[float] = None,
    skip_review: bool = False,
) -> List[Dict[str, Any]]:
    approved: List[Dict[str, Any]] = []
    existing: Dict[str, Dict[str, Any]] = {}
    if output_path.exists():
        with output_path.open("r", encoding="utf-8") as f:
            prev = json.load(f)
        existing = {x["esco_id"]: x for x in prev if "esco_id" in x}
        approved.extend(prev)
        logging.info("Loaded %d existing approved mappings", len(existing))

    for row in reranked_rows:
        esco_id = row["esco_id"]
        if esco_id in existing:
            continue

        top3 = row.get("candidates", [])[:3]
        if not top3:
            continue

        best = top3[0]
        best_score = float(best.get("final_score", best.get("hybrid_score", 0.0)))

        if auto_accept_threshold is not None and best_score >= auto_accept_threshold:
            choice_idx = 0
            method = "hybrid+auto"
        elif skip_review:
            choice_idx = 0
            method = "hybrid" if best.get("llm_score") is None else "hybrid+llm"
        else:
            print("\n" + "=" * 80)
            print(f"ESCO: {row.get('esco_title', '')} ({esco_id})")
            for idx, cand in enumerate(top3, start=1):
                print(
                    f"{idx}. {cand['onet_title']} ({cand['onet_id']}) | "
                    f"cos={cand['scores']['cosine']:.3f} "
                    f"hybrid={cand['hybrid_score']:.3f} "
                    f"final={cand.get('final_score', cand['hybrid_score']):.3f}"
                )
                if cand.get("llm_explanation"):
                    print(f"   LLM: {cand['llm_explanation']}")

            raw = input("Select best match (1/2/3/skip): ").strip().lower()
            if raw == "skip":
                continue
            if raw not in {"1", "2", "3"}:
                logging.warning("Invalid selection for %s; skipping", esco_id)
                continue
            choice_idx = int(raw) - 1
            method = "hybrid+llm+human" if top3[choice_idx].get("llm_score") is not None else "hybrid+human"

        selected = top3[choice_idx]
        alternatives = [
            {"onet_id": c["onet_id"], "score": round(float(c.get("final_score", c["hybrid_score"])), 6)}
            for i, c in enumerate(top3)
            if i != choice_idx
        ]
        approved.append(
            {
                "esco_id": esco_id,
                "esco_title": row.get("esco_title", ""),
                "onet_id": selected["onet_id"],
                "onet_title": selected["onet_title"],
                "confidence_score": round(float(selected.get("final_score", selected["hybrid_score"])), 6),
                "scores": {
                    "cosine": selected["scores"]["cosine"],
                    "title_similarity": selected["scores"]["title_similarity"],
                    "skill_overlap": selected["scores"]["skill_overlap"],
                    "llm_score": selected.get("llm_score"),
                },
                "method": method,
                "alternatives": alternatives,
            }
        )

        with output_path.open("w", encoding="utf-8") as f:
            json.dump(approved, f, indent=2, ensure_ascii=False)

    return approved


def save_results(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    logging.info("Saved: %s", path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ESCO -> O*NET hybrid mapping pipeline")
    parser.add_argument("--esco_path", type=Path, default=Path(r"C:\Users\nicol\Documents\7.Development\mapping_representation_final.json"))
    parser.add_argument("--onet_path", type=Path, default=Path(r"C:\Users\nicol\Documents\7.Development\onet_prepared.json"))
    parser.add_argument("--output_dir", type=Path, default=Path(r"C:\Users\nicol\Documents\7.Development"))
    parser.add_argument("--top_n", type=int, default=10)
    parser.add_argument("--use_llm", action="store_true")
    parser.add_argument("--auto_accept_threshold", type=float, default=None)
    parser.add_argument("--skip_review", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--batch_size", type=int, default=64)
    parser.add_argument("--output_prefix", type=str, default=None)
    parser.add_argument("--exclude_duplicates", action="store_true")
    return parser.parse_args()


def main() -> None:
    setup_logging()
    args = parse_args()

    prefix = args.output_prefix or args.esco_path.stem
    candidates_path = args.output_dir / f"{prefix}_candidates.json"
    reranked_path = args.output_dir / f"{prefix}_reranked_candidates.json"
    approved_path = args.output_dir / f"{prefix}_esco_onet_mapping_approved.json"
    cache_path = args.output_dir / f"{prefix}_embeddings.pkl"

    esco, onet = load_data(args.esco_path, args.onet_path, exclude_duplicates=args.exclude_duplicates)
    esco_by_id = {x["id"]: x for x in esco}
    onet_by_id = {x["onet_id"]: x for x in onet}

    model = SentenceTransformer(MODEL_NAME)
    esco_embeddings = compute_embeddings(
        texts=[x["combined_text_for_embedding"] for x in esco],
        ids=[x["id"] for x in esco],
        cache_path=cache_path,
        model=model,
        cache_key="esco",
        batch_size=args.batch_size,
    )
    onet_embeddings = compute_embeddings(
        texts=[x["combined_text_for_embedding"] for x in onet],
        ids=[x["onet_id"] for x in onet],
        cache_path=cache_path,
        model=model,
        cache_key="onet",
        batch_size=args.batch_size,
    )

    candidates = retrieve_candidates(
        esco=esco,
        onet=onet,
        esco_embeddings=esco_embeddings,
        onet_embeddings=onet_embeddings,
        top_n=args.top_n,
        candidates_path=candidates_path,
        resume=args.resume,
    )

    reranked = compute_hybrid_score(
        esco=esco,
        onet=onet,
        candidates=candidates,
        reranked_path=reranked_path,
        resume=args.resume,
    )

    if args.use_llm:
        reranked = llm_rerank(reranked, esco_by_id=esco_by_id, onet_by_id=onet_by_id, top_k=3)
        save_results(reranked_path, reranked)
    else:
        # Ensure final_score always exists for downstream review/export.
        for row in reranked:
            for cand in row.get("candidates", []):
                cand["llm_score"] = None
                cand["llm_explanation"] = ""
                cand["final_score"] = cand["hybrid_score"]
        save_results(reranked_path, reranked)

    approved = review_matches(
        reranked_rows=reranked,
        output_path=approved_path,
        auto_accept_threshold=args.auto_accept_threshold,
        skip_review=args.skip_review,
    )
    save_results(approved_path, approved)

    logging.info("Done. Approved mappings: %d", len(approved))


if __name__ == "__main__":
    main()
