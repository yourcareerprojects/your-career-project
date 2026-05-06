#!/usr/bin/env node
/**
 * buildRoleVectors.js
 *
 * Builds hybrid role vectors for every CareerPath that has roleIdentity.
 *
 * Prerequisite: Run buildRoleIdentityTexts first.
 *
 * Output (stored as CareerPath.roleVectors; fusion order matches embed/build order):
 *   {
 *     structured_vector_occupation_group: number[],
 *     structured_vector_skill_domains: number[],
 *     structured_vector_responsibilities: number[],
 *     structured_vector_required_skills: number[],
 *     structured_vector_optional_skills: number[],
 *     structured_vector_seniority: null (deprecated; seniority handled in scorer penalty),
 *     identity_vector: number[],
 *     hybrid_vector: number[],
 *     finalVectors: { default: number[], nextRole: number[], outOfTheBox: number[] },
 *     built_at: Date,
 *     dims: 256
 *   }
 *
 * Usage:
 *   node scripts/buildRoleVectors.js [options]
 *
 * Options:
 *   --force       Rebuild even if roleVectors already exists
 *   --batch-size=N  Documents per batch (default 250)
 *   --dry-run     Preview without writing
 *   --limit=N     Process at most N documents
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const { buildRoleVectors } = require('../src/server/services/embedding/roleVectorService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    force: false,
    batchSize: 250,
    dryRun: false,
    limit: Infinity,
  };

  for (const arg of args) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--batch-size=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.batchSize = n;
    } else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.limit = n;
    }
  }

  return flags;
}

async function main() {
  const flags = parseArgs();

  console.log('=== Build Role Vectors ===');
  console.log(`  MongoDB:    ${MONGODB_URI}`);
  console.log(`  Force:      ${flags.force}`);
  console.log(`  Batch size: ${flags.batchSize}`);
  console.log(`  Limit:      ${flags.limit === Infinity ? 'none' : flags.limit}`);
  console.log(`  Dry run:    ${flags.dryRun}`);
  console.log('');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const filter = flags.force
    ? { 'roleIdentity.role_identity_text': { $exists: true, $ne: '' } }
    : {
        'roleIdentity.role_identity_text': { $exists: true, $ne: '' },
        $or: [
          { roleVectors: null },
          { 'roleVectors.hybrid_vector': { $exists: false } },
          { 'roleVectors.hybrid_vector': { $size: 0 } },
          { 'roleVectors.finalVectors.default': { $exists: false } },
          { 'roleVectors.finalVectors.default': { $size: 0 } },
          { 'roleVectors.finalVectors.nextRole': { $exists: false } },
          { 'roleVectors.finalVectors.nextRole': { $size: 0 } },
          { 'roleVectors.finalVectors.outOfTheBox': { $exists: false } },
          { 'roleVectors.finalVectors.outOfTheBox': { $size: 0 } },
        ],
      };

  const totalInDb = await CareerPath.countDocuments(filter);
  const totalDocs = Math.min(totalInDb, flags.limit);
  console.log(`\nDocuments to process: ${totalDocs}${totalInDb > totalDocs ? ` (limited from ${totalInDb})` : ''}`);

  if (totalDocs === 0) {
    console.log('Nothing to do. Run buildRoleIdentityTexts first, or use --force.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let built = 0;
  let skipped = 0;
  let errors = 0;
  let lastId = null;

  while (processed < totalDocs) {
    const remaining = totalDocs - processed;
    const fetchSize = Math.min(flags.batchSize, remaining);

    const query = lastId
      ? { ...filter, _id: { $gt: lastId } }
      : { ...filter };

    const batch = await CareerPath.find(query)
      .sort({ _id: 1 })
      .limit(fetchSize)
      .lean();

    if (batch.length === 0) break;

    const bulkOps = [];

    for (const doc of batch) {
      lastId = doc._id;

      try {
        const result = await buildRoleVectors(doc);

        if (!result) {
          skipped++;
          continue;
        }

        if (!flags.dryRun) {
          bulkOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: {
                  roleVectors: result,
                  lastUpdated: new Date(),
                },
              },
            },
          });
        }

        built++;
        if (built === 1 || built % 100 === 0) {
          console.log(`\n--- Sample #${built} [${doc.title}] ---`);
          console.log(`  sub-vectors: occupation_group, skill_domains, responsibilities, required_skills, optional_skills`);
          console.log(`  identity_vector: ${result.identity_vector.length} dims`);
          console.log(`  hybrid_vector:   ${result.hybrid_vector.length} dims`);
          console.log(`  final.default:  ${result.finalVectors.default.length} dims`);
          console.log(`  final.nextRole: ${result.finalVectors.nextRole.length} dims`);
          console.log(`  final.ootb:     ${result.finalVectors.outOfTheBox.length} dims`);
        }
      } catch (err) {
        errors++;
        console.error(`\n  Error [${doc.escoId}]: ${err.message}`);
      }
    }

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
  console.log(`  Built:           ${built}`);
  console.log(`  Skipped:         ${skipped}`);
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
