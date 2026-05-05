/**
 * Apply approved ESCO occupation title mappings to MongoDB in-place.
 *
 * Reads `approved_title_changes.json` produced by `esco_title_cleaner.py`:
 *   [
 *     {
 *       "original_title": "...",
 *       "approved_normalized_title": "..."
 *     },
 *     ...
 *   ]
 *
 * Updates `CareerPath.<titleCol>` where it matches `original_title`.
 * Also writes a backup field (default: `${titleCol}__original`) containing the pre-update value.
 *
 * By default, this script updates only the exact equality match on the title field.
 *
 * Usage:
 *   node scripts/apply-approved-title-changes.js --approved-file approved_title_changes.json --title-col title
 *   node scripts/apply-approved-title-changes.js --approved-file approved_title_changes.json --title-col title --dry-run
 *
 * If your titles are stored as an array of objects, e.g. `role_titles: [{ title: "...", ... }, ...]`:
 *   node scripts/apply-approved-title-changes.js --approved-file approved_title_changes.json --title-col role_titles --array-element-field title
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const mongoose = require("mongoose");

async function main() {
  const {
    approvedFile,
    titleCol,
    backupField,
    mongoUri,
    arrayElementField,
    backupFieldFlagProvided,
    dryRun,
    mongoQueryJson,
    limit,
  } = parseArgs(process.argv.slice(2));

  const uri = mongoUri || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MongoDB URI missing. Provide --mongo-uri or set MONGODB_URI in .env");
  }

  await mongoose.connect(uri);

  const CareerPath = require("../src/server/models/CareerPath");

  const mappingPath = path.resolve(process.cwd(), approvedFile);
  if (!fs.existsSync(mappingPath)) {
    throw new Error(`Approved mapping file not found: ${mappingPath}`);
  }

  const mappingRaw = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
  if (!Array.isArray(mappingRaw)) {
    throw new Error("approved-title changes file must be a JSON array.");
  }

  const baseQuery = mongoQueryJson ? JSON.parse(mongoQueryJson) : {};

  let updatedTotal = 0;
  let matchedTotal = 0;

  const updatePairs = [];
  for (const rec of mappingRaw) {
    if (!rec || typeof rec !== "object") continue;
    const originalTitle = rec.original_title;
    const approvedNormalizedTitle = rec.approved_normalized_title;
    if (typeof originalTitle !== "string" || typeof approvedNormalizedTitle !== "string") continue;
    updatePairs.push([originalTitle, approvedNormalizedTitle]);
  }

  if (typeof limit === "number") {
    updatePairs.length = Math.max(0, Math.min(updatePairs.length, limit));
  }

  console.log(`Applying ${updatePairs.length} approved mappings...`);

  for (const [originalTitle, approvedNormalizedTitle] of updatePairs) {
    if (arrayElementField) {
      // Array-of-objects mode, e.g.:
      //   role_titles: [{ title: "technical director", role_id: "...", ... }, ...]
      const arrayField = titleCol;
      const elemField = arrayElementField;

      const filter = {
        ...baseQuery,
        [`${arrayField}.${elemField}`]: originalTitle,
      };

      const matched = await CareerPath.countDocuments(filter);
      matchedTotal += matched;
      if (matched === 0) continue;

      if (dryRun) {
        console.log(
          `DRY RUN: ${matched} docs match ${arrayField}.${elemField}="${originalTitle}" -> "${approvedNormalizedTitle}"`
        );
        continue;
      }

      // In array mode, the pre-update element title equals originalTitle by definition of the filter,
      // so we can store originalTitle directly into the backup field.
      const backupFieldOnElem = backupFieldFlagProvided ? backupField : `${elemField}__original`;
      const update = {
        $set: {
          [`${arrayField}.$[elem].${elemField}`]: approvedNormalizedTitle,
          [`${arrayField}.$[elem].${backupFieldOnElem}`]: originalTitle,
        },
      };
      const options = {
        arrayFilters: [{ [`elem.${elemField}`]: originalTitle }],
      };

      const res = await CareerPath.collection.updateMany(filter, update, options);
      const modified = res && typeof res.modifiedCount === "number" ? res.modifiedCount : 0;
      updatedTotal += modified;

      console.log(
        `UPDATED: ${modified} docs: ${arrayField}.${elemField} "${originalTitle}" -> "${approvedNormalizedTitle}"`
      );
      continue;
    }

    // Non-array mode: exact match on a top-level string field.
    const filter = {
      ...baseQuery,
      [titleCol]: originalTitle,
    };

    const matched = await CareerPath.countDocuments(filter);
    matchedTotal += matched;
    if (matched === 0) continue;

    if (dryRun) {
      console.log(`DRY RUN: ${matched} docs match ${titleCol}="${originalTitle}" -> "${approvedNormalizedTitle}"`);
      continue;
    }

    const updatePipeline = [
      {
        $set: {
          [backupField]: `$${titleCol}`,
          [titleCol]: approvedNormalizedTitle,
        },
      },
    ];

    const res = await CareerPath.collection.updateMany(filter, updatePipeline);
    const modified = res && typeof res.modifiedCount === "number" ? res.modifiedCount : 0;
    updatedTotal += modified;

    console.log(`UPDATED: ${modified} docs: "${originalTitle}" -> "${approvedNormalizedTitle}"`);
  }

  if (dryRun) {
    console.log(`\nMongo dry-run complete.`);
    console.log(`  Total matched docs: ${matchedTotal}`);
    console.log(`  Total updated docs: 0`);
  } else {
    console.log(`\nMongo update complete.`);
    console.log(`  Total matched docs : ${matchedTotal}`);
    console.log(`  Total updated docs : ${updatedTotal}`);
  }

  await mongoose.disconnect();
}

function parseArgs(argv) {
  // Very small hand-rolled parser to avoid extra deps.
  const get = (flag, defaultValue) => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return defaultValue;
    const v = argv[idx + 1];
    return v === undefined ? defaultValue : v;
  };

  const has = (flag) => argv.includes(flag);

  const approvedFile = get("--approved-file", "approved_title_changes.json");
  const titleCol = get("--title-col", "title");
  const backupFieldFlagProvided = has("--backup-field");
  const backupDefaultBase = String(titleCol).split(".").pop() || titleCol;
  const backupField = get("--backup-field", `${backupDefaultBase}__original`);
  const mongoQueryJson = get("--mongo-query-json", "{}");
  const mongoUri = get("--mongo-uri", "");
  const arrayElementField = get("--array-element-field", "");
  const dryRun = has("--dry-run");
  const limitRaw = get("--limit", "");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) {
    throw new Error("--limit must be a non-negative number");
  }

  return {
    approvedFile,
    titleCol,
    backupField,
    backupFieldFlagProvided,
    mongoUri,
    arrayElementField: arrayElementField ? arrayElementField : null,
    dryRun,
    mongoQueryJson,
    limit,
  };
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

