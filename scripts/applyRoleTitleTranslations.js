#!/usr/bin/env node
/**
 * Applies `tmp/role_title_suggestions.json` to embedded i18n on careerpaths:
 * sets `title.de` (and `title.en` if title was a legacy string) on each CareerPath.
 */
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const { ROLE_TITLE_SUGGESTIONS_PATH, normalizeLabel, parseArgs } = require('./lib/skillTranslationPipeline');

function getEnglishTitle(title) {
  if (title == null) return '';
  if (typeof title === 'string') return String(title).trim();
  if (typeof title === 'object' && title.en != null) return String(title.en).trim();
  return '';
}

function isPlaceholderDe(s) {
  const t = String(s || '').toLowerCase().trim();
  if (!t) return true;
  if (t.startsWith('[de]') || t.startsWith('[de placeholder]')) return true;
  if (t.includes('placeholder') || t.includes('fallback')) return true;
  return false;
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => normalizeLabel(item))
    .filter(Boolean);
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args.dry);
  const limit = Number.parseInt(String(args.limit || '0'), 10);

  if (!fs.existsSync(ROLE_TITLE_SUGGESTIONS_PATH)) {
    throw new Error(
      `Missing input file: ${ROLE_TITLE_SUGGESTIONS_PATH}. Run roles:generate-title-suggestions first.`,
    );
  }
  let entries = JSON.parse(fs.readFileSync(ROLE_TITLE_SUGGESTIONS_PATH, 'utf8'));
  if (!Array.isArray(entries)) entries = [];
  if (Number.isFinite(limit) && limit > 0) entries = entries.slice(0, limit);

  await connectDB();

  let applied = 0;
  let skipped = 0;
  let notFound = 0;

  for (const entry of entries) {
    const cpId = normalizeLabel(entry.career_path_id);
    const suggestedDe = normalizeLabel(entry.suggested_de);
    const suggestedAltTitles = normalizeList(entry.suggested_alt_titles_de);
    const suggestedHiddenTitles = normalizeList(entry.suggested_hidden_titles_de);
    if (!cpId) {
      skipped += 1;
      continue;
    }
    const hasTitleSuggestion = Boolean(suggestedDe && !isPlaceholderDe(suggestedDe));
    const hasAltSuggestion = suggestedAltTitles.length > 0;
    const hasHiddenSuggestion = suggestedHiddenTitles.length > 0;
    if (!hasTitleSuggestion && !hasAltSuggestion && !hasHiddenSuggestion) {
      skipped += 1;
      continue;
    }

    const doc = await CareerPath.findById(cpId).select('title altTitles hiddenTitles altTitlesDe hiddenTitlesDe').lean();
    if (!doc) {
      notFound += 1;
      continue;
    }
    const en = getEnglishTitle(doc.title);
    if (!en && hasTitleSuggestion) {
      skipped += 1;
      continue;
    }
    const currentDe =
      typeof doc.title === 'object' && doc.title != null && Object.prototype.hasOwnProperty.call(doc.title, 'de')
        ? doc.title.de
        : undefined;
    const curStr = currentDe == null || currentDe === '' ? '' : String(currentDe).trim();
    const currentAltTitlesDe = normalizeList(doc.altTitlesDe);
    const currentHiddenTitlesDe = normalizeList(doc.hiddenTitlesDe);

    const titleChanged = hasTitleSuggestion ? curStr !== suggestedDe : false;
    const altChanged = hasAltSuggestion ? !arraysEqual(currentAltTitlesDe, suggestedAltTitles) : false;
    const hiddenChanged = hasHiddenSuggestion ? !arraysEqual(currentHiddenTitlesDe, suggestedHiddenTitles) : false;

    if (!titleChanged && !altChanged && !hiddenChanged) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      applied += 1;
      continue;
    }

    const setPayload = {};
    if (titleChanged) setPayload.title = { en, de: suggestedDe };
    if (altChanged) setPayload.altTitlesDe = suggestedAltTitles;
    if (hiddenChanged) setPayload.hiddenTitlesDe = suggestedHiddenTitles;
    const result = await CareerPath.updateOne({ _id: cpId }, { $set: setPayload });
    if (result.matchedCount) {
      applied += 1;
    } else {
      notFound += 1;
    }
  }

  console.log(
    `[applyRoleTitleTranslations] dryRun=${dryRun} ${dryRun ? 'wouldApply' : 'applied'}=${applied} skipped=${skipped} notFound=${notFound} inputRows=${entries.length}`,
  );
  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[applyRoleTitleTranslations] failed:', err);
      mongoose.connection.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run, getEnglishTitle, isPlaceholderDe };
