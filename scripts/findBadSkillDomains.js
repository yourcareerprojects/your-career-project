#!/usr/bin/env node
/**
 * Finds skill domain labels that need German translation.
 *
 * Deduplicates by normalized domain key across all career paths. A domain is
 * "bad" when ANY role still has missing/placeholder German or a poor translation
 * (not only the first role seen for that key).
 */
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
    const en = normalizeLabel(raw.en);
    const de = raw.de == null || raw.de === '' ? '' : normalizeLabel(raw.de);
    return { en, de };
  }
  return { en: '', de: '' };
}

/**
 * Merge one domain row into the aggregated entry for its canonical key.
 *
 * @param {Map<string, object>} domainMap
 * @param {{ domain?: unknown, key?: string }} domainRow
 */
function accumulateDomainRow(domainMap, domainRow) {
  const { en, de } = labelEnDe(domainRow?.domain);
  if (!en && !de) return;

  const key = normalizeSkillKey(domainRow?.key || en);
  if (!key) return;

  let entry = domainMap.get(key);
  if (!entry) {
    entry = {
      en: en || '',
      de: '',
      anyMissingDe: false,
      anyBadTranslation: false,
      rowCount: 0,
    };
    domainMap.set(key, entry);
  }

  entry.rowCount += 1;
  if (en && !entry.en) entry.en = en;

  const rowDe = de || '';
  if (!rowDe) {
    entry.anyMissingDe = true;
  } else if (!entry.de) {
    entry.de = rowDe;
  }

  const labelEn = en || entry.en;
  if (isBadTranslation(labelEn, rowDe)) {
    entry.anyBadTranslation = true;
  }
}

function isBadDomainEntry(entry) {
  if (!entry?.en) return false;
  return Boolean(entry.anyMissingDe || entry.anyBadTranslation);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  await connectDB();

  const domainMap = new Map();
  const docs = await CareerPath.find({}, { skillDomains: 1 }).lean();
  for (const doc of docs) {
    const domains = Array.isArray(doc?.skillDomains?.skill_domains) ? doc.skillDomains.skill_domains : [];
    for (const domain of domains) {
      accumulateDomainRow(domainMap, domain);
    }
  }

  let domains = Array.from(domainMap.entries()).map(([key, entry]) => ({ key, ...entry }));
  if (Number.isFinite(limit) && limit > 0) domains = domains.slice(0, limit);

  const bad = [];
  let missingDeKeys = 0;
  let poorTranslationKeys = 0;

  for (const d of domains) {
    if (!isBadDomainEntry(d)) continue;

    if (d.anyMissingDe) missingDeKeys += 1;
    if (d.anyBadTranslation && !d.anyMissingDe) poorTranslationKeys += 1;

    bad.push({
      domain_key: d.key,
      en: d.en || '',
      de: d.anyMissingDe ? '' : (d.de || ''),
    });
  }

  ensureTmpDir();
  fs.writeFileSync(BAD_SKILL_DOMAINS_PATH, JSON.stringify(bad, null, 2), 'utf8');
  console.log(`[findBadSkillDomains] totalDomains=${domains.length}`);
  console.log(`[findBadSkillDomains] badDomains=${bad.length}`);
  console.log(`[findBadSkillDomains] badWithAnyMissingDe=${missingDeKeys}`);
  console.log(`[findBadSkillDomains] badPoorTranslationOnly=${poorTranslationKeys}`);
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
