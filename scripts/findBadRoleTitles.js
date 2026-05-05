#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const {
  BAD_ROLE_TITLES_PATH,
  ensureTmpDir,
  isBadTranslation,
  normalizeLabel,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const includeAll = Boolean(args.all);

  await connectDB();

  const cpQuery = CareerPath.find({}, { _id: 1, escoId: 1, title: 1, altTitles: 1, hiddenTitles: 1 }).lean();
  if (Number.isFinite(limit) && limit > 0) cpQuery.limit(limit);
  const cps = await cpQuery;
  const cpById = new Map(cps.map((c) => [String(c._id), c]));

  const bad = [];
  for (const cp of cps) {
    const cpId = String(cp._id);
    const t = cp.title;
    let en = '';
    let de = '';
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      en = normalizeLabel(t.en);
      de = normalizeLabel(t.de);
    } else if (typeof t === 'string') {
      en = normalizeLabel(t);
    }

    const normalizedAltTitles = Array.isArray(cp.altTitles)
      ? cp.altTitles.map((label) => normalizeLabel(label)).filter(Boolean)
      : [];
    const normalizedHiddenTitles = Array.isArray(cp.hiddenTitles)
      ? cp.hiddenTitles.map((label) => normalizeLabel(label)).filter(Boolean)
      : [];

    if (includeAll || isBadTranslation(en, de)) {
      bad.push({
        career_path_id: cpId,
        esco_id: cpById.get(cpId)?.escoId || '',
        en,
        de,
        alt_titles_en: normalizedAltTitles,
        hidden_titles_en: normalizedHiddenTitles,
      });
    }
  }

  ensureTmpDir();
  fs.writeFileSync(BAD_ROLE_TITLES_PATH, JSON.stringify(bad, null, 2), 'utf8');
  console.log(`[findBadRoleTitles] totalRoles=${cps.length}`);
  console.log(`[findBadRoleTitles] mode=${includeAll ? 'all' : 'bad-only'}`);
  console.log(`[findBadRoleTitles] selectedRoles=${bad.length}`);
  console.log(`[findBadRoleTitles] output=${BAD_ROLE_TITLES_PATH}`);
}

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[findBadRoleTitles] failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  });
