#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const Skill = require('../src/server/models/Skill');
const CareerPathSkill = require('../src/server/models/CareerPathSkill');
const {
  normalizeSkillKey,
  toDisplayLabel,
  TYPE_REQUIRED,
  TYPE_OPTIONAL,
} = require('../src/server/services/careerPathSkillService');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.slice(2).split('=');
    out[k] = v == null ? true : v;
  }
  return out;
}

async function upsertSkill(key) {
  return Skill.findOneAndUpdate(
    { key },
    { $setOnInsert: { key } },
    { upsert: true, new: true }
  ).lean();
}

async function reconcileSkillIndexes() {
  const indexes = await Skill.collection.indexes();
  for (const idx of indexes) {
    const isLegacySkillIdUnique = idx && idx.unique === true && idx.key && idx.key.skill_id === 1;
    if (isLegacySkillIdUnique) {
      console.log(`[migrateSkills] dropping legacy index: ${idx.name}`);
      await Skill.collection.dropIndex(idx.name);
    }
  }
  // Legacy rows can exist from previous experiments (often with skill_id but no key).
  // They break the unique index build on key, so remove only malformed rows.
  const malformedFilter = {
    $or: [
      { key: null },
      { key: { $exists: false } },
      { key: '' },
    ],
  };
  const malformedCount = await Skill.collection.countDocuments(malformedFilter);
  if (malformedCount > 0) {
    console.log(`[migrateSkills] removing malformed legacy skill docs: ${malformedCount}`);
    await Skill.collection.deleteMany(malformedFilter);
  }
  const refreshedIndexes = await Skill.collection.indexes();
  const keyIndex = refreshedIndexes.find((idx) => idx && idx.key && idx.key.key === 1);
  if (keyIndex && keyIndex.unique === true) {
    // Already correct, regardless of index name.
    return;
  }
  if (keyIndex && keyIndex.unique !== true) {
    console.log(`[migrateSkills] rebuilding non-unique key index: ${keyIndex.name}`);
    await Skill.collection.dropIndex(keyIndex.name);
  }
  // Ensure normalized key is the canonical unique identifier.
  await Skill.collection.createIndex({ key: 1 }, { unique: true });
}

async function upsertEmbeddedEnglishLabel(skillId, rawLabel) {
  const label = toDisplayLabel(rawLabel);
  if (!label) return null;
  return Skill.updateOne(
    { _id: skillId, label: { $exists: false } },
    { $set: { label: { en: label, de: null } } }
  );
}

async function upsertCareerPathSkill(careerPathId, skillId, type, order_index) {
  return CareerPathSkill.updateOne(
    { careerPathId, skillId, type },
    { $set: { order_index } },
    { upsert: true }
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const dryRun = Boolean(args['dry-run']);

  await connectDB();
  await reconcileSkillIndexes();

  const query = CareerPath.find({}, { _id: 1, requiredSkills: 1, skillModel: 1 }).lean();
  if (Number.isFinite(limit) && limit > 0) query.limit(limit);
  const careerPaths = await query;

  let skillsCreated = 0;
  let linksCreatedOrUpdated = 0;
  let duplicateEntries = 0;
  const seenGlobalKeys = new Set();

  for (const cp of careerPaths) {
    const required = Array.isArray(cp.requiredSkills) ? cp.requiredSkills : [];
    const optional = Array.isArray(cp?.skillModel?.optional_skills) ? cp.skillModel.optional_skills : [];

    const processList = async (list, type) => {
      const localSeen = new Set();
      for (let index = 0; index < list.length; index += 1) {
        const raw = String(list[index] || '').trim();
        if (!raw) continue;

        const key = normalizeSkillKey(raw);
        if (!key) continue;
        if (localSeen.has(`${type}:${key}`)) {
          duplicateEntries += 1;
          continue;
        }
        localSeen.add(`${type}:${key}`);

        if (dryRun) continue;

        const existing = await Skill.findOne({ key }, { _id: 1 }).lean();
        let skillDoc = existing;
        if (!existing) {
          skillDoc = await upsertSkill(key);
          if (!seenGlobalKeys.has(key)) {
            skillsCreated += 1;
            seenGlobalKeys.add(key);
          }
        }

        await upsertEmbeddedEnglishLabel(skillDoc._id, raw);
        const linkResult = await upsertCareerPathSkill(cp._id, skillDoc._id, type, index);
        linksCreatedOrUpdated += (linkResult.upsertedCount || 0) + (linkResult.modifiedCount || 0);
      }
    };

    await processList(required, TYPE_REQUIRED);
    await processList(optional, TYPE_OPTIONAL);
  }

  console.log(`[migrateSkills] careerPaths=${careerPaths.length} dryRun=${dryRun}`);
  console.log(`[migrateSkills] skillsCreated=${skillsCreated}`);
  console.log(`[migrateSkills] linksCreatedOrUpdated=${linksCreatedOrUpdated}`);
  console.log(`[migrateSkills] duplicatesDetected=${duplicateEntries}`);
}

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[migrateSkills] failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  });
