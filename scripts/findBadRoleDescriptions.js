#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const {
  BAD_ROLE_DESCRIPTIONS_PATH,
  ensureTmpDir,
  isBadDescriptionTranslation,
  normalizeDescriptionBody,
  normalizeLabel,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

function getDescriptionEn(d) {
  if (d == null) return '';
  if (typeof d === 'string') return normalizeDescriptionBody(d);
  if (typeof d === 'object' && !Array.isArray(d) && d.en != null) {
    return normalizeDescriptionBody(d.en);
  }
  return '';
}

function getDescriptionDe(d) {
  if (d == null) return '';
  if (typeof d === 'object' && !Array.isArray(d) && Object.prototype.hasOwnProperty.call(d, 'de')) {
    if (d.de == null || d.de === '') return '';
    return normalizeDescriptionBody(d.de);
  }
  return '';
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const includeAll = Boolean(args.all);

  await connectDB();

  const cpQuery = CareerPath.find({}, { _id: 1, escoId: 1, title: 1, description: 1 }).lean();
  if (Number.isFinite(limit) && limit > 0) cpQuery.limit(limit);
  const cps = await cpQuery;

  const bad = [];
  for (const cp of cps) {
    const en = getDescriptionEn(cp.description);
    if (!en) continue;
    const de = getDescriptionDe(cp.description);
    const titleEn = normalizeLabel(cp?.title?.en || cp?.title || '');

    if (includeAll || isBadDescriptionTranslation(en, de)) {
      bad.push({
        career_path_id: String(cp._id),
        esco_id: normalizeLabel(cp.escoId),
        role_title_en: titleEn,
        en,
        de,
      });
    }
  }

  ensureTmpDir();
  fs.writeFileSync(BAD_ROLE_DESCRIPTIONS_PATH, JSON.stringify(bad, null, 2), 'utf8');
  console.log(`[findBadRoleDescriptions] totalRolesScanned=${cps.length}`);
  console.log(`[findBadRoleDescriptions] mode=${includeAll ? 'all' : 'bad-only'}`);
  console.log(`[findBadRoleDescriptions] selectedWithDescription=${bad.length}`);
  console.log(`[findBadRoleDescriptions] output=${BAD_ROLE_DESCRIPTIONS_PATH}`);
}

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[findBadRoleDescriptions] failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  });
