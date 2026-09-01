#!/usr/bin/env node
/**
 * Initialize CareerPath.domain for existing occupations.
 *
 * Sets domain = "UNASSIGNED" on any document where domain is missing, null, or empty.
 * Does NOT classify occupations into industry domains.
 *
 * Usage:
 *   node scripts/migrateOccupationDomains.js
 *   node scripts/migrateOccupationDomains.js --dry-run
 *   node scripts/migrateOccupationDomains.js --dry-run --limit=100
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const { UNASSIGNED_ROLE_DOMAIN } = require('../src/constants/industries');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.slice(2).split('=');
    out[k] = v == null ? true : v;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.dry);
  const limit = args.limit != null ? Number.parseInt(String(args.limit), 10) : null;

  await connectDB();

  const filter = {
    $or: [
      { domain: { $exists: false } },
      { domain: null },
      { domain: '' },
    ],
  };

  const totalMatching = await CareerPath.countDocuments(filter);
  console.log(
    `[migrateOccupationDomains] occupations needing domain=${UNASSIGNED_ROLE_DOMAIN}: ${totalMatching}` +
      (dryRun ? ' (dry-run)' : '')
  );

  if (totalMatching === 0) {
    console.log('[migrateOccupationDomains] nothing to update');
    await mongoose.disconnect();
    return;
  }

  if (dryRun) {
    const sampleQuery = CareerPath.find(filter, { escoId: 1, 'title.en': 1, domain: 1 }).lean();
    if (Number.isFinite(limit) && limit > 0) sampleQuery.limit(limit);
    const sample = await sampleQuery;
    console.log(`[migrateOccupationDomains] sample (${sample.length}):`);
    for (const doc of sample.slice(0, 20)) {
      console.log(`  - ${doc.escoId} | ${doc.title?.en || '(no title)'} | domain=${doc.domain ?? '(missing)'}`);
    }
    if (sample.length > 20) console.log(`  ... and ${sample.length - 20} more in sample`);
    await mongoose.disconnect();
    return;
  }

  if (Number.isFinite(limit) && limit > 0) {
    const ids = await CareerPath.find(filter, { _id: 1 }).limit(limit).lean();
    const result = await CareerPath.updateMany(
      { _id: { $in: ids.map((d) => d._id) } },
      { $set: { domain: UNASSIGNED_ROLE_DOMAIN } }
    );
    console.log(
      `[migrateOccupationDomains] updated ${result.modifiedCount} (matched ${result.matchedCount}, limit=${limit})`
    );
  } else {
    const result = await CareerPath.updateMany(filter, {
      $set: { domain: UNASSIGNED_ROLE_DOMAIN },
    });
    console.log(
      `[migrateOccupationDomains] updated ${result.modifiedCount} (matched ${result.matchedCount})`
    );
  }

  const remaining = await CareerPath.countDocuments(filter);
  const unassigned = await CareerPath.countDocuments({ domain: UNASSIGNED_ROLE_DOMAIN });
  console.log(`[migrateOccupationDomains] remaining without domain: ${remaining}`);
  console.log(`[migrateOccupationDomains] total with domain=${UNASSIGNED_ROLE_DOMAIN}: ${unassigned}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[migrateOccupationDomains] failed:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
