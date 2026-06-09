#!/usr/bin/env node
/**
 * buildRequiredSkills.js
 *
 * Extracts role-specific required and optional skills via LLM and persists them
 * on CareerPath documents.
 *
 * Updates per document:
 *   - requiredSkills, requiredSkillKeys, requiredSkillUris
 *   - skillModel (core_skills, optional_skills, skill_weights, …)
 *
 * Input (per CareerPath document):
 *   - title, description, keyResponsibilities (recommended)
 *
 * Usage:
 *   node scripts/buildRequiredSkills.js [options]
 *
 * Options:
 *   --force            Rebuild even if an LLM skill model already exists
 *   --batch-size=N     Documents per DB fetch batch (default 250)
 *   --dry-run          Preview without writing to the database
 *   --concurrency=N    Parallel LLM calls per batch (default 5)
 *   --throttle-ms=N    Delay in ms between LLM calls (default 200)
 *   --limit=N          Process at most N documents
 *   --esco-prefix=P    Only process documents whose escoId starts with P
 *   --esco-ids-file=F  Only process escoIds listed in a JSON roles file
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const { extractFromCareerPath } = require('../src/server/services/jobAnalysis/requiredSkillsExtractor');
const { getLocalizedFieldLenient } = require('../src/server/utils/i18nFields');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

function loadEscoIdsFromFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const roles = Array.isArray(data) ? data : data?.roles;
  if (!Array.isArray(roles)) {
    throw new Error('Expected a JSON array or an object with a "roles" array');
  }
  const escoIds = roles
    .map((role) => role?.escoId || role?.id || role?.esco_id)
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim());
  if (escoIds.length === 0) {
    throw new Error(`No escoId values found in ${resolved}`);
  }
  return escoIds;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    force: false,
    batchSize: 250,
    dryRun: false,
    concurrency: 5,
    throttleMs: 200,
    limit: Infinity,
    escoPrefix: null,
    escoIdsFile: null,
  };

  for (const arg of args) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--esco-prefix=')) flags.escoPrefix = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--esco-ids-file=')) flags.escoIdsFile = arg.split('=').slice(1).join('=');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function logSample(doc, result, count) {
  if (count === 1 || count % 100 === 0) {
    console.log(`\n--- Sample #${count} [${getLocalizedFieldLenient(doc.title)}] ---`);
    console.log(`  Core skills (${result.requiredSkills.length}):`);
    for (const skill of result.requiredSkills) {
      console.log(`    - ${skill}`);
    }
    if (result.skillModel.optional_skills.length > 0) {
      console.log(`  Optional (${result.skillModel.optional_skills.length}): ${result.skillModel.optional_skills.join(', ')}`);
    }
    console.log(`  Confidence: ${result.extraction_confidence}`);
  }
}

async function main() {
  const flags = parseArgs();

  console.log('=== Build Required Skills ===');
  console.log(`  MongoDB:     ${MONGODB_URI}`);
  console.log(`  Force:       ${flags.force}`);
  console.log(`  Batch size:  ${flags.batchSize}`);
  console.log(`  Concurrency: ${flags.concurrency}`);
  console.log(`  Throttle:    ${flags.throttleMs}ms`);
  console.log(`  Limit:       ${flags.limit === Infinity ? 'none' : flags.limit}`);
  console.log(`  ESCO prefix: ${flags.escoPrefix || '(all)'}`);
  console.log(`  ESCO ids:    ${flags.escoIdsFile || '(all)'}`);
  console.log(`  Dry run:     ${flags.dryRun}`);
  console.log('');

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const filter = {};
  if (flags.escoIdsFile) {
    filter.escoId = { $in: loadEscoIdsFromFile(flags.escoIdsFile) };
  } else if (flags.escoPrefix) {
    filter.escoId = new RegExp(`^${flags.escoPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  }
  if (!flags.force) {
    filter.$or = [
      { skillModel: null },
      { skillModel: { $exists: false } },
      { 'skillModel.built_with': 'fallback' },
      { 'skillModel.built_with': 'manual' },
      { 'skillModel.built_with': 'json_import' },
    ];
  }

  const totalInDb = await CareerPath.countDocuments(filter);
  const totalDocs = Math.min(totalInDb, flags.limit);
  console.log(`\nDocuments to process: ${totalDocs}${totalInDb > totalDocs ? ` (limited from ${totalInDb})` : ''}`);

  if (totalDocs === 0) {
    console.log('Nothing to do. Use --force to rebuild existing skill models.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let built = 0;
  let skipped = 0;
  let errors = 0;
  let lastId = null;
  const coreCountDist = {};
  const optionalCountDist = {};

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

    const results = await pMap(batch, flags.concurrency, async (doc) => {
      if (flags.throttleMs > 0) {
        await sleep(flags.throttleMs);
      }

      if (!getLocalizedFieldLenient(doc.description)) {
        return { doc, status: 'skipped' };
      }

      try {
        const result = await extractFromCareerPath(doc);
        return { doc, status: 'ok', result };
      } catch (err) {
        return { doc, status: 'error', error: err.message };
      }
    });

    lastId = batch[batch.length - 1]._id;
    const bulkOps = [];

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

      if (!r.result.requiredSkills.length) {
        skipped++;
        continue;
      }

      const coreCount = r.result.requiredSkills.length;
      const optCount = r.result.skillModel.optional_skills.length;
      coreCountDist[coreCount] = (coreCountDist[coreCount] || 0) + 1;
      optionalCountDist[optCount] = (optionalCountDist[optCount] || 0) + 1;

      if (!flags.dryRun) {
        bulkOps.push({
          updateOne: {
            filter: { _id: r.doc._id },
            update: {
              $set: {
                requiredSkills: r.result.requiredSkills,
                requiredSkillKeys: r.result.requiredSkillKeys,
                requiredSkillUris: [],
                skillModel: r.result.skillModel,
                lastUpdated: new Date(),
              },
            },
          },
        });
      }

      built++;
      logSample(r.doc, r.result, built);
    }

    if (bulkOps.length > 0 && !flags.dryRun) {
      await CareerPath.bulkWrite(bulkOps, { ordered: false });
    }

    processed += batch.length;
    const pct = Math.round((processed / totalDocs) * 100);
    process.stdout.write(
      `\rProgress: ${processed}/${totalDocs} (${pct}%)  built=${built} skipped=${skipped} errors=${errors}`
    );
  }

  console.log('\n');
  console.log('=== Core Skill Count Distribution ===');
  const maxCore = Math.max(...Object.keys(coreCountDist).map(Number), 0);
  for (let i = 1; i <= Math.max(maxCore, 12); i++) {
    const n = coreCountDist[i] || 0;
    if (n === 0 && i > maxCore) continue;
    const pct = built > 0 ? ((n / built) * 100).toFixed(1) : '0.0';
    console.log(`  ${String(i).padStart(2)} core:  ${String(n).padStart(5)}  (${pct.padStart(5)}%)`);
  }

  console.log('\n=== Summary ===');
  console.log(`  Total processed:   ${processed}`);
  console.log(`  Built:             ${built}`);
  console.log(`  Skipped (no data): ${skipped}`);
  console.log(`  Errors:            ${errors}`);

  if (flags.dryRun) {
    console.log('\n  (Dry run — no changes were written to the database)');
  } else if (built > 0) {
    console.log('\n  Next: node scripts/migrateSkills.js  (relink Skill collection)');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
