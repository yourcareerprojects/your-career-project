// syncEscoOccupations.js
// Proper ESCO sync (pagination + enrichment + requiredSkills normalization)
//
// Usage examples (PowerShell):
//   cmd /c node scripts/syncEscoOccupations.js --limit 500 --pageSize 100 --enrich --throttleMs 50
//   cmd /c node scripts/syncEscoOccupations.js --limit 5000 --pageSize 200 --enrich --normalizeExisting
//
// Notes:
// - Full ESCO sync can take a long time due to enrichment calls.
// - Prefer smaller batches first to validate data quality.

const mongoose = require('mongoose');
require('dotenv').config();

const escoService = require('../src/server/services/escoService');

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getArg(name, defaultValue) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return defaultValue;
  const raw = process.argv[idx + 1];
  if (raw === undefined) return defaultValue;
  return raw;
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

  const limit = toInt(getArg('limit', 50), 50);
  const offset = toInt(getArg('offset', 0), 0);
  const pageSize = toInt(getArg('pageSize', 100), 100);
  const throttleMs = toInt(getArg('throttleMs', 0), 0);
  const enrich = hasFlag('enrich');
  const enrichSkills = hasFlag('noEnrichSkills') ? false : true;
  const normalizeExisting = hasFlag('normalizeExisting');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  console.log('Starting ESCO sync with options:', {
    limit,
    offset,
    pageSize,
    enrich,
    enrichSkills,
    throttleMs,
    normalizeExisting,
  });

  const startedAt = Date.now();
  const results = await escoService.cacheESCOOccupations({
    limit,
    offset,
    pageSize,
    enrich,
    enrichSkills,
    throttleMs,
  });

  console.log(`Upserted ${results.length} occupations in ${(Date.now() - startedAt) / 1000}s`);

  if (normalizeExisting) {
    console.log('Normalizing existing CareerPath requiredSkills...');
    const norm = await escoService.normalizeCareerPathRequiredSkills();
    console.log('Normalization complete:', norm);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('ESCO sync failed:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

