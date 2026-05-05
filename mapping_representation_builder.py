"""
Build a mapping representation layer for ESCO occupation clusters.

Inputs:
- Deduplicated dataset (CSV or JSON records)
- Cluster definition file (approved_clusters_final.json)

Outputs:
- mapping_representation_approved.json (accepted records from review)
- mapping_representation_final.json (final mapping-ready dataset)
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pandas as pd


logger = logging.getLogger("mapping_representation_builder")


def configure_logging(verbosity: int) -> None:
    level = logging.WARNING
    if verbosity == 1:
        level = logging.INFO
    elif verbosity >= 2:
        level = logging.DEBUG
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def load_data(input_path: str, input_format: Optional[str] = None) -> pd.DataFrame:
    path = Path(input_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")

    fmt = input_format
    if fmt is None:
        suffix = path.suffix.lower()
        if suffix == ".csv":
            fmt = "csv"
        elif suffix == ".json":
            fmt = "json"
        else:
            raise ValueError("Could not infer input format. Use --input-format csv|json.")

    if fmt == "csv":
        df = pd.read_csv(path)
    elif fmt == "json":
        df = pd.read_json(path)
    else:
        raise ValueError("Unsupported input format. Use csv|json.")

    if df.empty:
        raise ValueError("Input dataset is empty.")
    return df


def build_cluster_map(clusters_path: str) -> Dict[str, Dict[str, Any]]:
    path = Path(clusters_path)
    if not path.exists():
        raise FileNotFoundError(f"Cluster file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Cluster file must be a JSON object.")
    return data


def _to_text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and pd.isna(v):
        return ""
    return str(v).strip()


def select_representative_description(rows: List[Dict[str, Any]], description_col: str) -> str:
    """
    Select one representative description:
    - longest non-empty description among cluster members
    """
    best = ""
    for r in rows:
        desc = _to_text(r.get(description_col))
        if len(desc) > len(best):
            best = desc
    return best


def _build_combined_text_for_embedding(
    title: str,
    alternative_titles: List[str],
    representative_description: str,
) -> str:
    parts: List[str] = []
    if title:
        parts.append(title.strip())
    if alternative_titles:
        parts.append(f"Alternative titles: {', '.join(alternative_titles)}")
    if representative_description:
        parts.append(f"Description: {representative_description.strip()}")
    return ". ".join(parts).strip()


def build_representation(
    df: pd.DataFrame,
    clusters: Dict[str, Dict[str, Any]],
    *,
    id_col: str,
    title_col: str,
    description_col: str,
) -> List[Dict[str, Any]]:
    if id_col not in df.columns:
        raise KeyError(f"Missing id column: {id_col}")
    if title_col not in df.columns:
        raise KeyError(f"Missing title column: {title_col}")
    if description_col not in df.columns:
        raise KeyError(f"Missing description column: {description_col}")

    rows_by_id: Dict[str, Dict[str, Any]] = {}
    for _, row in df.iterrows():
        rid = _to_text(row.get(id_col))
        if not rid:
            continue
        # first-seen wins for stability
        if rid not in rows_by_id:
            rows_by_id[rid] = row.to_dict()

    representations: List[Dict[str, Any]] = []

    for cluster_id, payload in clusters.items():
        if not isinstance(payload, dict):
            logger.warning("Skipping invalid cluster payload: %s", cluster_id)
            continue
        canonical_id = _to_text(payload.get("canonical_id"))
        merged_ids = payload.get("merged_ids", [])
        if not canonical_id:
            logger.warning("Skipping cluster without canonical_id: %s", cluster_id)
            continue
        if not isinstance(merged_ids, list):
            logger.warning("Skipping cluster with non-list merged_ids: %s", cluster_id)
            continue

        source_ids = [canonical_id] + [_to_text(x) for x in merged_ids if _to_text(x)]
        # de-duplicate while preserving order
        source_ids = list(dict.fromkeys(source_ids))

        member_rows = [rows_by_id[sid] for sid in source_ids if sid in rows_by_id]
        canonical_row = rows_by_id.get(canonical_id, {})

        canonical_title = _to_text(canonical_row.get(title_col))
        if not canonical_title and member_rows:
            canonical_title = _to_text(member_rows[0].get(title_col))

        alt_titles: List[str] = []
        seen_titles = set()
        for sid in source_ids:
            row = rows_by_id.get(sid)
            if not row:
                continue
            t = _to_text(row.get(title_col))
            if not t:
                continue
            if t.lower() == canonical_title.lower():
                continue
            key = t.lower()
            if key in seen_titles:
                continue
            seen_titles.add(key)
            alt_titles.append(t)

        representative_description = select_representative_description(member_rows, description_col)
        combined_text = _build_combined_text_for_embedding(
            title=canonical_title,
            alternative_titles=alt_titles,
            representative_description=representative_description,
        )

        representations.append(
            {
                "id": cluster_id,
                "canonical_id": canonical_id,
                "title": canonical_title,
                "alternative_titles": alt_titles,
                "representative_description": representative_description,
                "combined_text_for_embedding": combined_text,
                "source_ids": source_ids,
                "cluster_size": len(source_ids),
            }
        )

    return representations


def _truncate(s: str, n: int = 300) -> str:
    if len(s) <= n:
        return s
    return s[: n - 3].rstrip() + "..."


def review_representations(
    representations: Sequence[Dict[str, Any]],
    *,
    approved_path: str,
    auto_approve: bool,
) -> Tuple[List[Dict[str, Any]], int]:
    approved: List[Dict[str, Any]] = []
    skipped = 0

    for idx, role in enumerate(representations, start=1):
        role_copy = dict(role)

        if auto_approve:
            approved.append(role_copy)
            continue

        print("\n" + "=" * 88)
        print(f"Role {idx}/{len(representations)}")
        print(f"Title: {role_copy.get('title', '')}")
        print(f"Cluster size: {role_copy.get('cluster_size', 0)}")
        print(f"Alternative titles: {', '.join(role_copy.get('alternative_titles', []))}")
        print(f"Representative description: {_truncate(_to_text(role_copy.get('representative_description', '')))}")

        while True:
            choice = input("Accept? (y/n/edit): ").strip().lower()
            if choice in {"y", "yes"}:
                role_copy["combined_text_for_embedding"] = _build_combined_text_for_embedding(
                    role_copy.get("title", ""),
                    role_copy.get("alternative_titles", []),
                    role_copy.get("representative_description", ""),
                )
                approved.append(role_copy)
                break
            if choice in {"n", "no"}:
                skipped += 1
                break
            if choice == "edit":
                new_title = input("  New title (leave empty to keep current): ").strip()
                if new_title:
                    role_copy["title"] = new_title
                new_desc = input("  New representative description (leave empty to keep current): ").strip()
                if new_desc:
                    role_copy["representative_description"] = new_desc
                role_copy["combined_text_for_embedding"] = _build_combined_text_for_embedding(
                    role_copy.get("title", ""),
                    role_copy.get("alternative_titles", []),
                    role_copy.get("representative_description", ""),
                )
                approved.append(role_copy)
                break
            print("  Invalid input. Use y, n, or edit.")

    Path(approved_path).write_text(
        json.dumps(approved, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return approved, skipped


def save_output(records: Sequence[Dict[str, Any]], output_path: str) -> None:
    Path(output_path).write_text(
        json.dumps(list(records), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build mapping representation layer from deduplicated ESCO dataset and approved clusters."
    )
    parser.add_argument("--input", required=True, help="Deduplicated dataset path (CSV or JSON).")
    parser.add_argument("--input-format", choices=["csv", "json"], default=None)
    parser.add_argument("--clusters-file", default="approved_clusters_final.json")

    parser.add_argument("--id-column", default="conceptUri", help="ID column in input dataset.")
    parser.add_argument("--title-column", default="preferredLabel", help="Title column in input dataset.")
    parser.add_argument("--description-column", default="description", help="Description column in input dataset.")

    parser.add_argument("--approved-output", default="mapping_representation_approved.json")
    parser.add_argument("--final-output", default="mapping_representation_final.json")
    parser.add_argument("--auto-approve", action="store_true", help="Skip interactive review; approve all.")
    parser.add_argument("-v", "--verbose", action="count", default=0)

    args = parser.parse_args(argv)
    configure_logging(args.verbose)

    df = load_data(args.input, args.input_format)
    clusters = build_cluster_map(args.clusters_file)

    representations = build_representation(
        df,
        clusters,
        id_col=args.id_column,
        title_col=args.title_column,
        description_col=args.description_column,
    )

    approved, skipped = review_representations(
        representations,
        approved_path=args.approved_output,
        auto_approve=args.auto_approve,
    )

    save_output(approved, args.final_output)

    print("\nSummary")
    print(f"  Clusters processed: {len(representations)}")
    print(f"  Approved         : {len(approved)}")
    print(f"  Skipped          : {skipped}")
    print(f"  Approved file    : {args.approved_output}")
    print(f"  Final file       : {args.final_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

