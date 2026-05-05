#!/usr/bin/env node
/**
 * Applies `tmp/skill_suggestions.json` to embedded i18n on the skills collection:
 * sets `label` to `{ en, de: suggested_de }` (keeps English from the document when present).
 *
 * `requiredSkills` / `optionalSkills` on career paths are lists of keys or labels — they
 * resolve to the same `Skill` documents; updating `skills.label` updates display for all roles.
 *
 * Flags: `--dry` (no writes), `--limit=N` (only first N rows in the JSON file).
 */
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Skill = require('../src/server/models/Skill');
const { SUGGESTIONS_PATH, normalizeLabel, parseArgs } = require('./lib/skillTranslationPipeline');
const { normalizeSkillKey } = require('../src/server/services/careerPathSkillService');

function getLabelEn(labelField) {
  if (labelField == null) return '';
  if (typeof labelField === 'string') return normalizeLabel(labelField);
  if (typeof labelField === 'object' && !Array.isArray(labelField) && labelField.en != null) {
    return normalizeLabel(labelField.en);
  }
  return '';
}

function getLabelDe(labelField) {
  if (labelField == null) return '';
  if (typeof labelField === 'object' && !Array.isArray(labelField) && Object.prototype.hasOwnProperty.call(labelField, 'de')) {
    return labelField.de == null || labelField.de === '' ? '' : String(labelField.de).trim();
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

async function findSkillDocByEntry(entry) {
  const sid = entry.skill_id != null && String(entry.skill_id).trim() ? String(entry.skill_id).trim() : null;
  if (sid && mongoose.isValidObjectId(sid)) {
    const byId = await Skill.findById(sid).select('label key').lean();
    if (byId) return byId;
  }
  const rawKey = entry.key != null && String(entry.key).trim() ? String(entry.key).trim() : '';
  if (rawKey) {
    const k = normalizeSkillKey(rawKey) || rawKey.toLowerCase();
    return Skill.findOne({ key: k }).select('label key').lean();
  }
  return null;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args.dry);
  const limit = Number.parseInt(String(args.limit || '0'), 10);

  if (!fs.existsSync(SUGGESTIONS_PATH)) {
    throw new Error(
      `Missing input file: ${SUGGESTIONS_PATH}. Run skills:generate-suggestions first.`,
    );
  }
  let entries = JSON.parse(fs.readFileSync(SUGGESTIONS_PATH, 'utf8'));
  if (!Array.isArray(entries)) entries = [];
  if (Number.isFinite(limit) && limit > 0) entries = entries.slice(0, limit);

  await connectDB();

  let applied = 0;
  let skipped = 0;
  let notFound = 0;

  for (const entry of entries) {
    const suggestedDe = normalizeLabel(entry.suggested_de);
    if (!suggestedDe || isPlaceholderDe(suggestedDe)) {
      skipped += 1;
      continue;
    }

    const doc = await findSkillDocByEntry(entry);
    if (!doc) {
      notFound += 1;
      continue;
    }
    const en = getLabelEn(doc.label) || normalizeLabel(entry.en);
    if (!en) {
      skipped += 1;
      continue;
    }
    if (getLabelDe(doc.label) === suggestedDe) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      applied += 1;
      continue;
    }

    const nextLabel = { en, de: suggestedDe };
    const result = await Skill.collection.updateOne(
      { _id: doc._id },
      { $set: { label: nextLabel } },
    );
    if (result.matchedCount) {
      applied += 1;
    } else {
      notFound += 1;
    }
  }

  console.log(
    `[applySkillTranslations] dryRun=${dryRun} ${dryRun ? 'wouldApply' : 'applied'}=${applied} skipped=${skipped} notFound=${notFound} inputRows=${entries.length}`,
  );
  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[applySkillTranslations] failed:', err);
      mongoose.connection.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run, getLabelEn, getLabelDe, isPlaceholderDe, findSkillDocByEntry };
