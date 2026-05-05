#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const {
  BAD_ROLE_RESPONSIBILITIES_PATH,
  ensureTmpDir,
  normalizeLabel,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => normalizeLabel(item)).filter(Boolean);
}

function isPlaceholderDe(s) {
  const t = String(s || '').toLowerCase().trim();
  if (!t) return true;
  if (t.startsWith('[de]') || t.startsWith('[de placeholder]')) return true;
  if (t.includes('placeholder') || t.includes('fallback')) return true;
  return false;
}

function hasBadResponsibilities(enList, deList) {
  if (!Array.isArray(enList) || enList.length === 0) return false;
  if (!Array.isArray(deList) || deList.length !== enList.length) return true;
  for (let i = 0; i < enList.length; i += 1) {
    const en = normalizeLabel(enList[i]);
    const de = normalizeLabel(deList[i]);
    if (!de || isPlaceholderDe(de)) return true;
    if (en && de.toLowerCase() === en.toLowerCase()) return true;
  }
  return false;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const includeAll = Boolean(args.all);

  await connectDB();

  const cpQuery = CareerPath.find(
    {},
    { _id: 1, escoId: 1, title: 1, keyResponsibilities: 1, keyResponsibilitiesDe: 1 }
  ).lean();
  if (Number.isFinite(limit) && limit > 0) cpQuery.limit(limit);
  const cps = await cpQuery;

  const bad = [];
  for (const cp of cps) {
    const enResponsibilities = normalizeList(cp?.keyResponsibilities?.responsibilities);
    if (enResponsibilities.length === 0) continue;
    const deResponsibilities = normalizeList(cp?.keyResponsibilitiesDe);
    if (includeAll || hasBadResponsibilities(enResponsibilities, deResponsibilities)) {
      bad.push({
        career_path_id: String(cp._id),
        esco_id: normalizeLabel(cp.escoId),
        role_title_en: normalizeLabel(cp?.title?.en || cp?.title || ''),
        responsibilities_en: enResponsibilities,
        responsibilities_de: deResponsibilities,
      });
    }
  }

  ensureTmpDir();
  fs.writeFileSync(BAD_ROLE_RESPONSIBILITIES_PATH, JSON.stringify(bad, null, 2), 'utf8');
  console.log(`[findBadRoleResponsibilities] totalRoles=${cps.length}`);
  console.log(`[findBadRoleResponsibilities] mode=${includeAll ? 'all' : 'bad-only'}`);
  console.log(`[findBadRoleResponsibilities] selectedRoles=${bad.length}`);
  console.log(`[findBadRoleResponsibilities] output=${BAD_ROLE_RESPONSIBILITIES_PATH}`);
}

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[findBadRoleResponsibilities] failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  });
