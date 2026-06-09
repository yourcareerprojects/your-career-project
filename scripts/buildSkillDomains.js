#!/usr/bin/env node
/**
 * buildSkillDomains.js
 *
 * Migration script that derives structured Skill Domains for every CareerPath
 * document and persists them in the `skillDomains` subdocument.
 *
 * Skill Domains are high-level competency clusters that group related skills
 * and responsibilities into semantically stable categories, useful for
 * role-to-user matching and explainability.
 *
 * Input (per CareerPath document):
 *   - requiredSkills       (string[]) – ESCO skill names
 *   - skillModel           (object)   – structured core/optional skills (if built)
 *   - keyResponsibilities  (object)   – extracted responsibility statements (if built)
 *
 * Output (stored as CareerPath.skillDomains):
 *   {
 *     skill_domains: [
 *       {
 *         domain:       string              – e.g. "Data Analysis"
 *         importance:   "core"|"important"|"supporting"
 *         mapped_items: string[]            – skills/responsibilities in this domain
 *       }
 *     ],
 *     extraction_confidence: number         – 0.0–1.0
 *     built_at:              Date
 *     built_with:            string         – "llm" | "heuristic"
 *   }
 *
 * Usage:
 *   node scripts/buildSkillDomains.js [options]
 *
 * Options:
 *   --force          Rebuild even if skillDomains already exists
 *   --batch-size=N   Documents per DB fetch batch (default 250)
 *   --dry-run        Preview without writing to the database
 *   --heuristic      Use deterministic heuristic instead of LLM
 *   --concurrency=N  Parallel LLM calls per batch (default 5, ignored for heuristic)
 *   --throttle-ms=N  Delay in ms between LLM calls (default 200, ignored for heuristic)
 *   --limit=N        Process at most N documents (useful for testing)
 *   --esco-id=ID     Process a single role by escoId (implies rebuild for that role)
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const { extractFromCareerPath } = require('../src/server/services/jobAnalysis/skillDomainExtractor');
const { getLocalizedFieldLenient } = require('../src/server/utils/i18nFields');

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
    escoId: null,
  };

  for (const arg of args) {
    if (arg === '--force') flags.force = true;
    else if (arg.startsWith('--esco-id=')) flags.escoId = arg.split('=').slice(1).join('=');
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

function hasDomainInputs(doc) {
  const hasRequired = (doc.requiredSkills && doc.requiredSkills.length > 0) ||
    (doc.skillModel && doc.skillModel.core_skills && doc.skillModel.core_skills.length > 0);
  const hasOptional = doc.skillModel &&
    doc.skillModel.optional_skills &&
    doc.skillModel.optional_skills.length > 0;
  const hasResponsibilities = doc.keyResponsibilities &&
    doc.keyResponsibilities.responsibilities &&
    doc.keyResponsibilities.responsibilities.length > 0;

  return hasRequired || hasOptional || hasResponsibilities;
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

  console.log('=== Build Skill Domains ===');
  console.log(`  MongoDB:     ${MONGODB_URI}`);
  console.log(`  Method:      ${method}`);
  console.log(`  Force:       ${flags.force}`);
  console.log(`  Batch size:  ${flags.batchSize}`);
  console.log(`  Concurrency: ${flags.heuristic ? 'n/a' : flags.concurrency}`);
  console.log(`  Throttle:    ${flags.heuristic ? 'n/a' : flags.throttleMs + 'ms'}`);
  console.log(`  Limit:       ${flags.limit === Infinity ? 'none' : flags.limit}`);
  console.log(`  ESCO id:     ${flags.escoId || '(all)'}`);
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
  const filter = {};
  if (flags.escoId) {
    filter.escoId = flags.escoId;
  } else if (!flags.force) {
    filter.$or = [{ skillDomains: null }, { skillDomains: { $exists: false } }];
  }

  const totalInDb = await CareerPath.countDocuments(filter);
  const totalDocs = Math.min(totalInDb, flags.limit);
  console.log(`\nDocuments to process: ${totalDocs}${totalInDb > totalDocs ? ` (limited from ${totalInDb})` : ''}`);

  if (totalDocs === 0) {
    console.log('Nothing to do. Use --force to rebuild existing skill domains.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let built = 0;
  let skipped = 0;
  let errors = 0;
  let lastId = null;

  // Track domain count distribution
  const countDist = {};

  // Track importance distribution
  const importanceDist = { core: 0, important: 0, supporting: 0 };

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
          if (!hasDomainInputs(doc)) {
            skipped++;
            continue;
          }

          const result = await extractFromCareerPath(doc, { method: 'heuristic' });

          if (result.skill_domains.length === 0) {
            skipped++;
            continue;
          }

          const count = result.skill_domains.length;
          countDist[count] = (countDist[count] || 0) + 1;

          for (const sd of result.skill_domains) {
            importanceDist[sd.importance] = (importanceDist[sd.importance] || 0) + 1;
          }

          if (!flags.dryRun) {
            bulkOps.push({
              updateOne: {
                filter: { _id: doc._id },
                update: {
                  $set: {
                    skillDomains: result,
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

        if (!hasDomainInputs(doc)) {
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

        if (r.result.skill_domains.length === 0) {
          skipped++;
          continue;
        }

        const count = r.result.skill_domains.length;
        countDist[count] = (countDist[count] || 0) + 1;

        for (const sd of r.result.skill_domains) {
          importanceDist[sd.importance] = (importanceDist[sd.importance] || 0) + 1;
        }

        if (!flags.dryRun) {
          bulkOps.push({
            updateOne: {
              filter: { _id: r.doc._id },
              update: {
                $set: {
                  skillDomains: r.result,
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
      const writeResult = await CareerPath.bulkWrite(bulkOps, { ordered: false });
      if (writeResult.matchedCount === 0 && writeResult.modifiedCount === 0) {
        console.warn('\n  Warning: bulkWrite matched/updated 0 documents in this batch');
      }
      if (Array.isArray(writeResult.mongoose?.validationErrors) && writeResult.mongoose.validationErrors.length > 0) {
        console.error('\n  bulkWrite validation errors:', writeResult.mongoose.validationErrors.slice(0, 3));
      }
    }

    processed += batch.length;
    const pct = Math.round((processed / totalDocs) * 100);
    process.stdout.write(
      `\rProgress: ${processed}/${totalDocs} (${pct}%)  built=${built} skipped=${skipped} errors=${errors}`
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n');
  console.log('=== Domain Count Distribution ===');
  const maxCount = Math.max(...Object.keys(countDist).map(Number), 0);
  for (let i = 1; i <= Math.max(maxCount, 12); i++) {
    const n = countDist[i] || 0;
    const bar = built > 0 ? '█'.repeat(Math.round((n / built) * 50)) : '';
    const pct = built > 0 ? ((n / built) * 100).toFixed(1) : '0.0';
    console.log(`  ${String(i).padStart(2)} domains:  ${String(n).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
  }

  console.log('\n=== Importance Distribution ===');
  const totalDomains = importanceDist.core + importanceDist.important + importanceDist.supporting;
  for (const level of ['core', 'important', 'supporting']) {
    const n = importanceDist[level];
    const pct = totalDomains > 0 ? ((n / totalDomains) * 100).toFixed(1) : '0.0';
    const bar = totalDomains > 0 ? '█'.repeat(Math.round((n / totalDomains) * 50)) : '';
    console.log(`  ${level.padEnd(12)} ${String(n).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
  }

  console.log('\n=== Summary ===');
  console.log(`  Total processed:   ${processed}`);
  console.log(`  Built:             ${built}`);
  console.log(`  Skipped (no required/optional/responsibilities): ${skipped}`);
  console.log(`  Errors:            ${errors}`);
  console.log(`  Method:            ${method}`);

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
    console.log(`\n--- Sample #${count} [${getLocalizedFieldLenient(doc.title)}] ---`);
    console.log(`  Skill Domains (${result.skill_domains.length}):`);
    for (const sd of result.skill_domains) {
      console.log(`    [${sd.importance.padEnd(10)}] ${getLocalizedFieldLenient(sd.domain)}`);
      for (const item of sd.mapped_items.slice(0, 3)) {
        console.log(`      - ${item}`);
      }
      if (sd.mapped_items.length > 3) {
        console.log(`      ... and ${sd.mapped_items.length - 3} more`);
      }
    }
    console.log(`  Confidence: ${result.extraction_confidence}`);
    console.log(`  Method:     ${result.built_with}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
