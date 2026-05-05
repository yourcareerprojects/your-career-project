#!/usr/bin/env node
/**
 * buildRoleIdentityTexts.js
 *
 * Migration script that generates a structured Role Identity Text for every
 * CareerPath document and persists it in the `roleIdentity` subdocument.
 *
 * The Role Identity Text is a semantically stable paragraph designed to be
 * embedded into a dense vector for similarity matching, career recommendation
 * ranking, and explainable AI reasoning.
 *
 * Input (per CareerPath document):
 *   - title               (string)   – ESCO occupation title
 *   - altTitles            (string[]) – ESCO alternative titles
 *   - hiddenTitles         (string[]) – ESCO hidden labels (same role as altTitles for identity text)
 *   - description          (string)   – ESCO occupation description (prose)
 *   - requiredSkills       (string[]) – ESCO skill names
 *   - skillModel           (object)   – structured core/optional skills (if built)
 *   - keyResponsibilities  (object)   – extracted responsibility statements (if built)
 *   - skillDomains         (object)   – derived skill domain clusters (if built)
 *
 * Output (stored as CareerPath.roleIdentity):
 *   {
 *     role_identity_text:     string  – structured paragraph for embedding
 *     input_hash:             string  – 16-char hex hash for change detection
 *     extraction_confidence:  number  – 0.0–1.0
 *     built_at:               Date
 *     built_with:             string  – "deterministic" | "llm"
 *   }
 *
 * Usage:
 *   node scripts/buildRoleIdentityTexts.js [options]
 *
 * Options:
 *   --force          Rebuild even if roleIdentity already exists
 *   --changed-only   Only rebuild documents whose input_hash has changed
 *   --batch-size=N   Documents per DB fetch batch (default 250)
 *   --dry-run        Preview without writing to the database
 *   --deterministic  Use deterministic composer instead of LLM (default: LLM)
 *   --concurrency=N  Parallel LLM calls per batch (default 5, ignored for deterministic)
 *   --throttle-ms=N  Delay in ms between LLM calls (default 200, ignored for deterministic)
 *   --limit=N        Process at most N documents (useful for testing)
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const {
  composeFromCareerPath,
  needsRebuild,
} = require('../src/server/services/jobAnalysis/roleIdentityComposer');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

// ── CLI argument parsing ───────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    force: false,
    changedOnly: false,
    batchSize: 250,
    dryRun: false,
    llm: true,
    concurrency: 5,
    throttleMs: 200,
    limit: Infinity,
  };

  for (const arg of args) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--changed-only') flags.changedOnly = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--llm') flags.llm = true;
    else if (arg === '--deterministic') flags.llm = false;
    else if (arg.startsWith('--batch-size=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.batchSize = n;
    } else if (arg.startsWith('--concurrency=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.concurrency = n;
    } else if (arg.startsWith('--throttle-ms=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n >= 0) flags.throttleMs = n;
    } else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.limit = n;
    }
  }

  return flags;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process an array of items with bounded concurrency.
 *
 * @param {Array} items
 * @param {number} concurrency
 * @param {Function} fn – async (item) => result
 * @returns {Promise<Array>} results in the same order as items
 */
