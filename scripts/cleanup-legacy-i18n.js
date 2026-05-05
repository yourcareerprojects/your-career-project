#!/usr/bin/env node
/**
 * Convert legacy string title/description/label fields to { en, de: null }.
 * For skills, also backfills `label` when missing/null/invalid using a display string
 * derived from `key` (same idea as careerPathSkillService / migrateSkills).
 * Run after migrate-to-embedded-i18n and before strict runtime validation.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { isValidLocalized } = require('./check-i18n-integrity');
const { toDisplayLabel } = require('../src/server/services/careerPathSkillService');

function displayLabelFromSkillKey(key) {
  const raw = String(key || '').replace(/_/g, ' ').trim();
  const titled = toDisplayLabel(raw);
  return titled || String(key || 'skill');
}

const COLLECTIONS = {
  careerpaths: 'careerpaths',
  skills: 'skills',
  users: 'users',
};

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  const log = console;
  const affected = { careerpaths: [], skills: [], users: [] };

  const cp = await db.collection(COLLECTIONS.careerpaths).find({}).toArray();
  for (const doc of cp) {
    const $set = {};
    if (typeof doc.title === 'string') {
      $set.title = { en: doc.title, de: null };
    }
    if (doc.description != null && typeof doc.description === 'string') {
      $set.description = { en: doc.description, de: null };
    }
    if (doc.skillDomains?.skill_domains) {
      const sds = doc.skillDomains.skill_domains.map((d) => {
        if (d == null) return d;
        if (typeof d.domain === 'string') {
          return { ...d, domain: { en: d.domain, de: null } };
        }
        return d;
      });
      if (JSON.stringify(sds) !== JSON.stringify(doc.skillDomains.skill_domains)) {
        $set['skillDomains.skill_domains'] = sds;
      }
    }
    if (Object.keys($set).length > 0) {
      await db.collection(COLLECTIONS.careerpaths).updateOne({ _id: doc._id }, { $set });
      affected.careerpaths.push(String(doc._id));
    }
  }

  const sk = await db.collection(COLLECTIONS.skills).find({}).toArray();
  for (const doc of sk) {
    if (isValidLocalized(doc.label) == null) {
      continue;
    }

    let de = null;
    if (doc.label && typeof doc.label === 'object' && !Array.isArray(doc.label) && typeof doc.label.de === 'string') {
      de = doc.label.de;
    }

    let en;
    if (typeof doc.label === 'string') {
      en = doc.label.trim() || displayLabelFromSkillKey(doc.key);
    } else {
      en = displayLabelFromSkillKey(doc.key);
    }

    await db.collection(COLLECTIONS.skills).updateOne(
      { _id: doc._id },
      { $set: { label: { en, de } } }
    );
    affected.skills.push(String(doc._id));
  }

  const users = await db.collection(COLLECTIONS.users).find({ savedCareerSteps: { $exists: true, $ne: [] } }).toArray();
  for (const u of users) {
    if (!Array.isArray(u.savedCareerSteps) || u.savedCareerSteps.length === 0) continue;
    const next = u.savedCareerSteps.map((s) => {
      if (!s || typeof s !== 'object') return s;
      const t = typeof s.title === 'string' ? { en: s.title, de: null } : s.title;
      const d =
        s.description == null
          ? s.description
          : typeof s.description === 'string'
            ? { en: s.description, de: null }
            : s.description;
      return { ...s, title: t, description: d };
    });
    if (JSON.stringify(next) !== JSON.stringify(u.savedCareerSteps)) {
      await db.collection(COLLECTIONS.users).updateOne({ _id: u._id }, { $set: { savedCareerSteps: next } });
      affected.users.push(String(u._id));
    }
  }

  log.log(`[cleanup-legacy-i18n] careerpaths=${affected.careerpaths.length} ${JSON.stringify(affected.careerpaths.slice(0, 20))}`);
  log.log(`[cleanup-legacy-i18n] skills=${affected.skills.length} ${JSON.stringify(affected.skills.slice(0, 20))}`);
  log.log(`[cleanup-legacy-i18n] users=${affected.users.length} ${JSON.stringify(affected.users.slice(0, 20))}`);

  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[cleanup-legacy-i18n]', err);
      mongoose.connection.close().catch(() => {}).then(() => process.exit(1));
    });
}

module.exports = { run };
