#!/usr/bin/env python3
"""
Safely replace a MongoDB collection with data from a JSON file.

Workflow:
1) Load and validate JSON records.
2) Insert into temporary collection (`roles_new`) in batches.
3) Verify count and create unique index.
4) Replace old collection by dropping target then renaming temp -> target.

Safety:
- Original target collection is never dropped unless staging + verification + indexing succeed.
- On error, script keeps existing target intact and attempts to clean up temp collection.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from typing import Iterable, List, Sequence

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, PyMongoError


DEFAULT_JSON_PATH = "final_roles_clustered.json"
DEFAULT_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DEFAULT_DB_NAME = os.getenv("MONGODB_DB", "career-path-explorer")
DEFAULT_TARGET_COLLECTION = "careerpaths"
DEFAULT_TEMP_COLLECTION = "careerpaths_new"
DEFAULT_UNIQUE_INDEX_FIELD = "escoId"
DEFAULT_BATCH_SIZE = 1000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Safely replace a MongoDB collection using a JSON dataset."
    )
    parser.add_argument(
        "--uri",
        default=DEFAULT_URI,
        help=f"MongoDB connection string (default: {DEFAULT_URI!r} or MONGODB_URI env).",
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB_NAME,
        help=f"Database name (default: {DEFAULT_DB_NAME!r} or MONGODB_DB env).",
    )
    parser.add_argument(
        "--file",
        default=DEFAULT_JSON_PATH,
        help=f"Path to input JSON file (default: {DEFAULT_JSON_PATH!r}).",
    )
    parser.add_argument(
        "--target-collection",
        default=DEFAULT_TARGET_COLLECTION,
        help=f"Target collection name (default: {DEFAULT_TARGET_COLLECTION!r}).",
    )
    parser.add_argument(
        "--temp-collection",
        default=DEFAULT_TEMP_COLLECTION,
        help=f"Temporary collection name (default: {DEFAULT_TEMP_COLLECTION!r}).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Batch insert size (default: {DEFAULT_BATCH_SIZE}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and report only; do not write to MongoDB.",
    )
    parser.add_argument(
        "--drop-existing",
        action="store_true",
        help=(
            "Allow dropping an existing temporary collection before insert. "
            "Useful when rerunning after interrupted runs."
        ),
    )
    parser.add_argument(
        "--unique-index-field",
        default=DEFAULT_UNIQUE_INDEX_FIELD,
        help=(
            "Field to index uniquely after staging "
            f"(default: {DEFAULT_UNIQUE_INDEX_FIELD!r})."
        ),
    )
    return parser.parse_args()


def load_json_records(file_path: str) -> List[dict]:
    print(f"[INFO] Loading JSON file: {file_path}")
    start = time.time()
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError:
        # Fallback for NDJSON/JSONL input.
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                records: List[dict] = []
                for line_no, raw in enumerate(f, start=1):
                    line = raw.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise ValueError(
                            f"Invalid JSON at line {line_no} in NDJSON input: {exc}"
                        ) from exc
                    records.append(item)
                data = records
        except OSError as exc:
            raise ValueError(f"Failed to read input file {file_path}: {exc}") from exc
    except FileNotFoundError as exc:
        raise ValueError(f"Input file not found: {file_path}") from exc

    if isinstance(data, dict):
        if "roles" in data and isinstance(data["roles"], list):
            data = data["roles"]
        else:
            raise ValueError(
                "JSON object input is missing a list field named 'roles'."
            )
    elif not isinstance(data, list):
        raise ValueError(
            "Unsupported JSON structure. Expected an array, an object with 'roles', or NDJSON lines."
        )

    elapsed = time.time() - start
    print(f"[INFO] Loaded {len(data):,} records in {elapsed:.2f}s")
    return data


def validate_records(records: Sequence[dict]) -> None:
    print("[INFO] Validating record structure...")
    if not records:
        raise ValueError("Input dataset is empty. Refusing to replace collection with 0 records.")

    missing_id = 0
    invalid_type = 0
    for idx, item in enumerate(records):
        if not isinstance(item, dict):
            invalid_type += 1
            continue
        if "id" not in item or item["id"] in (None, ""):
            missing_id += 1

        if (idx + 1) % 100000 == 0:
            print(f"[INFO] Validation progress: {idx + 1:,}/{len(records):,}")

    if invalid_type > 0:
        raise ValueError(f"Validation failed: {invalid_type:,} records are not JSON objects.")
    if missing_id > 0:
        raise ValueError(f"Validation failed: {missing_id:,} records are missing a valid 'id'.")

    print("[INFO] Validation passed.")


def chunked(seq: Sequence[dict], size: int) -> Iterable[Sequence[dict]]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def is_empty_value(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def normalize_records(records: Sequence[dict]) -> List[dict]:
    """
    Normalize role records for downstream consistency.

    Current normalization:
    - Map `tasks` -> `key_responsibilities` when missing/empty.
    - Map role JSON schema to CareerPath schema expected by the app:
      `id` -> `escoId`, `occupation_group` -> `iscoGroup`,
      `required_skills` -> `requiredSkills`, etc.
    """
    print("[INFO] Normalizing records...")
    normalized: List[dict] = []
    mapped_count = 0

    for idx, item in enumerate(records, start=1):
        role = dict(item)
        has_key_responsibilities = (
            "key_responsibilities" in role
            and not is_empty_value(role.get("key_responsibilities"))
        )
        has_tasks = "tasks" in role and not is_empty_value(role.get("tasks"))

        if not has_key_responsibilities and has_tasks:
            role["key_responsibilities"] = role["tasks"]
            mapped_count += 1

        required_skills = role.get("required_skills")
        if not isinstance(required_skills, list):
            required_skills = []
        optional_skills = role.get("optional_skills")
        if not isinstance(optional_skills, list):
            optional_skills = []
        alt_titles = role.get("alternative_titles")
        if not isinstance(alt_titles, list):
            alt_titles = []
        key_responsibilities = role.get("key_responsibilities")
        if not isinstance(key_responsibilities, list):
            key_responsibilities = []

        now = dt.datetime.now(dt.UTC)
        careerpath_doc = {
            "escoId": role.get("id") or role.get("esco_id"),
            "code": role.get("code"),
            "iscoGroup": role.get("occupation_group"),
            "title": role.get("title"),
            "altTitles": alt_titles,
            "description": role.get("description"),
            "requiredSkills": required_skills,
            "requiredSkillUris": role.get("required_skill_uris", []),
            "requiredSkillKeys": [
                s.strip().lower() for s in required_skills if isinstance(s, str) and s.strip()
            ],
            "skillModel": {
                "core_skills": required_skills,
                "optional_skills": optional_skills,
                "skill_weights": {},
                "extraction_confidence": 1.0,
                "built_at": now,
                "built_with": "json_import",
            },
            "keyResponsibilities": {
                "responsibilities": key_responsibilities,
                "extraction_confidence": 1.0 if key_responsibilities else 0.0,
                "built_at": now,
                "built_with": "json_import",
            },
            "source": role.get("source", "ESCO"),
            "sourceVersion": role.get("sourceVersion", "v1.2.0"),
            "importedFrom": "json",
            "lastUpdated": now,
            # Keep raw role payload for traceability/debugging.
            "rawRole": role,
        }
        normalized.append(careerpath_doc)

        if idx % 100000 == 0:
            print(f"[INFO] Normalization progress: {idx:,}/{len(records):,}")

    print(
        "[INFO] Normalization complete: "
        f"mapped tasks -> key_responsibilities for {mapped_count:,} records."
    )
    return normalized


def stage_into_temp_collection(
    db: Database,
    records: Sequence[dict],
    temp_collection_name: str,
    batch_size: int,
    drop_existing: bool,
    unique_index_field: str,
) -> Collection:
    if batch_size <= 0:
        raise ValueError("Batch size must be > 0.")

    temp_coll = db[temp_collection_name]
    existing_names = set(db.list_collection_names())

    if temp_collection_name in existing_names:
        if not drop_existing:
            raise RuntimeError(
                f"Temporary collection '{temp_collection_name}' already exists. "
                "Use --drop-existing to overwrite it safely."
            )
        print(f"[INFO] Dropping existing temporary collection '{temp_collection_name}'...")
        temp_coll.drop()

    total = len(records)
    inserted = 0
    print(
        f"[INFO] Inserting {total:,} records into temporary collection "
        f"'{temp_collection_name}' in batches of {batch_size}..."
    )

    for batch in chunked(records, batch_size):
        temp_coll.insert_many(batch, ordered=False)
        inserted += len(batch)
        if inserted % 1000 == 0 or inserted == total:
            print(f"[INFO] Insert progress: {inserted:,}/{total:,}")

    print("[INFO] Verifying staged document count...")
    staged_count = temp_coll.count_documents({})
    if staged_count != total:
        raise RuntimeError(
            f"Count mismatch after staging: expected {total:,}, found {staged_count:,}."
        )

    print(f"[INFO] Creating unique index on '{unique_index_field}'...")
    temp_coll.create_index(
        [(unique_index_field, ASCENDING)],
        unique=True,
        name=f"{unique_index_field}_unique",
    )
    print("[INFO] Temporary collection staged and verified.")
    return temp_coll


def replace_collection(
    db: Database,
    target_collection_name: str,
    temp_collection_name: str,
) -> None:
    print(
        f"[INFO] Replacing '{target_collection_name}' with '{temp_collection_name}'..."
    )

    target_coll = db[target_collection_name]
    temp_coll = db[temp_collection_name]

    # Final sanity check before destructive step.
    staged_count = temp_coll.count_documents({})
    if staged_count == 0:
        raise RuntimeError("Temporary collection is empty; aborting replacement.")

    target_exists = target_collection_name in set(db.list_collection_names())
    if target_exists:
        print(f"[INFO] Dropping old collection '{target_collection_name}'...")
        target_coll.drop()

    print(
        f"[INFO] Renaming '{temp_collection_name}' -> '{target_collection_name}'..."
    )
    temp_coll.rename(target_collection_name)
    print("[INFO] Replacement complete.")


def connect_database(uri: str, db_name: str) -> Database:
    print(f"[INFO] Connecting to MongoDB: {uri}")
    client = MongoClient(uri, serverSelectionTimeoutMS=15000)
    # Force connection test.
    client.admin.command("ping")
    print(f"[INFO] Connected. Using database: {db_name}")
    return client[db_name]


def print_summary(records: Sequence[dict], args: argparse.Namespace) -> None:
    print("\n=== SUMMARY ===")
    print(f"Input file          : {args.file}")
    print(f"Mongo URI           : {args.uri}")
    print(f"Database            : {args.db}")
    print(f"Target collection   : {args.target_collection}")
    print(f"Temp collection     : {args.temp_collection}")
    print(f"Batch size          : {args.batch_size}")
    print(f"Unique index field  : {args.unique_index_field}")
    print(f"Dry run             : {args.dry_run}")
    print(f"Drop existing temp  : {args.drop_existing}")
    print(f"Input record count  : {len(records):,}")
    print("==============\n")


def main() -> int:
    args = parse_args()
    start = time.time()

    try:
        records = load_json_records(args.file)
        validate_records(records)
        records = normalize_records(records)
        print_summary(records, args)

        if args.dry_run:
            print("[INFO] Dry run enabled. No database writes performed.")
            print("[SUCCESS] Dry run completed.")
            return 0

        db = connect_database(args.uri, args.db)
        stage_into_temp_collection(
            db=db,
            records=records,
            temp_collection_name=args.temp_collection,
            batch_size=args.batch_size,
            drop_existing=args.drop_existing,
            unique_index_field=args.unique_index_field,
        )
        replace_collection(
            db=db,
            target_collection_name=args.target_collection,
            temp_collection_name=args.temp_collection,
        )

        elapsed = time.time() - start
        print(
            f"[SUCCESS] Collection '{args.target_collection}' fully replaced "
            f"with {len(records):,} records in {elapsed:.2f}s."
        )
        return 0

    except (ValueError, RuntimeError, DuplicateKeyError, PyMongoError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        print(
            "[ERROR] Replacement aborted. Original target collection was not dropped "
            "unless replacement reached final rename stage.",
            file=sys.stderr,
        )
        return 1
    except Exception as exc:  # Defensive catch-all for unexpected failures.
        print(f"[ERROR] Unexpected failure: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
