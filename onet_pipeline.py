import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple

import pandas as pd


def configure_logging() -> None:
    """Configure basic progress logging."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )


def load_tsv_with_fallback(file_path: Path) -> pd.DataFrame:
    """
    Load a TSV file with fallback encodings.
    Tries utf-8 first, then latin-1 if needed.
    """
    try:
        return pd.read_csv(file_path, sep="\t", dtype=str, encoding="utf-8")
    except UnicodeDecodeError:
        logging.warning("UTF-8 decode failed for %s. Falling back to latin-1.", file_path.name)
        return pd.read_csv(file_path, sep="\t", dtype=str, encoding="latin-1")


def load_files(data_dir: Path) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load O*NET occupation, skills, and task files."""
    occ_path = data_dir / "Occupation Data.txt"
    skills_path = data_dir / "Skills.txt"
    tasks_path = data_dir / "Task Statements.txt"

    missing = [p.name for p in [occ_path, skills_path, tasks_path] if not p.exists()]
    if missing:
        raise FileNotFoundError(f"Missing required files in {data_dir}: {missing}")

    logging.info("Loading files from %s", data_dir)
    occupations_df = load_tsv_with_fallback(occ_path)
    skills_df = load_tsv_with_fallback(skills_path)
    tasks_df = load_tsv_with_fallback(tasks_path)
    logging.info(
        "Loaded rows -> occupations: %d, skills: %d, tasks: %d",
        len(occupations_df),
        len(skills_df),
        len(tasks_df),
    )
    return occupations_df, skills_df, tasks_df


def clean_text(value: object) -> str:
    """Normalize text fields: strip and collapse whitespace."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    if not text:
        return ""
    return " ".join(text.split())


def process_occupations(df: pd.DataFrame) -> pd.DataFrame:
    """Extract and clean core occupation fields."""
    required_cols = ["O*NET-SOC Code", "Title", "Description"]
    missing = [col for col in required_cols if col not in df.columns]
    if missing:
        raise KeyError(f"Missing columns in Occupation Data: {missing}")

    occupations = df[required_cols].copy()
    occupations = occupations.rename(
        columns={
            "O*NET-SOC Code": "onet_id",
            "Title": "title",
            "Description": "description",
        }
    )
    occupations["onet_id"] = occupations["onet_id"].map(clean_text)
    occupations["title"] = occupations["title"].map(clean_text)
    occupations["description"] = occupations["description"].map(clean_text)

    occupations = occupations[occupations["title"] != ""].copy()
    occupations = occupations.drop_duplicates(subset=["onet_id"], keep="first")
    occupations = occupations.reset_index(drop=True)
    logging.info("Processed occupations: %d unique rows", len(occupations))
    return occupations


def process_skills(df: pd.DataFrame, max_skills: int = 15, lowercase_skills: bool = False) -> pd.DataFrame:
    """Filter, rank, and aggregate skills by occupation."""
    required_cols = ["O*NET-SOC Code", "Element Name", "Scale ID", "Data Value"]
    missing = [col for col in required_cols if col not in df.columns]
    if missing:
        raise KeyError(f"Missing columns in Skills: {missing}")

    skills = df[required_cols].copy()
    skills = skills.rename(
        columns={
            "O*NET-SOC Code": "onet_id",
            "Element Name": "skill_name",
            "Scale ID": "scale_id",
            "Data Value": "importance",
        }
    )
    skills["onet_id"] = skills["onet_id"].map(clean_text)
    skills["skill_name"] = skills["skill_name"].map(clean_text)
    if lowercase_skills:
        skills["skill_name"] = skills["skill_name"].str.lower()
    skills["scale_id"] = skills["scale_id"].map(clean_text)
    skills["importance"] = pd.to_numeric(skills["importance"], errors="coerce")

    skills = skills[skills["scale_id"] == "IM"].copy()
    skills = skills.dropna(subset=["importance"])
    skills = skills[skills["skill_name"] != ""]

    # Keep strongest duplicate skill per occupation.
    skills = (
        skills.sort_values(["onet_id", "importance"], ascending=[True, False])
        .drop_duplicates(subset=["onet_id", "skill_name"], keep="first")
    )

    skills = skills.sort_values(["onet_id", "importance"], ascending=[True, False])
    skills_top = skills.groupby("onet_id", as_index=False).head(max_skills).copy()
    skills_top["skill_record"] = skills_top.apply(
        lambda row: {
            "name": row["skill_name"],
            "importance": round(float(row["importance"]) / 5.0, 4),
        },
        axis=1,
    )
    grouped = (
        skills_top.groupby("onet_id")["skill_record"]
        .apply(list)
        .reset_index(name="skills")
    )
    logging.info("Processed skills for occupations: %d", len(grouped))
    return grouped


def process_tasks(df: pd.DataFrame, max_tasks: int = 10) -> pd.DataFrame:
    """Aggregate top tasks by occupation."""
    required_cols = ["O*NET-SOC Code", "Task"]
    missing = [col for col in required_cols if col not in df.columns]
    if missing:
        raise KeyError(f"Missing columns in Task Statements: {missing}")

    tasks = df[required_cols].copy()
    tasks = tasks.rename(columns={"O*NET-SOC Code": "onet_id", "Task": "task"})
    tasks["onet_id"] = tasks["onet_id"].map(clean_text)
    tasks["task"] = tasks["task"].map(clean_text)
    tasks = tasks[tasks["task"] != ""]
    tasks = tasks.drop_duplicates(subset=["onet_id", "task"], keep="first")

    grouped = (
        tasks.groupby("onet_id")["task"]
        .apply(lambda s: s.head(max_tasks).tolist())
        .reset_index(name="tasks")
    )
    logging.info("Processed tasks for occupations: %d", len(grouped))
    return grouped


def build_combined_text(title: str, description: str, skills: List[Dict[str, object]], tasks: List[str]) -> str:
    """Create embedding-optimized combined text field."""
    parts: List[str] = []
    normalize_sentence = lambda txt: clean_text(txt).rstrip(" .!?")

    if title:
        parts.append(f"{normalize_sentence(title)}.")
    if description:
        parts.append(f"{normalize_sentence(description)}.")

    skill_names = [clean_text(s.get("name", "")) for s in skills if clean_text(s.get("name", ""))]
    if skill_names:
        parts.append(f"Key skills: {', '.join(skill_names)}.")

    task_text = [clean_text(t) for t in tasks if clean_text(t)]
    if task_text:
        parts.append(f"Tasks: {' '.join(task_text)}")

    return " ".join(parts).strip()


def merge_data(occupations: pd.DataFrame, skills: pd.DataFrame, tasks: pd.DataFrame) -> List[Dict[str, object]]:
    """Merge occupations with skills and tasks and build final records."""
    merged = occupations.merge(skills, on="onet_id", how="left").merge(tasks, on="onet_id", how="left")

    merged["skills"] = merged["skills"].apply(lambda x: x if isinstance(x, list) else [])
    merged["tasks"] = merged["tasks"].apply(lambda x: x if isinstance(x, list) else [])

    records: List[Dict[str, object]] = []
    for _, row in merged.iterrows():
        record = {
            "onet_id": clean_text(row["onet_id"]),
            "title": clean_text(row["title"]),
            "description": clean_text(row["description"]),
            "skills": row["skills"],
            "tasks": row["tasks"],
        }

        # Remove empty or malformed skill entries.
        cleaned_skills = []
        seen_skill_names = set()
        for skill in record["skills"]:
            name = clean_text(skill.get("name", ""))
            importance = skill.get("importance")
            if not name or name in seen_skill_names:
                continue
            try:
                importance_num = float(importance)
            except (TypeError, ValueError):
                continue
            cleaned_skills.append({"name": name, "importance": round(importance_num, 4)})
            seen_skill_names.add(name)
        record["skills"] = cleaned_skills

        cleaned_tasks = []
        seen_tasks = set()
        for task in record["tasks"]:
            task_text = clean_text(task)
            if not task_text or task_text in seen_tasks:
                continue
            cleaned_tasks.append(task_text)
            seen_tasks.add(task_text)
        record["tasks"] = cleaned_tasks

        record["combined_text_for_embedding"] = build_combined_text(
            title=record["title"],
            description=record["description"],
            skills=record["skills"],
            tasks=record["tasks"],
        )
        records.append(record)

    logging.info("Merged final occupation records: %d", len(records))
    return records


def save_output(records: List[Dict[str, object]], output_path: Path) -> None:
    """Save records to JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    logging.info("Saved output JSON: %s", output_path)


