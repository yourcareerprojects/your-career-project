#!/usr/bin/env node
/**
 * buildSeniorityLevels.js
 *
 * Migration script that infers a seniority level for every CareerPath document
 * and persists it in the `seniority` subdocument.
 *
 * Seniority Scale:
 *   0 = Entry / Intern / Trainee
 *   1 = Junior
 *   2 = Junior–Mid
 *   3 = Mid-level
 *   4 = Senior
 *   5 = Lead / Principal
 *   6 = Head / Director / Expert
 *
 * Usage:
 *   node scripts/buildSeniorityLevels.js [--force] [--batch-size=250] [--dry-run]
 *
 * Flags:
 *   --force       Re-infer seniority even if one already exists
 *   --batch-size  Number of documents per processing batch (default 250)
 *   --dry-run     Print what would happen without writing to the database
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const { inferSeniority, SENIORITY_LABELS } = require('../src/server/services/seniorityService');

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

  console.log('=== Build Seniority Levels ===');
  console.log(`  MongoDB:    ${MONGODB_URI}`);
  console.log(`  Force:      ${flags.force}`);
  console.log(`  Batch size: ${flags.batchSize}`);
  console.log(`  Dry run:    ${flags.dryRun}`);
  console.log('');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Determine which documents to process
  const filter = flags.force
    ? {}
    : { $or: [{ seniority: null }, { seniority: { $exists: false } }] };

  const totalDocs = await CareerPath.countDocuments(filter);
  console.log(`\nDocuments to process: ${totalDocs}`);

  if (totalDocs === 0) {
    console.log('Nothing to do. Use --force to rebuild existing seniority levels.');
    await mongoose.disconnect();
    return;
  }

  // Track distribution for summary
  const distribution = {};
  for (let i = 0; i <= 6; i++) distribution[i] = 0;

  let processed = 0;
  let built = 0;
  let errors = 0;
  let lastId = null;

  while (processed < totalDocs) {
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
        const result = inferSeniority({
          title: doc.title,
          description: doc.description,
          requiredSkills: doc.requiredSkills,
          iscoGroup: doc.iscoGroup,
          skillModel: doc.skillModel
        });

        distribution[result.seniority_level]++;

        if (!flags.dryRun) {
          bulkOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: {
                  seniority: result,
                  lastUpdated: new Date()
                }
              }
            }
          });
        }

        built++;

        // Log samples
        if (built === 1 || built % 500 === 0) {
          console.log(`\n--- Sample [${doc.title}] ---`);
          console.log(`  Level:      ${result.seniority_level} (${result.seniority_label})`);
          console.log(`  Reasoning:  ${result.seniority_reasoning}`);
          console.log(`  Confidence: ${result.extraction_confidence}`);
        }
      } catch (err) {
        errors++;
        console.error(`  Error processing ${doc.escoId}: ${err.message}`);
      }
    }

    if (bulkOps.length > 0 && !flags.dryRun) {
      await CareerPath.bulkWrite(bulkOps, { ordered: false });
    }

    processed += batch.length;
    const pct = Math.round((processed / totalDocs) * 100);
    process.stdout.write(`\rProgress: ${processed}/${totalDocs} (${pct}%)  built=${built} errors=${errors}`);
  }

  console.log('\n');
  console.log('=== Distribution ===');
  for (let i = 0; i <= 6; i++) {
    const bar = '█'.repeat(Math.round(distribution[i] / totalDocs * 60));
    const pct = ((distribution[i] / totalDocs) * 100).toFixed(1);
    console.log(`  ${i} ${SENIORITY_LABELS[i].padEnd(26)} ${String(distribution[i]).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
  }

  console.log('\n=== Summary ===');
  console.log(`  Total processed: ${processed}`);
  console.log(`  Levels inferred: ${built}`);
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
