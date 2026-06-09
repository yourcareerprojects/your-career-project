#!/usr/bin/env node
/**
 * buildSkillModels.js
 *
 * Migration script that transforms the unstructured ESCO skill data already
 * stored in each CareerPath document into a structured, machine-readable
 * skill model and persists it back to the database.
 *
 * Input (per CareerPath document):
 *   - title          (string)
 *   - description    (string)
 *   - requiredSkills (string[])
 *
 * Output (stored as CareerPath.skillModel):
 *   {
 *     core_skills:           string[]           – all essential skills (≥3)
 *     optional_skills:       string[]           – beneficial, not blocking
 *     skill_weights:         { [skill]: number} – 0.1-1.0 relevance weight
 *     extraction_confidence: number             – 0.0-1.0
 *     built_at:              Date
 *     built_with:            string             – "esco_csv" | "fallback"
 *   }
 *
 * Usage:
 *   node scripts/buildSkillModels.js [--force] [--batch-size=250] [--dry-run]
 *
 * Flags:
 *   --force       Rebuild skill models even if one already exists
 *   --batch-size  Number of documents per processing batch (default 250)
 *   --dry-run     Print what would happen without writing to the database
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const { loadEscoSkillData, buildSkillModel } = require('../src/server/services/skillModelService');
const { getLocalizedFieldLenient } = require('../src/server/utils/i18nFields');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

// ── CLI argument parsing ───────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    force: false,
    batchSize: 250,
    dryRun: false,
  };

  for (const arg of args) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--batch-size=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.batchSize = n;
    }
  }

  return flags;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs();

  console.log('=== Build Skill Models ===');
  console.log(`  MongoDB:    ${MONGODB_URI}`);
  console.log(`  Force:      ${flags.force}`);
  console.log(`  Batch size: ${flags.batchSize}`);
  console.log(`  Dry run:    ${flags.dryRun}`);
  console.log('');

  // Connect to MongoDB
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Load ESCO CSV data into memory
  console.log('Loading ESCO skill data from CSV...');
  await loadEscoSkillData();
  console.log('ESCO skill data loaded.');

  // Determine which documents to process
  const filter = flags.force
    ? {}
    : { $or: [{ skillModel: null }, { skillModel: { $exists: false } }] };

  const totalDocs = await CareerPath.countDocuments(filter);
  console.log(`\nDocuments to process: ${totalDocs}`);

  if (totalDocs === 0) {
    console.log('Nothing to do. Use --force to rebuild existing skill models.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let built = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches
  let lastId = null;

  while (processed < totalDocs) {
    // Cursor-based pagination (more efficient than skip)
    const query = lastId
      ? { ...filter, _id: { $gt: lastId } }
      : { ...filter };

    const batch = await CareerPath.find(query)
      .sort({ _id: 1 })
      .limit(flags.batchSize)
      .lean();

    if (batch.length === 0) break;

    const bulkOps = [];

    for (const doc of batch) {
      lastId = doc._id;

      try {
        const model = buildSkillModel(doc.escoId, {
          title: doc.title,
          description: doc.description,
          requiredSkills: doc.requiredSkills
        });

        if (!model) {
          skipped++;
          continue;
        }

        if (!flags.dryRun) {
          bulkOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: {
                  skillModel: model,
                  lastUpdated: new Date()
                }
              }
            }
          });
        }

        built++;

        // Log a sample every 500 documents
        if (built === 1 || built % 500 === 0) {
          console.log(`\n--- Sample [${getLocalizedFieldLenient(doc.title)}] ---`);
          console.log(`  Core skills (${model.core_skills.length}):     ${model.core_skills.join(', ')}`);
          console.log(`  Optional skills (${model.optional_skills.length}):  ${model.optional_skills.slice(0, 5).join(', ')}${model.optional_skills.length > 5 ? '...' : ''}`);
          console.log(`  Confidence:        ${model.extraction_confidence}`);
          console.log(`  Built with:        ${model.built_with}`);
        }
      } catch (err) {
        errors++;
        console.error(`  Error processing ${doc.escoId}: ${err.message}`);
      }
    }

    // Write batch to database
    if (bulkOps.length > 0 && !flags.dryRun) {
      await CareerPath.bulkWrite(bulkOps, { ordered: false });
    }

    processed += batch.length;
    const pct = Math.round((processed / totalDocs) * 100);
    process.stdout.write(`\rProgress: ${processed}/${totalDocs} (${pct}%)  built=${built} skipped=${skipped} errors=${errors}`);
  }

  console.log('\n');
  console.log('=== Summary ===');
  console.log(`  Total processed: ${processed}`);
  console.log(`  Models built:    ${built}`);
  console.log(`  Skipped (no data): ${skipped}`);
  console.log(`  Errors:          ${errors}`);

  if (flags.dryRun) {
    console.log('\n  (Dry run — no changes were written to the database)');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
