#!/usr/bin/env node
/**
 * Upsert CareerPath documents from a JSON file (additive — does not replace the collection).
 *
 * Accepts:
 *   - { "roles": [ ... ] }
 *   - [ ... ]  (bare array)
 *
 * Usage:
 *   node scripts/upsertRolesFromJson.js [--file=new_roles.json] [--dry-run]
 *
 * Each role must have a unique `escoId`.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const CareerPath = require('../src/server/models/CareerPath');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
const DEFAULT_FILE = path.join(__dirname, '..', 'new_roles.json');

const CAREER_PATH_FIELDS = new Set([
  'escoId',
  'code',
  'iscoGroup',
  'title',
  'altTitles',
  'hiddenTitles',
  'altTitlesDe',
  'hiddenTitlesDe',
  'description',
  'requiredSkills',
  'requiredSkillUris',
  'requiredSkillKeys',
  'skillModel',
  'seniority',
  'keyResponsibilities',
  'keyResponsibilitiesDe',
  'skillDomains',
  'roleIdentity',
  'roleVectors',
  'source',
  'sourceVersion',
  'importedFrom',
  'lastUpdated',
  'mergedFromEscoIds',
]);

function parseArgs() {
  const out = { file: DEFAULT_FILE, dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--file=')) out.file = path.resolve(arg.slice('--file='.length));
  }
  return out;
}

function loadRoles(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.roles)) return data.roles;
  throw new Error('JSON must be an array or an object with a "roles" array');
}

function normalizeRequiredSkillKeys(requiredSkills, existingKeys) {
  if (Array.isArray(existingKeys) && existingKeys.length > 0) {
    return existingKeys;
  }
  if (!Array.isArray(requiredSkills)) return [];
  return requiredSkills
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().toLowerCase());
}

function toCareerPathDoc(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Each role must be a JSON object');
  }
  const escoId = raw.escoId || raw.id || raw.esco_id;
  if (!escoId || !String(escoId).trim()) {
    throw new Error('Each role must have escoId (or id / esco_id)');
  }

  const now = new Date();
  const doc = {};

  for (const key of CAREER_PATH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      doc[key] = raw[key];
    }
  }

  doc.escoId = String(escoId).trim();
  doc.lastUpdated = now;

  if (doc.code === null || doc.code === '') delete doc.code;

  doc.requiredSkillKeys = normalizeRequiredSkillKeys(doc.requiredSkills, doc.requiredSkillKeys);

  if (doc.keyResponsibilities && typeof doc.keyResponsibilities === 'object') {
    doc.keyResponsibilities = {
      ...doc.keyResponsibilities,
      built_at: doc.keyResponsibilities.built_at || now,
      built_with: doc.keyResponsibilities.built_with || 'manual',
    };
  }

  if (!doc.source) doc.source = 'manual';
  if (!doc.importedFrom) doc.importedFrom = 'json';

  return doc;
}

async function main() {
  const flags = parseArgs();

  console.log('=== Upsert Roles From JSON ===');
  console.log(`  File:    ${flags.file}`);
  console.log(`  MongoDB: ${MONGODB_URI}`);
  console.log(`  Dry run: ${flags.dryRun}`);
  console.log('');

  const rawRoles = loadRoles(flags.file);
  console.log(`Loaded ${rawRoles.length} role(s) from JSON`);

  const docs = rawRoles.map((role, index) => {
    try {
      return toCareerPathDoc(role);
    } catch (err) {
      throw new Error(`Role at index ${index}: ${err.message}`);
    }
  });

  if (flags.dryRun) {
    console.log('\nDry run — would upsert:');
    for (const doc of docs) {
      console.log(`  - ${doc.escoId}: ${doc.title?.en || doc.title}`);
    }
    return;
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  let upserted = 0;
  let errors = 0;

  for (const doc of docs) {
    try {
      await CareerPath.updateOne({ escoId: doc.escoId }, { $set: doc }, { upsert: true });
      upserted += 1;
      console.log(`Upserted: ${doc.escoId}`);
    } catch (err) {
      errors += 1;
      console.error(`Failed: ${doc.escoId} — ${err.message}`);
    }
  }

  console.log(`\nDone. upserted=${upserted} errors=${errors}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
