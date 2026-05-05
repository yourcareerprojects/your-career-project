#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const {
  BAD_SKILL_DOMAINS_PATH,
  ensureTmpDir,
  isBadTranslation,
  normalizeLabel,
  parseArgs,
} = require('./lib/skillTranslationPipeline');
const { normalizeSkillKey } = require('../src/server/services/careerPathSkillService');

function labelEnDe(raw) {
  if (raw == null) return { en: '', de: '' };
  if (typeof raw === 'string') return { en: normalizeLabel(raw), de: '' };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { en: normalizeLabel(raw.en), de: normalizeLabel(raw.de) };
  }
  return { en: '', de: '' };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  await connectDB();

  const docs = await CareerPath.find({}, { skillDomains: 1 }).lean();
  const domainMap = new Map();
  for (const doc of docs) {
    const domains = Array.isArray(doc?.skillDomains?.skill_domains) ? doc.skillDomains.skill_domains : [];
    for (const domain of domains) {
      const { en, de } = labelEnDe(domain?.domain);
      if (!en && !de) continue;
      const key = normalizeSkillKey(domain?.key || en);
      if (!key) continue;
      if (!domainMap.has(key)) domainMap.set(key, { en, de });
    }
  }

  let domains = Array.from(domainMap.entries()).map(([key, lab]) => ({ key, ...lab }));
  if (Number.isFinite(limit) && limit > 0) domains = domains.slice(0, limit);

  const bad = [];
  for (const d of domains) {
    const en = d.en || '';
    const de = d.de || '';
    if (isBadTranslation(en, de)) {
      bad.push({
        domain_key: d.key,
        en,
        de,
      });
    }
  }

  ensureTmpDir();
  fs.writeFileSync(BAD_SKILL_DOMAINS_PATH, JSON.stringify(bad, null, 2), 'utf8');
  console.log(`[findBadSkillDomains] totalDomains=${domains.length}`);
  console.log(`[findBadSkillDomains] badDomains=${bad.length}`);
  console.log(`[findBadSkillDomains] output=${BAD_SKILL_DOMAINS_PATH}`);
}

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[findBadSkillDomains] failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  });