async function pMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs();
  const method = flags.llm ? 'llm' : 'deterministic';

  console.log('=== Build Role Identity Texts ===');
  console.log(`  MongoDB:      ${MONGODB_URI}`);
  console.log(`  Method:       ${method}`);
  console.log(`  Force:        ${flags.force}`);
  console.log(`  Changed only: ${flags.changedOnly}`);
  console.log(`  Batch size:   ${flags.batchSize}`);
  console.log(`  Concurrency:  ${flags.llm ? flags.concurrency : 'n/a'}`);
  console.log(`  Throttle:     ${flags.llm ? flags.throttleMs + 'ms' : 'n/a'}`);
  console.log(`  Limit:        ${flags.limit === Infinity ? 'none' : flags.limit}`);
  console.log(`  Dry run:      ${flags.dryRun}`);
  console.log('');

  // Validate LLM config before starting
  if (flags.llm && !process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set in .env');
    console.error('  Either set the key or run without --llm for deterministic composition.');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Determine which documents to process
  let filter;
  if (flags.force) {
    filter = {};
  } else if (flags.changedOnly) {
    // Fetch all and check hash in-app (hash comparison needs lean doc)
    filter = {};
  } else {
    filter = {
      $or: [
        { roleIdentity: null },
        { roleIdentity: { $exists: false } },
      ],
    };
  }

  const totalInDb = await CareerPath.countDocuments(filter);
  const totalDocs = Math.min(totalInDb, flags.limit);
  console.log(`\nDocuments to process: ${totalDocs}${totalInDb > totalDocs ? ` (limited from ${totalInDb})` : ''}`);

  if (totalDocs === 0) {
    console.log('Nothing to do. Use --force to rebuild existing role identity texts.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let built = 0;
  let skipped = 0;
  let unchanged = 0;
  let errors = 0;
  let lastId = null;

  // Track text length distribution for reporting
  const lengthBuckets = { '<200': 0, '200-500': 0, '500-1000': 0, '1000-2000': 0, '>2000': 0 };

  // Track confidence distribution
  const confBuckets = {};

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

    if (!flags.llm) {
      // Deterministic – synchronous, no concurrency needed
      for (const doc of batch) {
        lastId = doc._id;

        try {
          // Skip if --changed-only and hash hasn't changed
          if (flags.changedOnly && !flags.force && !needsRebuild(doc)) {
            unchanged++;
            continue;
          }

          // Need at least a title to compose anything meaningful
          if (!doc.title) {
            skipped++;
            continue;
          }

          const result = await composeFromCareerPath(doc, { method: 'deterministic' });

          if (!result.role_identity_text) {
            skipped++;
            continue;
          }

          // Track metrics
          const len = result.role_identity_text.length;
          if (len < 200) lengthBuckets['<200']++;
          else if (len < 500) lengthBuckets['200-500']++;
          else if (len < 1000) lengthBuckets['500-1000']++;
          else if (len < 2000) lengthBuckets['1000-2000']++;
          else lengthBuckets['>2000']++;

          const confKey = result.extraction_confidence.toFixed(2);
          confBuckets[confKey] = (confBuckets[confKey] || 0) + 1;

          if (!flags.dryRun) {
            bulkOps.push({
              updateOne: {
                filter: { _id: doc._id },
                update: {
                  $set: {
                    roleIdentity: result,
                    lastUpdated: new Date(),
                  },
                },
              },
            });
          }

          built++;
          logSample(doc, result, built);
        } catch (err) {
          errors++;
          console.error(`\n  Error [${doc.escoId}]: ${err.message}`);
        }
      }
    } else {
      // LLM-based – use bounded concurrency with throttling
      const results = await pMap(batch, flags.concurrency, async (doc) => {
        if (flags.throttleMs > 0) {
          await sleep(flags.throttleMs);
        }

        // Skip if --changed-only and hash hasn't changed
        if (flags.changedOnly && !flags.force && !needsRebuild(doc)) {
          return { doc, status: 'unchanged' };
        }

        if (!doc.title) {
          return { doc, status: 'skipped' };
        }

        try {
          const result = await composeFromCareerPath(doc, { method: 'llm' });
          return { doc, status: 'ok', result };
        } catch (err) {
          return { doc, status: 'error', error: err.message };
        }
      });

      // Fix lastId to the actual last document in batch order
      lastId = batch[batch.length - 1]._id;

      for (const r of results) {
        if (r.status === 'unchanged') {
          unchanged++;
          continue;
        }
        if (r.status === 'skipped') {
          skipped++;
          continue;
        }
        if (r.status === 'error') {
          errors++;
          console.error(`\n  Error [${r.doc.escoId}]: ${r.error}`);
          continue;
        }

        if (!r.result.role_identity_text) {
          skipped++;
          continue;
        }

        // Track metrics
        const len = r.result.role_identity_text.length;
        if (len < 200) lengthBuckets['<200']++;
        else if (len < 500) lengthBuckets['200-500']++;
        else if (len < 1000) lengthBuckets['500-1000']++;
        else if (len < 2000) lengthBuckets['1000-2000']++;
        else lengthBuckets['>2000']++;

        const confKey = r.result.extraction_confidence.toFixed(2);
        confBuckets[confKey] = (confBuckets[confKey] || 0) + 1;

        if (!flags.dryRun) {
          bulkOps.push({
            updateOne: {
              filter: { _id: r.doc._id },
              update: {
                $set: {
                  roleIdentity: r.result,
                  lastUpdated: new Date(),
                },
              },
            },
          });
        }

        built++;
        logSample(r.doc, r.result, built);
      }
    }

    // Write batch to database
    if (bulkOps.length > 0 && !flags.dryRun) {
      await CareerPath.bulkWrite(bulkOps, { ordered: false });
    }

    processed += batch.length;
    const pct = Math.round((processed / totalDocs) * 100);
    process.stdout.write(
      `\rProgress: ${processed}/${totalDocs} (${pct}%)  built=${built} skipped=${skipped} unchanged=${unchanged} errors=${errors}`
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n');
  console.log('=== Text Length Distribution ===');
  for (const [bucket, count] of Object.entries(lengthBuckets)) {
    const bar = built > 0 ? '█'.repeat(Math.round((count / built) * 50)) : '';
    const pct = built > 0 ? ((count / built) * 100).toFixed(1) : '0.0';
    console.log(`  ${bucket.padEnd(10)} ${String(count).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
  }

  console.log('\n=== Confidence Distribution ===');
  const sortedConf = Object.entries(confBuckets).sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [conf, count] of sortedConf) {
    const bar = built > 0 ? '█'.repeat(Math.round((count / built) * 50)) : '';
    const pct = built > 0 ? ((count / built) * 100).toFixed(1) : '0.0';
    console.log(`  conf ${conf}  ${String(count).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
  }

  console.log('\n=== Summary ===');
  console.log(`  Total processed:    ${processed}`);
  console.log(`  Built:              ${built}`);
  console.log(`  Skipped (no data):  ${skipped}`);
  console.log(`  Unchanged (hash):   ${unchanged}`);
  console.log(`  Errors:             ${errors}`);
  console.log(`  Method:             ${method}`);

  if (flags.dryRun) {
    console.log('\n  (Dry run — no changes were written to the database)');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

// ── Logging helper ────────────────────────────────────────────────────────

function logSample(doc, result, count) {
  // Log a sample at the first doc and every 100 docs
  if (count === 1 || count % 100 === 0) {
    console.log(`\n--- Sample #${count} [${doc.title}] ---`);
    console.log(`  Text length:  ${result.role_identity_text.length} chars`);
    console.log(`  Input hash:   ${result.input_hash}`);
    console.log(`  Confidence:   ${result.extraction_confidence}`);
    console.log(`  Method:       ${result.built_with}`);

    // Show first 200 chars of the identity text
    const preview = result.role_identity_text.length > 200
      ? result.role_identity_text.slice(0, 200) + '...'
      : result.role_identity_text;
    console.log(`  Preview:\n    ${preview}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
