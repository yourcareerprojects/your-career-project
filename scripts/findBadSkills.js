#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Skill = require('../src/server/models/Skill');
const {
  BAD_SKILLS_PATH,
  ensureTmpDir,
  isBadTranslation,
  normalizeLabel,
  parseArgs,
} = require('./lib/skillTranslationPipeline');

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.parseInt(String(args.limit || '0'), 10);

  await connectDB();

  const skillQuery = Skill.find({}, { _id: 1, key: 1, label: 1 }).lean();
  if (Number.isFinite(limit) && limit > 0) skillQuery.limit(limit);
  const skills = await skillQuery;

  const bad = [];
  for (const skill of skills) {
    const id = String(skill._id);
    const l = skill.label;
    let en = '';
    let de = '';
    if (l && typeof l === 'object' && !Array.isArray(l)) {
      en = normalizeLabel(l.en);
      de = normalizeLabel(l.de);
    }
    if (isBadTranslation(en, de)) {
      bad.push({
        skill_id: id,
        key: skill.key,
        en,
        de,
      });
    }
  }

  ensureTmpDir();
  fs.writeFileSync(BAD_SKILLS_PATH, JSON.stringify(bad, null, 2), 'utf8');

  console.log(`[findBadSkills] totalSkills=${skills.length}`);
  console.log(`[findBadSkills] badSkills=${bad.length}`);
  console.log(`[findBadSkills] output=${BAD_SKILLS_PATH}`);
}

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[findBadSkills] failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  });
