#!/usr/bin/env node
/**
 * Applies `tmp/skill_domain_suggestions.json` to embedded i18n on career paths:
 * for each `skillDomains.skill_domains[]` row whose domain key matches `domain_key`,
 * sets `domain` to `{ en, de: suggested_de }` (keeps English from the document).
 *
 * Flags: `--dry` (no writes), `--limit=N` (only the first N rows of the JSON are used
 * to build the key→de map; all career paths are still scanned for matching keys).
 */
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const { SKILL_DOMAIN_SUGGESTIONS_PATH, normalizeLabel, parseArgs } = require('./lib/skillTranslationPipeline');
const { normalizeSkillKey } = require('../src/server/services/careerPathSkillService');

function getDomainEn(domainField) {
  if (domainField == null) return '';
  if (typeof domainField === 'string') return normalizeLabel(domainField);
  if (typeof domainField === 'object' && !Array.isArray(domainField) && domainField.en != null) {
    return normalizeLabel(domainField.en);
  }
  return '';
}

function getDomainDe(domainField) {
  if (domainField == null) return '';
  if (typeof domainField === 'object' && !Array.isArray(domainField) && Object.prototype.hasOwnProperty.call(domainField, 'de')) {
    return domainField.de == null || domainField.de === '' ? '' : String(domainField.de).trim();
  }
  return '';
}

function isPlaceholderDe(s) {
  const t = String(s || '').toLowerCase().trim();
  if (!t) return true;
  if (t.startsWith('[de]') || t.startsWith('[de placeholder]')) return true;
  if (t.includes('placeholder') || t.includes('fallback')) return true;
  return false;
}

/**
 * @param {object} row - skill_domains entry
 * @param {Map<string, string>} suggestedDeByKey - domain_key -> suggested_de
 * @returns {{ row: object, changed: boolean }}
 */
function patchRow(row, suggestedDeByKey) {
  if (!row || typeof row !== 'object') {
    return { row, changed: false };
  }
  const en = getDomainEn(row.domain);
  const rowKey = row.key != null && String(row.key).trim() ? String(row.key) : '';
  const suggestedDe = findSuggestedDe(rowKey, en, suggestedDeByKey);
  if (!suggestedDe) {
    return { row, changed: false };
  }
  const de = normalizeLabel(suggestedDe);
  if (!de || isPlaceholderDe(de)) {
    return { row, changed: false };
  }
  if (getDomainDe(row.domain) === de) {
    return { row, changed: false };
  }
  if (!en) {
    return { row, changed: false };
  }
  return { row: { ...row, domain: { en, de } }, changed: true };
}

/**
 * Same canonical key as findBadSkillDomains / generate: normalizeSkillKey on key or EN label.
 * @param {string} rowKey
 * @param {string} enFromDomain
 * @param {Map<string, string>} map
 * @returns {string|null}
 */
function findSuggestedDe(rowKey, enFromDomain, map) {
  const keys = new Set();
  if (rowKey && String(rowKey).trim()) {
    keys.add(normalizeSkillKey(rowKey));
  }
  if (enFromDomain) {
    keys.add(normalizeSkillKey(enFromDomain));
  }
  for (const k of keys) {
    if (k && map.has(k)) {
      return map.get(k);
    }
  }
  return null;
}

function buildSuggestionMap(entries) {
  const suggestedDeByKey = new Map();
  for (const e of entries) {
    const s = normalizeLabel(e.suggested_de);
    if (!s || isPlaceholderDe(s)) continue;
    const dk = e.domain_key != null && String(e.domain_key).trim()
      ? normalizeSkillKey(e.domain_key)
      : null;
    const ek = e.en != null && String(e.en).trim() ? normalizeSkillKey(e.en) : null;
    if (dk) suggestedDeByKey.set(dk, s);
    if (ek) suggestedDeByKey.set(ek, s);
  }
  return suggestedDeByKey;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args.dry);
  const limit = Number.parseInt(String(args.limit || '0'), 10);

  if (!fs.existsSync(SKILL_DOMAIN_SUGGESTIONS_PATH)) {
    throw new Error(
      `Missing input file: ${SKILL_DOMAIN_SUGGESTIONS_PATH}. Run skills-domains:generate-suggestions first.`,
    );
  }
  let entries = JSON.parse(fs.readFileSync(SKILL_DOMAIN_SUGGESTIONS_PATH, 'utf8'));
  if (!Array.isArray(entries)) entries = [];
  if (Number.isFinite(limit) && limit > 0) entries = entries.slice(0, limit);

  const suggestedDeByKey = buildSuggestionMap(entries);

  await connectDB();

  let pathUpdates = 0;
  let skippedPaths = 0;
  let domainRowsTotal = 0;
  let domainRowsWithNullDe = 0;
  let domainRowsThatWouldGetDe = 0;

  const cur = CareerPath.find({ 'skillDomains.skill_domains.0': { $exists: true } }, { skillDomains: 1 })
    .lean()
    .cursor();
  for await (const doc of cur) {
    const sds = doc?.skillDomains?.skill_domains;
    if (!Array.isArray(sds) || sds.length === 0) {
      skippedPaths += 1;
      continue;
    }
    for (const row of sds) {
      domainRowsTotal += 1;
      const dde = getDomainDe(row?.domain);
      if (!dde) {
        domainRowsWithNullDe += 1;
        const en = getDomainEn(row?.domain);
        const rowKey = row.key != null && String(row.key).trim() ? String(row.key) : '';
        const s = findSuggestedDe(rowKey, en, suggestedDeByKey);
        if (s && !isPlaceholderDe(normalizeLabel(s))) {
          domainRowsThatWouldGetDe += 1;
        }
      }
    }
    let any = false;
    const next = sds.map((row) => {
      const { row: out, changed } = patchRow(row, suggestedDeByKey);
      if (changed) any = true;
      return out;
    });
    if (!any) {
      skippedPaths += 1;
      continue;
    }
    if (dryRun) {
      pathUpdates += 1;
      continue;
    }
    // Native collection write avoids any edge-case subdoc casting on `domain.de`
    await CareerPath.collection.updateOne(
      { _id: doc._id },
      { $set: { 'skillDomains.skill_domains': next } },
    );
    pathUpdates += 1;
  }

  const appliedLabel = dryRun ? 'careerPathsWouldUpdate' : 'careerPathsUpdated';
  console.log(
    `[applySkillDomainTranslations] dryRun=${dryRun} ${appliedLabel}=${pathUpdates} pathsUnchangedOrNoMatch=${skippedPaths} suggestionKeys=${suggestedDeByKey.size}`,
  );
  console.log(
    `[applySkillDomainTranslations] domainRowsTotal=${domainRowsTotal} domainRowsWithNullDe=${domainRowsWithNullDe} ` +
    `domainRowsThatWouldStillGetDeIfMatched=${domainRowsThatWouldGetDe} ` +
    '(if nullDe>0 and wouldGetDe=0, no suggestion key matches those rows; see find-bad + regenerate)',
  );
  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[applySkillDomainTranslations] failed:', err);
      mongoose.connection.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run, patchRow, getDomainEn, isPlaceholderDe, buildSuggestionMap, findSuggestedDe };
