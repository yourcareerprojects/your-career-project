#!/usr/bin/env node
/**
 * Harmonize skill domains across career paths by German label (fallback: English).
 * Merges rows that share the same dedupe bucket and rewrites keys to the canonical variant.
 *
 * Usage:
 *   node scripts/harmonizeSkillDomains.js [--dry] [--limit=N] [--esco-id=ID]
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const { toSkillDomainObjects, normalizeSkillKey } = require('../src/server/services/careerPathSkillService');
const {
  buildSkillDomainHarmonizationPlan,
  harmonizeSkillDomainRows,
} = require('../src/server/utils/skillDomainHarmonization');
const { parseArgs, ensureTmpDir, TMP_DIR } = require('./lib/skillTranslationPipeline');

const HARMONIZATION_MAP_PATH = path.join(TMP_DIR, 'skill_domain_harmonization_map.json');

function collectRowsFromCareerPaths(careerPaths = []) {
  const rows = [];
  for (const careerPath of careerPaths) {
    let domains = [];
    try {
      domains = toSkillDomainObjects(careerPath);
    } catch (_) {
      continue;
    }
    for (const domain of domains) {
      rows.push({
        key: domain.key || normalizeSkillKey(domain.label || domain.domainI18n?.en || ''),
        domainI18n: domain.domainI18n,
      });
    }
  }
  return rows;
}

function harmonizeSkillDomainsDocument(skillDomains, canonicalByDedupeKey) {
  if (!skillDomains) return { next: skillDomains, changed: false };

  if (Array.isArray(skillDomains)) {
    const legacyRows = skillDomains.map((row) => ({
      key: row?.key,
      domain: row?.domain ?? row?.label,
      importance: row?.importance || 'supporting',
      mapped_items: row?.items ?? row?.mapped_items ?? [],
    }));
    const harmonized = harmonizeSkillDomainRows(legacyRows, canonicalByDedupeKey);
    const next = harmonized.map((row) => ({
      key: row.key,
      domain: row.domain,
      importance: row.importance,
      items: row.mapped_items,
    }));
    return { next, changed: JSON.stringify(next) !== JSON.stringify(skillDomains) };
  }

  const legacyRows = Array.isArray(skillDomains.skill_domains) ? skillDomains.skill_domains : [];
  if (legacyRows.length === 0) return { next: skillDomains, changed: false };

  const harmonized = harmonizeSkillDomainRows(legacyRows, canonicalByDedupeKey);
  const next = {
    ...skillDomains,
    skill_domains: harmonized.map((row) => ({
      key: row.key,
      domain: row.domain,
      importance: row.importance,
      mapped_items: row.mapped_items,
    })),
  };
  return { next, changed: JSON.stringify(next.skill_domains) !== JSON.stringify(legacyRows) };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args.dry);
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const escoId = args['esco-id'] ? String(args['esco-id']).trim() : '';

  await connectDB();

  const query = escoId ? { escoId } : { 'skillDomains.skill_domains.0': { $exists: true } };
  let cursor = CareerPath.find(query, { skillDomains: 1, escoId: 1 }).lean().cursor();
  const allForPlan = await CareerPath.find(
    escoId ? { escoId } : { 'skillDomains.skill_domains.0': { $exists: true } },
    { skillDomains: 1 },
  ).lean();

  const { canonicalByDedupeKey, keyAliasMap } = buildSkillDomainHarmonizationPlan(
    collectRowsFromCareerPaths(allForPlan),
  );

  const aliasEntries = [...keyAliasMap.entries()]
    .filter(([alias, canonical]) => alias !== canonical)
    .map(([alias, canonical]) => ({ alias, canonical }))
    .sort((a, b) => a.alias.localeCompare(b.alias));

  ensureTmpDir();
  fs.writeFileSync(
    HARMONIZATION_MAP_PATH,
    JSON.stringify({
      aliasCount: aliasEntries.length,
      canonicalBuckets: canonicalByDedupeKey.size,
      aliases: aliasEntries,
    }, null, 2),
    'utf8',
  );

  let scanned = 0;
  let updated = 0;
  let rowsBefore = 0;
  let rowsAfter = 0;

  for await (const doc of cursor) {
    if (Number.isFinite(limit) && limit > 0 && scanned >= limit) break;
    scanned += 1;
    const beforeRows = Array.isArray(doc.skillDomains?.skill_domains)
      ? doc.skillDomains.skill_domains.length
      : Array.isArray(doc.skillDomains)
        ? doc.skillDomains.length
        : 0;
    rowsBefore += beforeRows;

    const { next, changed } = harmonizeSkillDomainsDocument(doc.skillDomains, canonicalByDedupeKey);
    const afterRows = Array.isArray(next?.skill_domains)
      ? next.skill_domains.length
      : Array.isArray(next)
        ? next.length
        : beforeRows;
    rowsAfter += afterRows;

    if (!changed) continue;
    updated += 1;
    if (dryRun) continue;

    await CareerPath.collection.updateOne(
      { _id: doc._id },
      { $set: { skillDomains: next } },
    );
  }

  console.log(
    `[harmonizeSkillDomains] dryRun=${dryRun} scanned=${scanned} updated=${updated} `
    + `rowsBefore=${rowsBefore} rowsAfter=${rowsAfter} aliasCount=${aliasEntries.length} `
    + `map=${HARMONIZATION_MAP_PATH}`,
  );

  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[harmonizeSkillDomains] failed:', err);
      mongoose.connection.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run, harmonizeSkillDomainsDocument, collectRowsFromCareerPaths };
