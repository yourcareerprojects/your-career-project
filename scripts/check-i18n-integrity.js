#!/usr/bin/env node
/**
 * Strict validation: every localized field must be { en: string, de?: string|null }.
 * Exits with code 1 if any invalid document is found.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const Skill = require('../src/server/models/Skill');

function isValidLocalized(val) {
  if (val == null) return 'null';
  if (typeof val === 'string') return 'legacy_string';
  if (typeof val !== 'object' || Array.isArray(val)) return 'not_object';
  if (!Object.prototype.hasOwnProperty.call(val, 'en')) return 'missing_en_key';
  if (val.en == null || typeof val.en !== 'string') return 'invalid_en';
  if (val.de != null && typeof val.de !== 'string') return 'invalid_de_type';
  return null;
}

function isValidDescription(val) {
  if (val == null) return null;
  return isValidLocalized(val);
}

async function run() {
  const log = console;
  await connectDB();
  const errors = [];
  let cp = 0;
  let sk = 0;

  const cpCursor = CareerPath.find({}).lean().cursor();
  for await (const doc of cpCursor) {
    cp += 1;
    const badT = isValidLocalized(doc?.title);
    if (badT) errors.push({ collection: 'careerpaths', id: String(doc._id), field: 'title', code: badT });
    const badD = isValidDescription(doc?.description);
    if (badD) errors.push({ collection: 'careerpaths', id: String(doc._id), field: 'description', code: badD });
    const sds = doc?.skillDomains?.skill_domains;
    if (Array.isArray(sds)) {
      sds.forEach((row, i) => {
        const bad = isValidLocalized(row?.domain);
        if (bad) {
          errors.push({ collection: 'careerpaths', id: String(doc._id), field: `skillDomains[${i}].domain`, code: bad });
        }
      });
    }
  }

  const skCur = Skill.find({}).lean().cursor();
  for await (const doc of skCur) {
    sk += 1;
    const bad = isValidLocalized(doc?.label);
    if (bad) errors.push({ collection: 'skills', id: String(doc._id), key: doc.key, field: 'label', code: bad });
  }

  log.log(`[check-i18n-integrity] scanned careerpaths=${cp} skills=${sk} errors=${errors.length}`);
  if (errors.length) {
    log.error(`[check-i18n-integrity] FAIL sample=${JSON.stringify(errors.slice(0, 40), null, 0)}`);
    await mongoose.connection.close();
    process.exit(1);
  }
  log.log('[check-i18n-integrity] OK');
  await mongoose.connection.close();
  process.exit(0);
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[check-i18n-integrity] failed:', err);
    mongoose.connection.close().catch(() => {}).then(() => process.exit(1));
  });
}

module.exports = { run, isValidLocalized };
