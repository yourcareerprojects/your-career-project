#!/usr/bin/env node
/**
 * Applies `tmp/role_responsibility_suggestions.json` to career paths:
 * sets `keyResponsibilitiesDe` with the translated responsibilities list.
 */
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const { ROLE_RESPONSIBILITY_SUGGESTIONS_PATH, normalizeLabel, parseArgs } = require('./lib/skillTranslationPipeline');

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => normalizeLabel(item)).filter(Boolean);
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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

  if (!fs.existsSync(ROLE_RESPONSIBILITY_SUGGESTIONS_PATH)) {
    throw new Error(
      `Missing input file: ${ROLE_RESPONSIBILITY_SUGGESTIONS_PATH}. Run responsibilities:generate-suggestions first.`
    );
  }
  let entries = JSON.parse(fs.readFileSync(ROLE_RESPONSIBILITY_SUGGESTIONS_PATH, 'utf8'));
  if (!Array.isArray(entries)) entries = [];
  if (Number.isFinite(limit) && limit > 0) entries = entries.slice(0, limit);

  await connectDB();

  let applied = 0;
  let skipped = 0;
  let notFound = 0;

  for (const entry of entries) {
    const cpId = normalizeLabel(entry.career_path_id);
    const suggested = normalizeList(entry.suggested_responsibilities_de);
    const sourceEn = normalizeList(entry.responsibilities_en);
    if (!cpId || suggested.length === 0) {
      skipped += 1;
      continue;
    }
    if (suggested.length !== sourceEn.length) {
      skipped += 1;
      continue;
    }
    if (!suggested.every((item) => !isPlaceholderDe(item))) {
      skipped += 1;
      continue;
    }

    const doc = await CareerPath.findById(cpId).select('keyResponsibilities keyResponsibilitiesDe').lean();
    if (!doc) {
      notFound += 1;
      continue;
    }
    const currentEn = normalizeList(doc?.keyResponsibilities?.responsibilities);
    if (currentEn.length === 0 || currentEn.length !== suggested.length) {
      skipped += 1;
      continue;
    }
    const currentDe = normalizeList(doc.keyResponsibilitiesDe);
    if (arraysEqual(currentDe, suggested)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      applied += 1;
      continue;
    }

    const result = await CareerPath.updateOne(
      { _id: cpId },
      { $set: { keyResponsibilitiesDe: suggested } }
    );
    if (result.matchedCount) {
      applied += 1;
    } else {
      notFound += 1;
    }
  }

  console.log(
    `[applyRoleResponsibilityTranslations] dryRun=${dryRun} ${dryRun ? 'wouldApply' : 'applied'}=${applied} skipped=${skipped} notFound=${notFound} inputRows=${entries.length}`
  );
  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[applyRoleResponsibilityTranslations] failed:', err);
      mongoose.connection.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run };
