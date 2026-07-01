#!/usr/bin/env node
/**
 * Harmonize skills by German label (fallback: English):
 * - merge alias Skill documents into canonical keys
 * - repoint CareerPathSkill links
 * - rewrite CareerPath.requiredSkillKeys / legacy skill string lists
 * - harmonize user profile structured skill name lists
 *
 * Usage:
 *   node scripts/harmonizeSkills.js [--dry] [--limit=N] [--skip-users]
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const Skill = require('../src/server/models/Skill');
const CareerPathSkill = require('../src/server/models/CareerPathSkill');
const User = require('../src/server/models/User');
const { normalizeSkillKey } = require('../src/server/services/careerPathSkillService');
const {
  buildSkillHarmonizationPlan,
  buildSkillLabelAliasMaps,
  harmonizeSkillNameList,
  mergeCanonicalSkillLabel,
  coerceSkillLabelToI18n,
  uniqStrings,
} = require('../src/server/utils/skillHarmonization');
const { parseArgs, ensureTmpDir, TMP_DIR } = require('./lib/skillTranslationPipeline');

const HARMONIZATION_MAP_PATH = path.join(TMP_DIR, 'skill_harmonization_map.json');

function asStringItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  if (typeof value === 'object' && Array.isArray(value.raw_items)) {
    return value.raw_items.map((v) => String(v || '').trim()).filter(Boolean);
  }
  return [];
}

function remapKeyList(keys = [], keyAliasMap = new Map()) {
  const out = [];
  const seen = new Set();
  for (const raw of keys) {
    const key = normalizeSkillKey(raw);
    if (!key) continue;
    const canonical = keyAliasMap.get(key) || key;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return { next: out, changed: out.length !== keys.length || out.some((k, i) => k !== keys[i]) };
}

function remapLegacySkillStrings(list = [], labelAliasMaps = { en: new Map(), de: new Map() }) {
  const next = harmonizeSkillNameList(list, labelAliasMaps);
  const changed = next.length !== list.length
    || next.some((item, idx) => item !== String(list[idx] || '').trim());
  return { next, changed };
}

async function repointCareerPathSkillLinks(keyAliasMap, keyToId, dryRun) {
  let linksRepointed = 0;
  let linksDeleted = 0;

  for (const [aliasKey, canonicalKey] of keyAliasMap.entries()) {
    if (aliasKey === canonicalKey) continue;
    const aliasId = keyToId.get(aliasKey);
    const canonicalId = keyToId.get(canonicalKey);
    if (!aliasId || !canonicalId) continue;

    const aliasLinks = await CareerPathSkill.find({ skillId: aliasId }).lean();
    for (const link of aliasLinks) {
      const conflict = await CareerPathSkill.findOne({
        careerPathId: link.careerPathId,
        skillId: canonicalId,
        type: link.type,
      }).lean();

      if (conflict && String(conflict._id) !== String(link._id)) {
        if (!dryRun) await CareerPathSkill.deleteOne({ _id: link._id });
        linksDeleted += 1;
      } else if (!dryRun) {
        await CareerPathSkill.updateOne({ _id: link._id }, { $set: { skillId: canonicalId } });
        linksRepointed += 1;
      } else {
        linksRepointed += 1;
      }
    }
  }

  return { linksRepointed, linksDeleted };
}

async function harmonizeCareerPaths(keyAliasMap, labelAliasMaps, dryRun, limit) {
  let scanned = 0;
  let updated = 0;
  const cursor = CareerPath.find(
    {},
    { requiredSkillKeys: 1, requiredSkills: 1, skillModel: 1 },
  ).lean().cursor();

  for await (const doc of cursor) {
    if (Number.isFinite(limit) && limit > 0 && scanned >= limit) break;
    scanned += 1;

    const set = {};
    const keyResult = remapKeyList(doc.requiredSkillKeys || [], keyAliasMap);
    if (keyResult.changed) set.requiredSkillKeys = keyResult.next;

    const reqResult = remapLegacySkillStrings(doc.requiredSkills || [], labelAliasMaps);
    if (reqResult.changed) set.requiredSkills = reqResult.next;

    const optional = Array.isArray(doc.skillModel?.optional_skills) ? doc.skillModel.optional_skills : [];
    const optResult = remapLegacySkillStrings(optional, labelAliasMaps);
    if (optResult.changed) {
      set['skillModel.optional_skills'] = optResult.next;
    }

    const core = Array.isArray(doc.skillModel?.core_skills) ? doc.skillModel.core_skills : [];
    const coreResult = remapLegacySkillStrings(core, labelAliasMaps);
    if (coreResult.changed) {
      set['skillModel.core_skills'] = coreResult.next;
    }

    if (Object.keys(set).length === 0) continue;
    updated += 1;
    if (!dryRun) {
      await CareerPath.collection.updateOne({ _id: doc._id }, { $set: set });
    }
  }

  return { scanned, updated };
}

async function harmonizeUserProfiles(labelAliasMaps, dryRun, limit) {
  let scanned = 0;
  let updated = 0;
  const cursor = User.find(
    {},
    {
      'profile.structuredUserInfo.skills': 1,
      'profile.careerSimulationInputs.structuredUserInfo.skills': 1,
    },
  ).lean().cursor();

  for await (const user of cursor) {
    if (Number.isFinite(limit) && limit > 0 && scanned >= limit) break;
    scanned += 1;
    const profile = user.profile || {};
    const set = {};

    const structuredSkills = asStringItems(profile.structuredUserInfo?.skills);
    const structuredNext = harmonizeSkillNameList(structuredSkills, labelAliasMaps);
    if (structuredNext.length !== structuredSkills.length
      || structuredNext.some((item, idx) => item !== structuredSkills[idx])) {
      set['profile.structuredUserInfo.skills'] = structuredNext;
    }

    const csiSkills = asStringItems(profile.careerSimulationInputs?.structuredUserInfo?.skills);
    const csiNext = harmonizeSkillNameList(csiSkills, labelAliasMaps);
    if (csiNext.length !== csiSkills.length
      || csiNext.some((item, idx) => item !== csiSkills[idx])) {
      set['profile.careerSimulationInputs.structuredUserInfo.skills'] = csiNext;
    }

    if (Object.keys(set).length === 0) continue;
    updated += 1;
    if (!dryRun) {
      await User.collection.updateOne({ _id: user._id }, { $set: set });
    }
  }

  return { scanned, updated };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args.dry);
  const limit = Number.parseInt(String(args.limit || '0'), 10);
  const skipUsers = Boolean(args['skip-users']);

  await connectDB();

  const skills = await Skill.find({}, { key: 1, label: 1 }).lean();
  const links = await CareerPathSkill.find({}, { skillId: 1 }).lean();
  const skillById = new Map(skills.map((skill) => [String(skill._id), skill]));

  const keyCounts = new Map();
  for (const link of links) {
    const key = skillById.get(String(link.skillId))?.key;
    if (!key) continue;
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }

  const { keyAliasMap } = buildSkillHarmonizationPlan(skills, keyCounts);
  const labelAliasMaps = buildSkillLabelAliasMaps(skills, keyAliasMap);
  const keyToId = new Map(skills.map((skill) => [skill.key, skill._id]));

  const aliasEntries = [...keyAliasMap.entries()]
    .filter(([alias, canonical]) => alias !== canonical)
    .map(([alias, canonical]) => ({ alias, canonical }))
    .sort((a, b) => a.alias.localeCompare(b.alias));

  ensureTmpDir();
  fs.writeFileSync(
    HARMONIZATION_MAP_PATH,
    JSON.stringify({ aliasCount: aliasEntries.length, aliases: aliasEntries }, null, 2),
    'utf8',
  );

  const { linksRepointed, linksDeleted } = await repointCareerPathSkillLinks(
    keyAliasMap,
    keyToId,
    dryRun,
  );

  const aliasesByCanonical = new Map();
  for (const [aliasKey, canonicalKey] of keyAliasMap.entries()) {
    if (aliasKey === canonicalKey) continue;
    if (!aliasesByCanonical.has(canonicalKey)) aliasesByCanonical.set(canonicalKey, []);
    aliasesByCanonical.get(canonicalKey).push(aliasKey);
  }

  let skillsUpdated = 0;
  let skillsDeleted = 0;
  for (const [canonicalKey, aliasKeys] of aliasesByCanonical.entries()) {
    const canonicalDoc = skills.find((skill) => skill.key === canonicalKey);
    if (!canonicalDoc) continue;
    const aliasDocs = aliasKeys
      .map((aliasKey) => skills.find((skill) => skill.key === aliasKey))
      .filter(Boolean);
    const mergedLabel = mergeCanonicalSkillLabel(
      canonicalDoc.label,
      aliasDocs.map((doc) => doc.label),
    );
    const current = coerceSkillLabelToI18n(canonicalDoc.label);
    const labelChanged = current?.en !== mergedLabel.en || (current?.de || null) !== (mergedLabel.de || null);
    if (labelChanged && !dryRun) {
      await Skill.updateOne({ _id: canonicalDoc._id }, { $set: { label: mergedLabel } });
      skillsUpdated += 1;
    } else if (labelChanged) {
      skillsUpdated += 1;
    }

    for (const aliasDoc of aliasDocs) {
      if (!dryRun) await Skill.deleteOne({ _id: aliasDoc._id });
      skillsDeleted += 1;
      keyToId.delete(aliasDoc.key);
    }
  }

  const careerPathStats = await harmonizeCareerPaths(keyAliasMap, labelAliasMaps, dryRun, limit);
  const userStats = skipUsers
    ? { scanned: 0, updated: 0 }
    : await harmonizeUserProfiles(labelAliasMaps, dryRun, limit);

  console.log(
    `[harmonizeSkills] dryRun=${dryRun} aliasCount=${aliasEntries.length} `
    + `linksRepointed=${linksRepointed} linksDeleted=${linksDeleted} `
    + `skillsUpdated=${skillsUpdated} skillsDeleted=${skillsDeleted} `
    + `careerPathsUpdated=${careerPathStats.updated}/${careerPathStats.scanned} `
    + `usersUpdated=${userStats.updated}/${userStats.scanned} map=${HARMONIZATION_MAP_PATH}`,
  );

  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[harmonizeSkills] failed:', err);
      mongoose.connection.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run };
