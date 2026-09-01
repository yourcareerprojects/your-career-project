#!/usr/bin/env node
/**
 * classifyOccupationDomains.js
 *
 * AI-powered classification of CareerPath.domain using the shared industry taxonomy.
 * Only processes occupations with domain === "UNASSIGNED" unless --force is set.
 *
 * Usage:
 *   node scripts/classifyOccupationDomains.js
 *   node scripts/classifyOccupationDomains.js --dry-run --limit=20
 *   node scripts/classifyOccupationDomains.js --force --batch-size=25 --concurrency=3
 *   node scripts/classifyOccupationDomains.js --from-failures=classification_failures.json --force
 *
 * Options:
 *   --force              Reclassify even if domain is already assigned
 *   --dry-run            Call the model but do not write to MongoDB
 *   --batch-size=N       Occupations fetched per DB batch (default 25)
 *   --concurrency=N      Parallel LLM calls (default 3)
 *   --throttle-ms=N      Delay before each LLM call (default 150)
 *   --limit=N            Process at most N occupations
 *   --model=NAME         OpenAI model override (default OPENAI_MODEL / gpt-4o-mini)
 *   --esco-prefix=P      Only escoIds starting with P
 *   --from-failures=PATH Retry only escoIds listed in a failures JSON file
 *   --failures-file=PATH Where to write classification_failures.json (output)
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const {
  runDomainClassification,
} = require('../src/server/services/occupationDomainClassification/domainClassificationService');
const { DEFAULT_MODEL } = require('../src/server/services/occupationDomainClassification/domainClassificationLlmClient');
const { INDUSTRY_CANONICAL_LABELS } = require('../src/constants/industries');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

/**
 * Load escoIds from a classification_failures.json (or similar) file.
 * @param {string} filePath
 * @returns {string[]}
 */
function loadEscoIdsFromFailuresFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Failures file not found: ${resolved}`);
  }
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const rows = Array.isArray(data) ? data : data?.failures;
  if (!Array.isArray(rows)) {
    throw new Error('Expected a JSON array or an object with a "failures" array');
  }
  const escoIds = [
    ...new Set(
      rows
        .map((row) => row?.escoId || row?.id || row?.esco_id)
        .filter((id) => typeof id === 'string' && id.trim())
        .map((id) => id.trim())
    ),
  ];
  if (escoIds.length === 0) {
    throw new Error(`No escoId values found in ${resolved}`);
  }
  return escoIds;
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {
    force: false,
    dryRun: false,
    batchSize: 25,
    concurrency: 3,
    throttleMs: 150,
    limit: Infinity,
    model: DEFAULT_MODEL,
    escoPrefix: null,
    fromFailures: null,
    failuresPath: path.resolve(process.cwd(), 'classification_failures.json'),
  };

  for (const arg of argv) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--batch-size=')) {
      const n = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.batchSize = n;
    } else if (arg.startsWith('--concurrency=')) {
      const n = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.concurrency = n;
    } else if (arg.startsWith('--throttle-ms=')) {
      const n = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n >= 0) flags.throttleMs = n;
    } else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) flags.limit = n;
    } else if (arg.startsWith('--model=')) {
      flags.model = arg.split('=').slice(1).join('=') || flags.model;
    } else if (arg.startsWith('--esco-prefix=')) {
      flags.escoPrefix = arg.split('=').slice(1).join('=') || null;
    } else if (arg.startsWith('--from-failures=')) {
      flags.fromFailures = arg.split('=').slice(1).join('=') || null;
    } else if (arg.startsWith('--failures-file=')) {
      flags.failuresPath = path.resolve(arg.split('=').slice(1).join('=') || flags.failuresPath);
    }
  }

  return flags;
}

async function main() {
  const flags = parseArgs();

  let escoIds = null;
  if (flags.fromFailures) {
    escoIds = loadEscoIdsFromFailuresFile(flags.fromFailures);
  }

  console.log('=== Classify Occupation Domains ===');
  console.log(`  MongoDB:      ${MONGODB_URI}`);
  console.log(`  Model:        ${flags.model}`);
  console.log(`  Force:        ${flags.force}`);
  console.log(`  Dry run:      ${flags.dryRun}`);
  console.log(`  Batch size:   ${flags.batchSize}`);
  console.log(`  Concurrency:  ${flags.concurrency}`);
  console.log(`  Throttle:     ${flags.throttleMs}ms`);
  console.log(`  Limit:        ${flags.limit === Infinity ? 'none' : flags.limit}`);
  console.log(`  ESCO prefix:  ${flags.escoPrefix || '(all)'}`);
  console.log(`  From failures:${flags.fromFailures ? ` ${escoIds.length} escoIds` : ' (no)'}`);
  console.log(`  Failures out: ${flags.failuresPath}`);
  console.log(`  Domains:      ${INDUSTRY_CANONICAL_LABELS.length} allowed labels`);
  console.log('');

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const summary = await runDomainClassification({
    force: flags.force,
    dryRun: flags.dryRun,
    batchSize: flags.batchSize,
    concurrency: flags.concurrency,
    throttleMs: flags.throttleMs,
    limit: flags.limit,
    escoPrefix: flags.escoPrefix,
    escoIds,
    model: flags.model,
    failuresPath: flags.failuresPath,
    onProgress: (done, total) => {
      process.stdout.write(`\r${done} / ${total} completed`);
    },
  });

  if (summary.processed > 0) process.stdout.write('\n');

  console.log('\n=== Summary ===');
  console.log(`  Matching filter:     ${summary.totalMatching}`);
  console.log(`  Total processed:     ${summary.processed}`);
  console.log(`  Succeeded:           ${summary.succeeded}`);
  console.log(`  Failed:              ${summary.failed}`);
  console.log(`  Needs manual review: ${summary.needsManualReview}`);
  console.log(
    `  Average confidence:  ${
      summary.averageConfidence == null
        ? 'n/a'
        : summary.averageConfidence.toFixed(4)
    }`
  );
  console.log(`  Failures file:       ${summary.failuresPath}`);

  if (summary.totalToProcess === 0) {
    console.log('\nNothing to do. Occupations are already classified (use --force to reclassify).');
  }

  await mongoose.disconnect();
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nClassification script failed:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
