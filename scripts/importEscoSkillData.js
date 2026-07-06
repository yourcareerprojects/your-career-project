#!/usr/bin/env node
/**
 * Import ESCO skill concepts and occupation–skill relations from the local CSV bundle
 * into MongoDB (`EscoSkill`, `EscoOccupationSkillRelation`).
 *
 * Run once per environment (or after ESCO releases a new classification export).
 * After import, the app no longer needs `skills_en.csv` or `occupationSkillRelations_en.csv` at runtime.
 *
 * Usage:
 *   node scripts/importEscoSkillData.js [--data-dir=path] [--batch-size=1000] [--dry-run]
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const EscoSkill = require('../src/server/models/EscoSkill');
const EscoOccupationSkillRelation = require('../src/server/models/EscoOccupationSkillRelation');
const { canonicalEscoUri } = require('../src/server/services/escoSkillLookupService');

const DEFAULT_DATA_DIR = path.join(
  process.cwd(),
  'ESCO dataset - v1.2.0 - classification - en - csv',
);

function parseArgs(argv) {
  const out = { dryRun: false, batchSize: 1000, dataDir: DEFAULT_DATA_DIR };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--batch-size=')) {
      const n = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) out.batchSize = n;
    } else if (arg.startsWith('--data-dir=')) {
      out.dataDir = path.resolve(arg.split('=').slice(1).join('='));
    }
  }
  return out;
}

function normalizeSkillTitle(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ');
}

async function readCsvRows(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  const rows = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', resolve)
      .on('error', reject);
  });
  return rows;
}

async function flushBulk(model, ops, dryRun) {
  if (!ops.length || dryRun) return 0;
  await model.bulkWrite(ops, { ordered: false });
  return ops.length;
}

async function importSkills(dataDir, { batchSize, dryRun }) {
  const skillsPath = path.join(dataDir, 'skills_en.csv');
  const rows = await readCsvRows(skillsPath);
  let pending = [];
  let imported = 0;

  for (const row of rows) {
    const uri = canonicalEscoUri(row.conceptUri);
    const title = normalizeSkillTitle(row.preferredLabel);
    if (!uri || !title) continue;

    pending.push({
      updateOne: {
        filter: { uri },
        update: {
          $set: {
            uri,
            label: { en: title, de: null },
            skillType: String(row.skillType || '').trim() || null,
          },
        },
        upsert: true,
      },
    });

    if (pending.length >= batchSize) {
      imported += await flushBulk(EscoSkill, pending, dryRun);
      pending = [];
    }
  }

  imported += await flushBulk(EscoSkill, pending, dryRun);
  return imported;
}

async function importOccupationSkillRelations(dataDir, { batchSize, dryRun }) {
  const relPath = path.join(dataDir, 'occupationSkillRelations_en.csv');
  const rows = await readCsvRows(relPath);
  let pending = [];
  let imported = 0;

  for (const row of rows) {
    const occupationUri = canonicalEscoUri(row.occupationUri);
    const skillUri = canonicalEscoUri(row.skillUri);
    const relationType = String(row.relationType || '').trim().toLowerCase();
    if (!occupationUri || !skillUri) continue;
    if (relationType !== 'essential' && relationType !== 'optional') continue;

    pending.push({
      updateOne: {
        filter: { occupationUri, skillUri },
        update: {
          $set: {
            occupationUri,
            skillUri,
            relationType,
            skillType: String(row.skillType || '').trim() || null,
          },
        },
        upsert: true,
      },
    });

    if (pending.length >= batchSize) {
      imported += await flushBulk(EscoOccupationSkillRelation, pending, dryRun);
      pending = [];
    }
  }

  imported += await flushBulk(EscoOccupationSkillRelation, pending, dryRun);
  return imported;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  console.log('=== Import ESCO skill data to MongoDB ===');
  console.log(`  Data dir:   ${flags.dataDir}`);
  console.log(`  Batch size: ${flags.batchSize}`);
  console.log(`  Dry run:    ${flags.dryRun}`);
  console.log('');

  await connectDB();

  console.log('Importing skills...');
  const skillCount = await importSkills(flags.dataDir, flags);
  console.log(`  Skills upserted: ${skillCount}`);

  console.log('Importing occupation–skill relations...');
  const relationCount = await importOccupationSkillRelations(flags.dataDir, flags);
  console.log(`  Relations upserted: ${relationCount}`);

  const totalSkills = await EscoSkill.countDocuments();
  const totalRelations = await EscoOccupationSkillRelation.countDocuments();
  console.log('');
  console.log(`Collection totals: EscoSkill=${totalSkills}, EscoOccupationSkillRelation=${totalRelations}`);

  if (flags.dryRun) {
    console.log('\n(Dry run — no writes were performed)');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
