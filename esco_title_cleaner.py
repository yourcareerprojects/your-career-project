"""
ESCo occupation title cleaner with human-in-the-loop approvals.

Workflow:
1) Load dataset (CSV or JSON array of records).
2) Propose a normalized title for each unique occupation title.
3) Interactive review: for each proposal, ask the user to accept (y), skip (n), or edit (edit).
4) Persist approved mappings to `approved_title_changes.json`.
5) Apply only approved mappings and write `esco_cleaned_titles.json`.

Examples
--------
python esco_title_cleaner.py --input "path/to/esco.csv" --input-format csv --title-column occupation_title
python esco_title_cleaner.py --input "path/to/esco.json" --input-format json --title-column title
python esco_title_cleaner.py --input "path/to/esco.csv" --stopwords technician,associate,worker
python esco_title_cleaner.py --source mongo --mongo-uri "mongodb://localhost:27017/career-path-explorer" --mongo-collection careerpaths --title-column title

Notes
-----
- The script never overwrites your original dataset.
- Output always includes the original title value in a backup column.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd


logger = logging.getLogger("esco_title_cleaner")


DEFAULT_STOPWORDS: List[str] = [
    "technician",
    "associate",
    "worker",
]


def configure_logging(verbosity: int) -> None:
    level = logging.WARNING
    if verbosity == 1:
        level = logging.INFO
    elif verbosity >= 2:
        level = logging.DEBUG

    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def load_data(input_path: str, input_format: Optional[str] = None) -> pd.DataFrame:
    """
    Load a dataset as a DataFrame.

    Supported input formats:
    - CSV (default via --input-format csv or file extension .csv)
    - JSON (default via --input-format json or file extension .json)
      The JSON must be an array of records.
    """
    path = Path(input_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")

    fmt = input_format
    if fmt is None:
        if path.suffix.lower() == ".csv":
            fmt = "csv"
        elif path.suffix.lower() == ".json":
            fmt = "json"
        else:
            raise ValueError(
                "Could not infer input format. Provide --input-format csv|json or use a .csv/.json file."
            )

    if fmt == "csv":
        df = pd.read_csv(path)
    elif fmt == "json":
        df = pd.read_json(path)
    else:
        raise ValueError(f"Unsupported input format: {fmt}. Use csv or json.")

    if df.empty:
        raise ValueError("Loaded dataset is empty.")
    return df


def _parse_mongo_db_from_uri(mongo_uri: str) -> Optional[str]:
    """
    Best-effort extraction of db name from MongoDB URI.
    Examples:
      - mongodb://localhost:27017/career-path-explorer
      - mongodb+srv://user:pass@cluster0.x.mongodb.net/career-path-explorer?retryWrites=true
    """
    m = re.search(r"/([^/?]+)(?:\?|$)", mongo_uri)
    if not m:
        return None
    return m.group(1)


def _require_pymongo() -> Any:
    try:
        import pymongo  # type: ignore

        return pymongo
    except ModuleNotFoundError as e:
        raise ModuleNotFoundError(
            "pymongo is required for --source mongo. Install with: pip install pymongo"
        ) from e


def load_data_from_mongo(
    *,
    mongo_uri: str,
    mongo_db: Optional[str],
    mongo_collection: str,
    query_json: str,
    title_col: str,
    array_element_field: Optional[str],
) -> Tuple[pd.DataFrame, Dict[str, int], List[str]]:
    """
    Load MongoDB documents into a DataFrame for export after approvals.

    Returns:
      - df: documents (records) as a DataFrame
      - title_counts: mapping original_title -> occurrences
    """
    pymongo = _require_pymongo()

    db_name = mongo_db or _parse_mongo_db_from_uri(mongo_uri)
    if not db_name:
        raise ValueError(
            "Could not infer MongoDB database name from --mongo-uri. Provide --mongo-db."
        )

    query = json.loads(query_json) if query_json.strip() else {}
    client = pymongo.MongoClient(mongo_uri)
    coll = client[mongo_db or db_name][mongo_collection]

    # Title counts in one aggregation query (scales better than N count_documents calls).
    # Supports:
    # - title_col is a top-level string field
    # - title_col is an array of objects, with array_element_field holding the title string
    if array_element_field:
        pipeline = [
            {"$match": query},
            {"$unwind": f"${title_col}"},
            {
                "$match": {
                    f"{title_col}.{array_element_field}": {"$exists": True, "$ne": None, "$ne": ""}
                }
            },
            {
                "$group": {
                    "_id": f"${title_col}.{array_element_field}",
                    "count": {"$sum": 1},
                }
            },
            {"$sort": {"count": -1}},
        ]
    else:
        # Narrow for proposal candidates and counts.
        titles_filter: Dict[str, Any] = dict(query)
        titles_filter[title_col] = {"$exists": True, "$ne": None, "$ne": ""}
        pipeline = [
            {"$match": titles_filter},
            {"$group": {"_id": f"${title_col}", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
    counts: Dict[str, int] = {}
    for row in coll.aggregate(pipeline, allowDiskUse=True):
        _id = row.get("_id", "")
        if isinstance(_id, str) and _id.strip():
            counts[_id] = int(row.get("count", 0))

    # Load documents for export.
    # Using find() and collecting into memory is acceptable for moderate datasets.
    # For very large collections, consider enhancing this to stream-export.
    cursor = coll.find(query, projection=None)
    records: List[Dict[str, Any]] = list(cursor)
    if not records:
        raise ValueError("MongoDB query returned no documents.")

    # Convert ObjectId to string so it can be safely serialized to JSON output later.
    # Note: pandas can keep ObjectId objects; we normalize early for safety.
    for rec in records:
        if "_id" in rec:
            rec["_id"] = str(rec["_id"])

    df = pd.DataFrame(records)
    if df.empty:
        raise ValueError("Loaded MongoDB dataset is empty after conversion.")

    ordered_titles = list(counts.keys())
    return df, counts, ordered_titles


def _coerce_str(value: Any) -> str:
    if value is None:
        return ""
    if pd.isna(value):  # type: ignore[arg-type]
        return ""
    return str(value)


def normalize_title(
    title: Any,
    stopwords: Sequence[str],
    synonyms: Optional[Dict[str, str]] = None,
    *,
    remove_stopwords: bool = True,
    dedupe_consecutive_tokens: bool = True,
) -> str:
    """
    Normalize an ESCO occupation title:
    - lowercase
    - remove generic stopwords (configurable)
    - trim whitespace
    - remove punctuation (keeps alphanumerics and spaces)
    - collapse consecutive whitespace
    - optional: replace tokens via `synonyms`
    - optional: remove consecutive duplicate tokens
    """
    raw = _coerce_str(title)
    if not raw.strip():
        return ""

    stopword_set = {s.strip().lower() for s in stopwords if s.strip()}
    syn_map = {k.strip().lower(): v.strip().lower() for k, v in (synonyms or {}).items() if k.strip()}

    text = raw.strip().lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)  # punctuation -> space
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""

    tokens = text.split(" ")
    if remove_stopwords and stopword_set:
        tokens = [t for t in tokens if t not in stopword_set]

    if syn_map:
        tokens = [syn_map.get(t, t) for t in tokens]

    if dedupe_consecutive_tokens and tokens:
        deduped: List[str] = [tokens[0]]
        for t in tokens[1:]:
            if t != deduped[-1]:
                deduped.append(t)
        tokens = deduped

    return " ".join(tokens).strip()


@dataclass(frozen=True)
class TitleProposal:
    original_title: str
    suggested_normalized_title: str
    occurrences: int


def propose_changes(
    df: pd.DataFrame,
    *,
    title_col: str,
    normalizer: Callable[[Any], str],
    title_counts: Optional[Dict[str, int]] = None,
    original_titles: Optional[Sequence[str]] = None,
) -> List[TitleProposal]:
    """
    Propose normalized titles for unique original titles.

    Returns proposals for unique titles where `suggested_normalized_title` differs
    from the trimmed original.
    """
    if original_titles is not None:
        original_values = [str(t) for t in original_titles if str(t).strip()]
    else:
        if title_col not in df.columns:
            raise KeyError(f"Title column not found: {title_col}")
        # Preserve first-seen order for deterministic review UX.
        original_values = []
        seen: set[str] = set()
        for v in df[title_col].tolist():
            s = _coerce_str(v)
            if not s:
                continue
            if s not in seen:
                seen.add(s)
                original_values.append(s)

    proposals: List[TitleProposal] = []
    # Precompute occurrences for summary/prompt context.
    if title_counts is not None:
        value_counts = title_counts
    else:
        vc = df[title_col].value_counts(dropna=True)
        value_counts = {str(k): int(v) for k, v in vc.items()}

    for original_title in original_values:
        suggested = normalizer(original_title)
        if not suggested:
            continue

        if suggested != original_title.strip():
            occurrences = int(value_counts.get(original_title, 0))
            proposals.append(
                TitleProposal(
                    original_title=original_title,
                    suggested_normalized_title=suggested,
                    occurrences=occurrences,
                )
            )

    return proposals


def _prompt_user_for_decision(original_title: str, suggested: str) -> Tuple[str, str]:
    """
    Returns (decision, chosen_normalized_title).
    decision in {"accept", "skip", "edit"}; chosen_normalized_title is only meaningful for accept/edit.
    """
    while True:
        print("\nProposed change:")
        print(f"  Original : {original_title}")
        print(f"  Suggested: {suggested}")
        choice = input("Accept? (y/n/edit): ").strip().lower()

        if choice in {"y", "yes"}:
            return ("accept", suggested)
        if choice in {"n", "no"}:
            return ("skip", "")
        if choice == "edit":
            while True:
                edited = input("  Enter normalized title: ").strip()
                if edited:
                    return ("edit", edited)
                print("  Edit cannot be empty. Please enter a normalized title.")

        print("  Invalid input. Please type y, n, or edit.")


def review_changes(
    proposals: Sequence[TitleProposal],
    *,
    approved_changes_path: str,
) -> Dict[str, str]:
    """
    Interactive review loop. Only approved changes are persisted.

    Returns:
        Mapping of original_title -> approved_normalized_title
    """
    if not proposals:
        logger.info("No proposed changes to review.")
        # Still create an empty approvals file for traceability.
        Path(approved_changes_path).write_text(json.dumps([], ensure_ascii=False, indent=2), encoding="utf-8")
        return {}

    approved_mapping: Dict[str, str] = {}
    approval_records: List[Dict[str, Any]] = []
    changed_titles = 0
    skipped_titles = 0

    logger.info("Starting interactive review for %d proposals...", len(proposals))

    for proposal in proposals:
        decision, chosen = _prompt_user_for_decision(
            proposal.original_title, proposal.suggested_normalized_title
        )

        if decision == "skip":
            skipped_titles += 1
            continue

        approved_mapping[proposal.original_title] = chosen
        changed_titles += 1
        approval_records.append(
            {
                "original_title": proposal.original_title,
                "suggested_normalized_title": proposal.suggested_normalized_title,
                "approved_normalized_title": chosen,
                "occurrences": proposal.occurrences,
                "decision": decision,
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    Path(approved_changes_path).write_text(
        json.dumps(approval_records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("\nReview complete.")
    print(f"  Number of titles changed: {changed_titles}")
    print(f"  Number skipped          : {skipped_titles}")
    logger.info("Approved changes written to %s", approved_changes_path)
    return approved_mapping


def load_approved_mapping(approved_changes_path: str) -> Dict[str, str]:
    path = Path(approved_changes_path)
    if not path.exists():
        raise FileNotFoundError(f"Approved changes file not found: {path}")

    content = path.read_text(encoding="utf-8")
    data = json.loads(content)
    if not isinstance(data, list):
        raise ValueError("approved_title_changes.json must be a JSON array of records.")

    mapping: Dict[str, str] = {}
    for rec in data:
        if not isinstance(rec, dict):
            continue
        original_title = rec.get("original_title")
        approved_normalized_title = rec.get("approved_normalized_title")
        if isinstance(original_title, str) and isinstance(approved_normalized_title, str):
            mapping[original_title] = approved_normalized_title
    return mapping


def apply_changes(
    df: pd.DataFrame,
    *,
    title_col: str,
    approved_mapping: Dict[str, str],
    output_path: str,
    array_element_field: Optional[str] = None,
) -> None:
    """
    Apply approved mappings to the dataset and write a new JSON file.

    Output behavior:
    - The original title column is backed up in a new column `{title_col}__original`.
    - The title column is replaced with the approved normalized title when a mapping exists.
    """
    if not approved_mapping:
        logger.warning("No approved mappings provided; writing output identical to input.")

    out_df = df.copy()

    if array_element_field:
        # Handle arrays of objects like:
        #   role_titles: [{ title: "...", ... }, ...]
        backup_key = f"{array_element_field}__original"
        changed_elements = 0

        def _update_record(record: Dict[str, Any]) -> Dict[str, Any]:
            nonlocal changed_elements
            arr = record.get(title_col)
            if not isinstance(arr, list):
                return record
            for elem in arr:
                if not isinstance(elem, dict):
                    continue
                original_elem_title = _coerce_str(elem.get(array_element_field))
                # Always set backup (if missing) so exports are traceable.
                if backup_key not in elem:
                    elem[backup_key] = original_elem_title
                if original_elem_title in approved_mapping:
                    new_title = approved_mapping[original_elem_title]
                    if new_title and new_title != original_elem_title:
                        elem[array_element_field] = new_title
                        changed_elements += 1
            return record

        out_records = out_df.to_dict(orient="records")
        out_records = [_update_record(rec) for rec in out_records]
        changed_rows = changed_elements
        Path(output_path).write_text(
            json.dumps(out_records, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        print(f"\nWrote cleaned dataset to: {output_path}")
        print(f"Rows changed (approx.): {changed_rows}")
        return

    if title_col not in df.columns:
        raise KeyError(f"Title column not found: {title_col}")

    backup_col = f"{title_col}__original"
    out_df[backup_col] = out_df[title_col]

    # Exact match replacement against original_title values.
    def _apply(v: Any) -> Any:
        key = _coerce_str(v)
        if key in approved_mapping:
            return approved_mapping[key]
        return v

    out_df[title_col] = out_df[title_col].map(_apply)

    changed_rows = int(out_df[title_col].ne(out_df[backup_col]).sum())
    logger.info("Rows changed in output: %d", changed_rows)

    Path(output_path).write_text(
        out_df.to_json(orient="records", force_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nWrote cleaned dataset to: {output_path}")
    print(f"Rows changed (approx.): {changed_rows}")


def apply_changes_to_mongo(
    *,
    mongo_uri: str,
    mongo_db: Optional[str],
    mongo_collection: str,
    query_json: str,
    title_col: str,
    approved_mapping: Dict[str, str],
    backup_field: Optional[str],
    dry_run: bool,
) -> Dict[str, int]:
    """
    Apply approved title mappings directly to MongoDB.

    IMPORTANT: This function updates the `title_col` field in-place.
    It does NOT modify your approved JSON files.
    """
    pymongo = _require_pymongo()

    if not approved_mapping:
        logger.warning("Approved mapping is empty; nothing to update in MongoDB.")
        return {"matched": 0, "updated": 0}

    db_name = mongo_db or _parse_mongo_db_from_uri(mongo_uri)
    if not db_name:
        raise ValueError("Could not infer MongoDB database name; provide --mongo-db.")

    base_query = json.loads(query_json) if query_json.strip() else {}
    if not isinstance(base_query, dict):
        raise ValueError("--mongo-query-json must be a JSON object.")

    # Ensure a backup field exists so you can trace/rollback (optional but recommended).
    backup_field_final = backup_field or f"{title_col}__original"

    client = pymongo.MongoClient(mongo_uri)
    coll = client[mongo_db or db_name][mongo_collection]

    matched_total = 0
    updated_total = 0

    # Use one update per mapping entry. The mapping size should be small due to human approvals.
    for original_title, approved_title in approved_mapping.items():
        if not original_title or not approved_title:
            continue

        filt = dict(base_query)
        filt[title_col] = original_title

        matched = int(coll.count_documents(filt))
        matched_total += matched
        if matched == 0:
            continue

        logger.info("Updating %d docs: %r -> %r", matched, original_title, approved_title)

        if dry_run:
            continue

        # Pipeline update so we can copy the pre-update title into the backup field.
        update_pipeline = [
            {
                "$set": {
                    backup_field_final: f"${title_col}",
                    title_col: approved_title,
                }
            }
        ]
        result = coll.update_many(filt, update_pipeline)
        updated_total += int(getattr(result, "modified_count", 0))

    if dry_run:
        print("\nMongoDB dry-run complete.")
        print(f"  Matched docs : {matched_total}")
        print(f"  Updated docs : 0 (dry-run)")
    else:
        print("\nMongoDB update complete.")
        print(f"  Matched docs : {matched_total}")
        print(f"  Updated docs : {updated_total}")

    return {"matched": matched_total, "updated": updated_total}


def load_synonyms(synonyms_path: Optional[str]) -> Optional[Dict[str, str]]:
    if not synonyms_path:
        return None
    path = Path(synonyms_path)
    if not path.exists():
        raise FileNotFoundError(f"Synonyms file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Synonyms file must be a JSON object of {token: replacement_token}.")
    # Normalize keys to lower during usage in normalize_title.
    return {str(k): str(v) for k, v in data.items()}


def parse_stopwords(stopwords_arg: Optional[str], stopwords_file: Optional[str]) -> List[str]:
    stops: List[str] = []

    if stopwords_arg:
        # Allow comma-separated or whitespace-separated input.
        parts = re.split(r"[,\n\t ]+", stopwords_arg.strip())
        stops.extend([p.strip().lower() for p in parts if p.strip()])

    if stopwords_file:
        path = Path(stopwords_file)
        if not path.exists():
            raise FileNotFoundError(f"Stopwords file not found: {path}")
        lines = path.read_text(encoding="utf-8").splitlines()
        stops.extend([ln.strip().lower() for ln in lines if ln.strip()])

    # Always include defaults unless explicitly overridden by providing either arg or file.
    if (stopwords_arg is None) and (stopwords_file is None):
        return list(DEFAULT_STOPWORDS)

    # De-dupe while preserving order.
    seen: set[str] = set()
    ordered: List[str] = []
    for s in stops:
        if s not in seen:
            seen.add(s)
            ordered.append(s)
    return ordered


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Clean and normalize ESCO occupation titles (with approvals).")
    parser.add_argument(
        "--source",
        choices=["file", "mongo"],
        default="file",
        help="Where to load data from.",
    )
    parser.add_argument("--input", required=False, help="Path to input CSV or JSON file (source=file).")
    parser.add_argument("--input-format", choices=["csv", "json"], default=None, help="Explicit input format.")
    parser.add_argument("--title-column", default="occupation_title", help="Column containing occupation titles.")

    parser.add_argument(
        "--stopwords",
        default=None,
        help="Comma/space separated stopwords to remove (overrides defaults).",
    )
    parser.add_argument(
        "--stopwords-file",
        default=None,
        help="Path to a newline-separated stopwords file (overrides defaults).",
    )
    parser.add_argument(
        "--synonyms-file",
        default=None,
        help='Optional JSON object { "token": "replacement_token", ... } applied after stopwords removal.',
    )

    parser.add_argument(
        "--approved-file",
        default="approved_title_changes.json",
        help="Path to write/read approved title changes.",
    )
    parser.add_argument(
        "--output-file",
        default="esco_cleaned_titles.json",
        help="Path to write cleaned dataset JSON (after approvals).",
    )
    # Mongo options (source=mongo)
    parser.add_argument(
        "--mongo-uri",
        default=None,
        help="MongoDB connection string. If omitted, the script will try $MONGODB_URI env var.",
    )
    parser.add_argument(
        "--mongo-db",
        default=None,
        help="MongoDB database name. If omitted, inferred from --mongo-uri.",
    )
    parser.add_argument(
        "--mongo-collection",
        default="careerpaths",
        help="MongoDB collection name containing ESCO occupation docs.",
    )
    parser.add_argument(
        "--mongo-query-json",
        default="{}",
        help="MongoDB filter as JSON (e.g. '{\"source\":\"ESCO\"}').",
    )
    parser.add_argument(
        "--mongo-array-element-field",
        default=None,
        help="When your title field is an array-of-objects (e.g. role_titles[].title), specify the element field name (e.g. 'title').",
    )
    parser.add_argument(
        "--skip-review",
        action="store_true",
        help="Skip interactive review and apply using an existing --approved-file.",
    )
    parser.add_argument(
        "--apply-to-mongo",
        action="store_true",
        help="After approvals, apply approved title mappings to MongoDB (in-place).",
    )
    parser.add_argument(
        "--dry-run-mongo",
        action="store_true",
        help="When used with --apply-to-mongo, do not update MongoDB; only show matched counts.",
    )
    parser.add_argument(
        "--mongo-backup-field",
        default=None,
        help="Field name to store the pre-update title. Defaults to '{title_col}__original'.",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Increase log verbosity (-v or -vv).",
    )

    args = parser.parse_args(argv)
    configure_logging(args.verbose)

    stopwords = parse_stopwords(args.stopwords, args.stopwords_file)
    synonyms = load_synonyms(args.synonyms_file)

    logger.info("Stopwords count: %d", len(stopwords))
    if synonyms:
        logger.info("Synonyms count: %d", len(synonyms))

    title_col = args.title_column

    if args.apply_to_mongo:
        approved_mapping = load_approved_mapping(args.approved_file)
        mongo_uri = args.mongo_uri or os.environ.get("MONGODB_URI")  # type: ignore[name-defined]
        if not mongo_uri:
            raise ValueError("MongoDB URI missing. Provide --mongo-uri or set MONGODB_URI env var.")

        apply_changes_to_mongo(
            mongo_uri=mongo_uri,
            mongo_db=args.mongo_db,
            mongo_collection=args.mongo_collection,
            query_json=args.mongo_query_json,
            title_col=title_col,
            approved_mapping=approved_mapping,
            backup_field=args.mongo_backup_field,
            dry_run=args.dry_run_mongo,
        )
        return 0

    if args.source == "file":
        if not args.input:
            raise ValueError("--input is required when --source=file")
        df = load_data(args.input, args.input_format)
        title_counts = None
    else:
        mongo_uri = args.mongo_uri or os.environ.get("MONGODB_URI")  # type: ignore[name-defined]
        if not mongo_uri:
            raise ValueError("MongoDB URI missing. Provide --mongo-uri or set MONGODB_URI env var.")
        df, title_counts, ordered_original_titles = load_data_from_mongo(
            mongo_uri=mongo_uri,
            mongo_db=args.mongo_db,
            mongo_collection=args.mongo_collection,
            query_json=args.mongo_query_json,
            title_col=title_col,
            array_element_field=args.mongo_array_element_field,
        )

    normalizer = lambda x: normalize_title(  # noqa: E731
        x, stopwords=stopwords, synonyms=synonyms, remove_stopwords=True
    )

    original_titles = None
    if args.source == "mongo" and args.mongo_array_element_field:
        original_titles = ordered_original_titles

    proposals = propose_changes(
        df,
        title_col=title_col,
        normalizer=normalizer,
        title_counts=title_counts,
        original_titles=original_titles,
    )
    logger.info("Generated %d title proposals", len(proposals))

    if args.skip_review:
        approved_mapping = load_approved_mapping(args.approved_file)
        print(f"Loaded approved mappings from: {args.approved_file} (count={len(approved_mapping)})")
    else:
        approved_mapping = review_changes(
            proposals,
            approved_changes_path=args.approved_file,
        )

    apply_changes(
        df,
        title_col=title_col,
        approved_mapping=approved_mapping,
        output_path=args.output_file,
        array_element_field=args.mongo_array_element_field,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

