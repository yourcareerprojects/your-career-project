#!/usr/bin/env node
/**
 * Applies `tmp/role_description_suggestions.json` to embedded i18n on career paths:
 * sets `description` to `{ en, de: suggested_de }` (keeps English from the document when present).
 */
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const {
  ROLE_DESCRIPTION_SUGGESTIONS_PATH,
  normalizeDescriptionBody,
  normalizeLabel,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

function getDescriptionEn(field) {
  if (field == null) return '';
  if (typeof field === 'string') return normalizeDescriptionBody(field);
  if (typeof field === 'object' && !Array.isArray(field) && field.en != null) {
    return normalizeDescriptionBody(field.en);
  }
  return '';
}

function getDescriptionDe(field) {
  if (field == null) return '';
  if (typeof field === 'object' && !Array.isArray(field) && Object.prototype.hasOwnProperty.call(field, 'de')) {
    if (field.de == null || field.de === '') return '';
    return normalizeDescriptionBody(field.de);
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

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args.dry);
  const limit = Number.parseInt(String(args.limit || '0'), 10);

  if (!fs.existsSync(ROLE_DESCRIPTION_SUGGESTIONS_PATH)) {
    throw new Error(
      `Missing input file: ${ROLE_DESCRIPTION_SUGGESTIONS_PATH}. Run roles:generate-description-suggestions first.`,
    );
  }
  let entries = JSON.parse(fs.readFileSync(ROLE_DESCRIPTION_SUGGESTIONS_PATH, 'utf8'));
  if (!Array.isArray(entries)) entries = [];
  if (Number.isFinite(limit) && limit > 0) entries = entries.slice(0, limit);

  await connectDB();

  let applied = 0;
  let skipped = 0;
  let notFound = 0;

  for (const entry of entries) {
    const cpId = normalizeLabel(entry.career_path_id);
    const suggestedDeRaw = entry.suggested_de;
    const suggestedDe = typeof suggestedDeRaw === 'string' ? normalizeDescriptionBody(suggestedDeRaw) : '';
    if (!cpId || !suggestedDe || isPlaceholderDe(suggestedDe)) {
      skipped += 1;
      continue;
    }

    const doc = await CareerPath.findById(cpId).select('description').lean();
    if (!doc) {
      notFound += 1;
      continue;
    }
    const en = getDescriptionEn(doc.description) || normalizeDescriptionBody(entry.en);
    if (!en) {
      skipped += 1;
      continue;
    }
    if (getDescriptionDe(doc.description) === suggestedDe) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      applied += 1;
      continue;
    }

    const result = await CareerPath.updateOne(
      { _id: cpId },
      { $set: { description: { en, de: suggestedDe } } },
    );
    if (result.matchedCount) {
      applied += 1;
    } else {
      notFound += 1;
    }
  }

  console.log(
    `[applyRoleDescriptionTranslations] dryRun=${dryRun} ${dryRun ? 'wouldApply' : 'applied'}=${applied} skipped=${skipped} notFound=${notFound} inputRows=${entries.length}`,
  );
  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[applyRoleDescriptionTranslations] failed:', err);
      mongoose.connection.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run, getDescriptionEn, getDescriptionDe, isPlaceholderDe };
