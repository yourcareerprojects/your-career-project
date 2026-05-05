// importEscoSkillsAndRelations.js
// Script to import ESCO skills and occupation-skill relations into CareerPath collection

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
require('dotenv').config();

const SKILLS_CSV = path.join(__dirname, '../ESCO dataset - v1.2.0 - classification - en - csv/skills_en.csv');
const OCC_SKILL_REL_CSV = path.join(__dirname, '../ESCO dataset - v1.2.0 - classification - en - csv/occupationSkillRelations_en.csv');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

const CareerPath = require('../src/server/models/CareerPath');

function normalizeSkillKey(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function importSkillsAndRelations() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // 1. Parse all skills into a map: conceptUri -> preferredLabel
  const skillMap = {};
  await new Promise((resolve, reject) => {
    fs.createReadStream(SKILLS_CSV)
      .pipe(csv())
      .on('data', (row) => {
        skillMap[row['conceptUri']] = row['preferredLabel'];
      })
      .on('end', resolve)
      .on('error', reject);
  });
  console.log(`Parsed ${Object.keys(skillMap).length} skills.`);

  // 2. Parse occupation-skill relations: occupationUri -> [skillUri, ...]
  const occSkillMap = {};
  await new Promise((resolve, reject) => {
    fs.createReadStream(OCC_SKILL_REL_CSV)
      .pipe(csv())
      .on('data', (row) => {
        const occUri = row['occupationUri'];
        const relationType = row['relationType'];
        const skillUri = row['skillUri'];
        // Keep dataset tight: only import "essential" skills as required skills.
        if (relationType && String(relationType).toLowerCase() !== 'essential') return;
        if (!occSkillMap[occUri]) occSkillMap[occUri] = [];
        occSkillMap[occUri].push(skillUri);
      })
      .on('end', resolve)
      .on('error', reject);
  });
  console.log(`Parsed occupation-skill relations for ${Object.keys(occSkillMap).length} occupations.`);

  // 3. Update CareerPath documents with requiredSkills (titles) + requiredSkillUris (URIs)
  let updated = 0;
  for (const [occUri, skillUris] of Object.entries(occSkillMap)) {
    const dedupedSkillUris = Array.from(new Set(skillUris.filter(Boolean)));
    const skillTitles = dedupedSkillUris
      .map(uri => skillMap[uri])
      .filter(Boolean);
    const requiredSkillKeys = Array.from(
      new Set(skillTitles.map(normalizeSkillKey).filter(Boolean))
    );

    await CareerPath.findOneAndUpdate(
      { escoId: occUri },
      {
        $set: {
          requiredSkillUris: dedupedSkillUris,
          requiredSkills: Array.from(new Set(skillTitles)),
          requiredSkillKeys,
          importedFrom: 'csv',
          lastUpdated: new Date(),
        }
      }
    );
    updated++;
    if (updated % 500 === 0) console.log(`Updated ${updated} occupations with skills...`);
  }
  console.log(`Updated requiredSkills for ${updated} occupations.`);

  await mongoose.disconnect();
  process.exit(0);
}

importSkillsAndRelations(); 