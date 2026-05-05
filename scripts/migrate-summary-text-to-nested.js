#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');

const USER_COLLECTION = 'users';
const BATCH_SIZE = 500;

const SUMMARY_PATHS = [
  'profile.who_are_you.summary_text',
  'profile.structuredUserInfo.skillDomains.summary_text',
  'profile.structuredUserInfo.skills.summary_text',
  'profile.structuredUserInfo.skillsInDevelopment.summary_text',
  'profile.structuredUserInfo.keyResponsibilities.summary_text',
  'profile.structuredUserInfo.domains.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.skillDomains.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.skills.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.skillsInDevelopment.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.keyResponsibilities.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.domains.summary_text',
];

function parseArgs(argv = process.argv.slice(2)) {
  const set = new Set(argv);
  return {
    dryRun: !set.has('--apply'),
    confirm: set.has('--confirm'),
  };
}

function getAtPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function toCode(lang, fallback = 'en') {
  return String(lang || fallback).toLowerCase().split('-')[0] || fallback;
}

function isObj(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function toNested(value) {
  if (value == null) return null;

  if (typeof value === 'string') {
    const text = value.trim();
    return {
      original_language: 'en',
      original: text || null,
      translations: text ? { en: text } : {},
    };
  }

  if (!isObj(value)) return null;

  const looksNested = isObj(value.translations)
    || Object.prototype.hasOwnProperty.call(value, 'original')
    || Object.prototype.hasOwnProperty.call(value, 'original_language');

  if (looksNested) {
    const originalLanguage = toCode(value.original_language || 'en', 'en');
    const translations = {};
    if (isObj(value.translations)) {
      for (const [lang, text] of Object.entries(value.translations)) {
        const clean = String(text || '').trim();
        if (!clean) continue;
        translations[toCode(lang, originalLanguage)] = clean;
      }
    }
    const original = String(value.original || '').trim();
    if (original && !translations[originalLanguage]) {
      translations[originalLanguage] = original;
    }
    return {
      original_language: originalLanguage,
      original: original || translations[originalLanguage] || null,
      translations,
    };
  }

  const en = String(value.en || '').trim();
  const de = String(value.de || '').trim();
  const translations = {};
  if (en) translations.en = en;
  if (de) translations.de = de;
  return {
    original_language: 'en',
    original: en || de || null,
    translations,
  };
}

function equalJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function run() {
  const args = parseArgs();
  if (!args.dryRun && !args.confirm) {
    console.error('[migrate-summary-text-to-nested] Refusing to run without --confirm');
    console.error('[migrate-summary-text-to-nested] Use --apply --confirm to write changes.');
    process.exitCode = 1;
    return;
  }

  await connectDB();
  const col = mongoose.connection.db.collection(USER_COLLECTION);

  let scanned = 0;
  let touchedDocs = 0;
  let touchedFields = 0;
  let queued = [];

  const cursor = col.find({}, { projection: { _id: 1, profile: 1 } });
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;
    const $set = {};
    let changed = 0;
    for (const path of SUMMARY_PATHS) {
      const current = getAtPath(doc, path);
      if (current == null) continue;
      const nested = toNested(current);
      if (!nested) continue;
      if (!equalJson(current, nested)) {
        $set[path] = nested;
        changed += 1;
      }
    }
    if (changed > 0) {
      touchedDocs += 1;
      touchedFields += changed;
      if (!args.dryRun) {
        queued.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set },
          },
        });
        if (queued.length >= BATCH_SIZE) {
          await col.bulkWrite(queued, { ordered: false });
          queued = [];
        }
      }
    }
  }

  if (!args.dryRun && queued.length > 0) {
    await col.bulkWrite(queued, { ordered: false });
  }

  console.log(`[migrate-summary-text-to-nested] scanned_documents=${scanned}`);
  console.log(`[migrate-summary-text-to-nested] touched_documents=${touchedDocs}`);
  console.log(`[migrate-summary-text-to-nested] touched_fields=${touchedFields}`);
  console.log(`[migrate-summary-text-to-nested] mode=${args.dryRun ? 'dry-run' : 'apply'}`);
}

run()
  .catch((err) => {
    console.error('[migrate-summary-text-to-nested] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch (_) {
      // noop
    }
  });

