#!/usr/bin/env node
/**
 * buildKeyResponsibilities.js
 *
 * Migration script that extracts structured key responsibilities for every
 * CareerPath document and persists them in the `keyResponsibilities` subdocument.
 *
 * Input (per CareerPath document):
 *   - title          (string)   – ESCO occupation title
 *   - description    (string)   – ESCO occupation description (prose)
 *   - requiredSkills (string[]) – ESCO skill names
 *   - skillModel     (object)   – structured core/optional skills (if built)
 *
 * Output (stored as CareerPath.keyResponsibilities):
 *   {
 *     responsibilities:       string[]  – 3–6 verb-led responsibility statements
 *     extraction_confidence:  number    – 0.0–1.0
 *     built_at:               Date
 *     built_with:             string    – "llm" | "heuristic"
 *   }
 *
 * Usage:
 *   node scripts/buildKeyResponsibilities.js [options]
 *
 * Options:
 *   --force          Rebuild even if keyResponsibilities already exists
 *   --batch-size=N   Documents per DB fetch batch (default 250)
 *   --dry-run        Preview without writing to the database
 *   --heuristic      Use deterministic heuristic instead of LLM
 *   --concurrency=N  Parallel LLM calls per batch (default 5, ignored for heuristic)
 *   --throttle-ms=N  Delay in ms between LLM calls (default 200, ignored for heuristic)
 *   --limit=N        Process at most N documents (useful for testing)
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const { extractFromCareerPath } = require('../src/server/services/jobAnalysis/responsibilityExtractor');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

// ── CLI argument parsing ───────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    force: false,
    batchSize: 250,
    dryRun: false,
    heuristic: false,
    concurrency: 5,
    throttleMs: 200,
    limit: Infinity,
  };

  for (const arg of args) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--heuristic') flags.heuristic = true;
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
  const method = flags.heuristic ? 'heuristic' : 'llm';

  console.log('=== Build Key Responsibilities ===');
  console.log(`  MongoDB:     ${MONGODB_URI}`);
  console.log(`  Method:      ${method}`);
  console.log(`  Force:       ${flags.force}`);
  console.log(`  Batch size:  ${flags.batchSize}`);
  console.log(`  Concurrency: ${flags.heuristic ? 'n/a' : flags.concurrency}`);
  console.log(`  Throttle:    ${flags.heuristic ? 'n/a' : flags.throttleMs + 'ms'}`);
  console.log(`  Limit:       ${flags.limit === Infinity ? 'none' : flags.limit}`);
  console.log(`  Dry run:     ${flags.dryRun}`);
  console.log('');

  // Validate LLM config before starting
  if (!flags.heuristic && !process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set in .env');
    console.error('  Either set the key or run with --heuristic for offline extraction.');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Determine which documents to process
  const filter = flags.force
    ? {}
    : { $or: [{ keyResponsibilities: null }, { keyResponsibilities: { $exists: false } }] };

  const totalInDb = await CareerPath.countDocuments(filter);
  const totalDocs = Math.min(totalInDb, flags.limit);
  console.log(`\nDocuments to process: ${totalDocs}${totalInDb > totalDocs ? ` (limited from ${totalInDb})` : ''}`);

  if (totalDocs === 0) {
    console.log('Nothing to do. Use --force to rebuild existing key responsibilities.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let built = 0;
  let skipped = 0;
  let errors = 0;
  let lastId = null;

  // Track responsibility count distribution
  const countDist = {};

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

    if (flags.heuristic) {
      // Synchronous heuristic – no concurrency needed
      for (const doc of batch) {
        lastId = doc._id;

        try {
          if (!doc.description) {
            skipped++;
            continue;
          }

          const result = await extractFromCareerPath(doc, { method: 'heuristic' });

          if (result.responsibilities.length === 0) {
            skipped++;
            continue;
          }

          const count = result.responsibilities.length;
          countDist[count] = (countDist[count] || 0) + 1;

          if (!flags.dryRun) {
            bulkOps.push({
              updateOne: {
                filter: { _id: doc._id },
                update: {
                  $set: {
                    keyResponsibilities: result,
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
      const results = await pMap(batch, flags.concurrency, async (doc, idx) => {
        // Flat delay between requests to avoid rate-limit bursts
        if (flags.throttleMs > 0) {
          await sleep(flags.throttleMs);
        }

        lastId = doc._id; // will be overwritten but we fix after

        if (!doc.description) {
          return { doc, status: 'skipped' };
        }

        try {
          const result = await extractFromCareerPath(doc, { method: 'llm' });
          return { doc, status: 'ok', result };
        } catch (err) {
          return { doc, status: 'error', error: err.message };
        }
      });

      // Fix lastId to the actual last document in batch order
      lastId = batch[batch.length - 1]._id;

      for (const r of results) {
        if (r.status === 'skipped') {
          skipped++;
          continue;
        }
        if (r.status === 'error') {
          errors++;
          console.error(`\n  Error [${r.doc.escoId}]: ${r.error}`);
          continue;
        }

        if (r.result.responsibilities.length === 0) {
          skipped++;
          continue;
        }

        const count = r.result.responsibilities.length;
        countDist[count] = (countDist[count] || 0) + 1;

        if (!flags.dryRun) {
          bulkOps.push({
            updateOne: {
              filter: { _id: r.doc._id },
              update: {
                $set: {
                  keyResponsibilities: r.result,
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
      `\rProgress: ${processed}/${totalDocs} (${pct}%)  built=${built} skipped=${skipped} errors=${errors}`
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n');
  console.log('=== Responsibility Count Distribution ===');
  const maxCount = Math.max(...Object.keys(countDist).map(Number), 0);
  for (let i = 1; i <= Math.max(maxCount, 6); i++) {
    const n = countDist[i] || 0;
    const bar = built > 0 ? '█'.repeat(Math.round((n / built) * 50)) : '';
    const pct = built > 0 ? ((n / built) * 100).toFixed(1) : '0.0';
    console.log(`  ${i} responsibilities:  ${String(n).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
  }

  console.log('\n=== Summary ===');
  console.log(`  Total processed:  ${processed}`);
  console.log(`  Built:            ${built}`);
  console.log(`  Skipped (no data): ${skipped}`);
  console.log(`  Errors:           ${errors}`);
  console.log(`  Method:           ${method}`);

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
    console.log(`  Responsibilities (${result.responsibilities.length}):`);
    for (const r of result.responsibilities) {
      console.log(`    - ${r}`);
    }
    console.log(`  Confidence: ${result.extraction_confidence}`);
    console.log(`  Method:     ${result.built_with}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
