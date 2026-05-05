import json
from pathlib import Path


base = Path(r"C:\Users\nicol\Documents\7.Development")
final = json.loads((base / "esco_onet_mapping_final.json").read_text(encoding="utf-8"))
esco = json.loads((base / "esco_deduplicated_final.json").read_text(encoding="utf-8"))
esco_by_uri = {x.get("conceptUri"): x for x in esco if x.get("conceptUri")}

print("=== 20 ESCO -> ONET MATCHES (sample) ===")
for i, row in enumerate(
    sorted(final, key=lambda x: (x.get("esco_title", ""), x.get("onet_title", "")))[:20],
    start=1,
):
    print(
        f"{i:02d}. ESCO: {row.get('esco_title')} | "
        f"ONET: {row.get('onet_title')} ({row.get('onet_id')}) | "
        f"score={row.get('confidence_score')}"
    )

# Build clusters from canonical_id relationships
clusters = {}
for r in esco:
    if r.get("is_duplicate") is True and r.get("canonical_id"):
        clusters.setdefault(r.get("canonical_id"), set()).add(r.get("conceptUri"))

cluster_rows = []
final_by_esco = {x.get("esco_id"): x for x in final if x.get("esco_id")}
for canonical_uri, dup_set in clusters.items():
    members = set(dup_set)
    members.add(canonical_uri)
    size = len(members)
    can_row = esco_by_uri.get(canonical_uri, {})
    mapped = final_by_esco.get(canonical_uri)
    cluster_rows.append((size, canonical_uri, can_row.get("preferredLabel", ""), mapped))

cluster_rows.sort(key=lambda x: (-x[0], x[2]))
print("\n=== 4 LARGEST CLUSTERS (canonical + duplicates) ===")
for rank, (size, canonical_uri, can_title, mapped) in enumerate(cluster_rows[:4], start=1):
    print(f"\n{rank}. Cluster size: {size}")
    print(f"   Canonical ESCO: {can_title} ({canonical_uri})")
    if mapped:
        print(
            f"   Mapped ONET: {mapped.get('onet_title')} "
            f"({mapped.get('onet_id')}) | score={mapped.get('confidence_score')}"
        )
    else:
        print("   Mapped ONET: [no final mapping found for canonical]")

    members = [
        r
        for r in esco
        if (r.get("conceptUri") == canonical_uri)
        or (r.get("canonical_id") == canonical_uri and r.get("is_duplicate") is True)
    ]
    members = sorted(
        members,
        key=lambda x: (0 if x.get("conceptUri") == canonical_uri else 1, x.get("preferredLabel", "")),
    )
    for m in members:
        tag = "canonical" if m.get("conceptUri") == canonical_uri else "duplicate"
        print(f"     - [{tag}] {m.get('preferredLabel')} ({m.get('conceptUri')})")
