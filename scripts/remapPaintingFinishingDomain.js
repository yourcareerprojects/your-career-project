#!/usr/bin/env node
/**
 * Remap legacy "Painting & Finishing" domain data to "Skilled Trades".
 *
 * Updates:
 * - CareerPath.domain
 * - User.profile.careerPreferences.domains
 * - User.profile.structuredUserInfo.domains.raw_items
 * - User.profile.careerSimulationInputs.structuredUserInfo.domains.raw_items
 *
 * Usage:
 *   node scripts/remapPaintingFinishingDomain.js
 *   node scripts/remapPaintingFinishingDomain.js --dry-run
 *   node scripts/remapPaintingFinishingDomain.js --limit=100
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const User = require('../src/server/models/User');
const {
  normalizeIndustryDomains,
  normalizeIndustryLabel,
} = require('../src/constants/industries');

const TARGET_DOMAIN = 'Skilled Trades';
const LEGACY_DOMAIN_VALUES = [
  'Painting & Finishing',
  'Painting and Finishing',
  'Maler & Lackierer',
  'Painting Trades',
  'Finishing Trades',
];
const LEGACY_DOMAIN_KEYS = new Set(LEGACY_DOMAIN_VALUES.map((v) => v.toLowerCase()));

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.slice(2).split('=');
    out[k] = v == null ? true : v;
  }
  return out;
}

function isLegacyPaintingFinishingValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return false;
  if (LEGACY_DOMAIN_KEYS.has(raw)) return true;
  return normalizeIndustryLabel(value) === TARGET_DOMAIN && raw !== TARGET_DOMAIN.toLowerCase();
}

function remapDomainArray(values) {
  if (!Array.isArray(values)) return values;
  const hadLegacy = values.some(isLegacyPaintingFinishingValue);
  if (!hadLegacy) return values;
  return normalizeIndustryDomains(values, { keepUnknown: true });
}

async function migrateCareerPaths({ dryRun, limit }) {
  const filter = { domain: { $in: LEGACY_DOMAIN_VALUES } };
  const matching = await CareerPath.countDocuments(filter);
  console.log(`[remapPaintingFinishingDomain] CareerPath matches: ${matching}${dryRun ? ' (dry-run)' : ''}`);

  if (matching === 0) {
    return { matched: 0, modified: 0 };
  }

  if (dryRun) {
    const sampleQuery = CareerPath.find(filter, { escoId: 1, 'title.en': 1, domain: 1 }).lean();
    if (Number.isFinite(limit) && limit > 0) sampleQuery.limit(limit);
    const sample = await sampleQuery;
    for (const doc of sample.slice(0, 20)) {
      console.log(`  CareerPath: ${doc.escoId} | ${doc.title?.en || '(no title)'} | ${doc.domain} -> ${TARGET_DOMAIN}`);
    }
    if (sample.length > 20) console.log(`  ... and ${sample.length - 20} more CareerPath docs in sample`);
    return { matched: matching, modified: 0 };
  }

  if (Number.isFinite(limit) && limit > 0) {
    const ids = await CareerPath.find(filter, { _id: 1 }).limit(limit).lean();
    const result = await CareerPath.updateMany(
      { _id: { $in: ids.map((doc) => doc._id) } },
      { $set: { domain: TARGET_DOMAIN } }
    );
    return { matched: result.matchedCount, modified: result.modifiedCount };
  }

  const result = await CareerPath.updateMany(filter, { $set: { domain: TARGET_DOMAIN } });
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

async function migrateUsers({ dryRun, limit }) {
  const query = {
    $or: [
      { 'profile.careerPreferences.domains': { $in: LEGACY_DOMAIN_VALUES } },
      { 'profile.structuredUserInfo.domains.raw_items': { $in: LEGACY_DOMAIN_VALUES } },
      { 'profile.careerSimulationInputs.structuredUserInfo.domains.raw_items': { $in: LEGACY_DOMAIN_VALUES } },
    ],
  };

  const matching = await User.countDocuments(query);
  console.log(`[remapPaintingFinishingDomain] User matches: ${matching}${dryRun ? ' (dry-run)' : ''}`);
  if (matching === 0) {
    return { matched: 0, modified: 0 };
  }

  let cursor = User.find(query).select(
    '_id email profile.careerPreferences.domains profile.structuredUserInfo.domains.raw_items profile.careerSimulationInputs.structuredUserInfo.domains.raw_items'
  );
  if (Number.isFinite(limit) && limit > 0) cursor = cursor.limit(limit);
  const users = await cursor.lean();

  if (dryRun) {
    for (const user of users.slice(0, 20)) {
      console.log(`  User: ${user.email || user._id}`);
      console.log(`    careerPreferences: ${JSON.stringify(user.profile?.careerPreferences?.domains || [])}`);
      console.log(`    structuredUserInfo: ${JSON.stringify(user.profile?.structuredUserInfo?.domains?.raw_items || [])}`);
      console.log(`    simulationInputs: ${JSON.stringify(user.profile?.careerSimulationInputs?.structuredUserInfo?.domains?.raw_items || [])}`);
    }
    if (users.length > 20) console.log(`  ... and ${users.length - 20} more user docs in sample`);
    return { matched: matching, modified: 0 };
  }

  let modifiedUsers = 0;
  for (const user of users) {
    const updates = {};
    const prefDomains = remapDomainArray(user.profile?.careerPreferences?.domains);
    const structuredDomains = remapDomainArray(user.profile?.structuredUserInfo?.domains?.raw_items);
    const simulationDomains = remapDomainArray(
      user.profile?.careerSimulationInputs?.structuredUserInfo?.domains?.raw_items
    );

    if (prefDomains !== user.profile?.careerPreferences?.domains) {
      updates['profile.careerPreferences.domains'] = prefDomains;
    }
    if (structuredDomains !== user.profile?.structuredUserInfo?.domains?.raw_items) {
      updates['profile.structuredUserInfo.domains.raw_items'] = structuredDomains;
    }
    if (simulationDomains !== user.profile?.careerSimulationInputs?.structuredUserInfo?.domains?.raw_items) {
      updates['profile.careerSimulationInputs.structuredUserInfo.domains.raw_items'] = simulationDomains;
    }

    if (Object.keys(updates).length === 0) continue;
    const result = await User.updateOne({ _id: user._id }, { $set: updates });
    if (result.modifiedCount > 0) modifiedUsers += 1;
  }

  return { matched: matching, modified: modifiedUsers };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.dry);
  const limit = args.limit != null ? Number.parseInt(String(args.limit), 10) : null;

  await connectDB();

  const careerPathResult = await migrateCareerPaths({ dryRun, limit });
  const userResult = await migrateUsers({ dryRun, limit });

  console.log(
    `[remapPaintingFinishingDomain] CareerPath updated: ${careerPathResult.modified} / ${careerPathResult.matched}`
  );
  console.log(
    `[remapPaintingFinishingDomain] Users updated: ${userResult.modified} / ${userResult.matched}`
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[remapPaintingFinishingDomain] failed:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