def print_summary(records: List[Dict[str, object]]) -> None:
    """Print dataset summary metrics."""
    total = len(records)
    avg_skills = (sum(len(r.get("skills", [])) for r in records) / total) if total else 0.0
    avg_tasks = (sum(len(r.get("tasks", [])) for r in records) / total) if total else 0.0

    print("\nPipeline Summary")
    print("----------------")
    print(f"Occupations: {total}")
    print(f"Average skills per occupation: {avg_skills:.2f}")
    print(f"Average tasks per occupation: {avg_tasks:.2f}")


def run_pipeline(
    data_dir: Path,
    output_file: Path,
    max_skills: int = 15,
    max_tasks: int = 10,
    lowercase_skills: bool = False,
) -> None:
    occupations_raw, skills_raw, tasks_raw = load_files(data_dir)
    occupations = process_occupations(occupations_raw)
    skills = process_skills(skills_raw, max_skills=max_skills, lowercase_skills=lowercase_skills)
    tasks = process_tasks(tasks_raw, max_tasks=max_tasks)
    records = merge_data(occupations, skills, tasks)
    save_output(records, output_file)
    print_summary(records)


if __name__ == "__main__":
    configure_logging()
    base_dir = Path(r"C:\Users\nicol\Documents\7.Development\ONET dataset")
    output_path = Path(r"C:\Users\nicol\Documents\7.Development\onet_prepared.json")
    run_pipeline(
        data_dir=base_dir,
        output_file=output_path,
        max_skills=15,
        max_tasks=10,
        lowercase_skills=False,
    )
