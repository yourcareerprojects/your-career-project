'use strict';

/**
 * Resolve free-form user profile skills (DE/EN) to CareerPath.requiredSkillKeys
 * and linked career paths via the Skill + CareerPathSkill collections.
 */

const mongoose = require('mongoose');
const Skill = require('../../models/Skill');
const CareerPath = require('../../models/CareerPath');
const CareerPathSkill = require('../../models/CareerPathSkill');
const { normalizeSkillKey: normalizePoolSkillKey } = require('../escoService');

const MIN_TOKEN_LEN = 4;
const MAX_PARTIAL_SKILL_MATCHES = 5;
const MAX_EXPANDED_KEYS_PER_SKILL = 40;
const MIN_SINGLE_TOKEN_SUBSTRING_LEN = 8;

/** @type {Promise<object>|null} */
let indexPromise = null;
/** @type {object|null} */
let indexCache = null;

function normalizeLabelForLookup(text) {
  return normalizePoolSkillKey(text);
}

function skillKeyToPoolPhrase(skillKey) {
  return String(skillKey || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeLabelForLookup(text)
    .split(' ')
    .filter((t) => t.length >= MIN_TOKEN_LEN);
}

function keysContainingAllWords(idx, words) {
  if (!words.length) return [];
  const lists = words.map((w) => idx.requiredKeysByToken.get(w) || []);
  if (lists.some((l) => l.length === 0)) return [];

  lists.sort((a, b) => a.length - b.length);
  const out = [];
  for (const key of lists[0]) {
    if (words.every((w) => key.includes(w))) {
      out.push(key);
      if (out.length >= MAX_EXPANDED_KEYS_PER_SKILL) break;
    }
  }
  return out;
}

function keysContainingPhraseSubstring(idx, phrase) {
  const out = [];
  for (const reqKey of idx.requiredKeysList) {
    if (reqKey.includes(phrase)) {
      out.push(reqKey);
      if (out.length >= MAX_EXPANDED_KEYS_PER_SKILL) break;
    }
  }
  return out;
}

async function loadIndex() {
  const [skills, keyRows] = await Promise.all([
    Skill.find({}, { key: 1, label: 1 }).lean(),
    CareerPath.aggregate([
      { $match: { requiredSkillKeys: { $exists: true, $ne: [] } } },
      { $unwind: '$requiredSkillKeys' },
      { $group: { _id: '$requiredSkillKeys' } },
    ]),
  ]);

  const labelToSkill = new Map();
  const tokenToSkills = new Map();
  const requiredSkillKeysSet = new Set();
  const requiredKeysList = [];
  const requiredKeysByToken = new Map();

  for (const row of keyRows) {
    const key = row._id;
    if (!key) continue;
    requiredSkillKeysSet.add(key);
    requiredKeysList.push(key);
    for (const token of tokenize(key)) {
      if (!requiredKeysByToken.has(token)) requiredKeysByToken.set(token, []);
      requiredKeysByToken.get(token).push(key);
    }
  }

  for (const skill of skills) {
    const labelEn = skill.label?.en ? String(skill.label.en).trim() : '';
    const labelDe = skill.label?.de ? String(skill.label.de).trim() : '';
    const record = {
      _id: skill._id,
      key: skill.key,
      labelEn,
      labelDe,
    };

    const lookupLabels = [
      labelEn,
      labelDe,
      skill.key ? skillKeyToPoolPhrase(skill.key) : '',
    ];
    for (const label of lookupLabels) {
      const norm = normalizeLabelForLookup(label);
      if (norm && !labelToSkill.has(norm)) labelToSkill.set(norm, record);
    }

    for (const label of [labelEn, labelDe]) {
      for (const token of tokenize(label)) {
        if (!tokenToSkills.has(token)) tokenToSkills.set(token, []);
        const bucket = tokenToSkills.get(token);
        if (!bucket.some((s) => s.key === record.key)) bucket.push(record);
      }
    }
  }

  indexCache = {
    labelToSkill,
    tokenToSkills,
    requiredSkillKeysSet,
    requiredKeysList,
    requiredKeysByToken,
  };
  return indexCache;
}

async function ensureIndex() {
  if (indexCache) return indexCache;
  if (!indexPromise) indexPromise = loadIndex();
  return indexPromise;
}

function resetUserSkillPoolIndexForTests() {
  indexCache = null;
  indexPromise = null;
}

function lookupSkills(userSkill, idx) {
  const norm = normalizeLabelForLookup(userSkill);
  if (!norm) return [];

  const found = [];
  const seen = new Set();
  const push = (skill) => {
    if (!skill || seen.has(skill.key)) return;
    seen.add(skill.key);
    found.push(skill);
  };

  push(idx.labelToSkill.get(norm));
  push(idx.labelToSkill.get(skillKeyToPoolPhrase(norm)));

  if (found.length === 0) {
    for (const token of tokenize(norm)) {
      const candidates = idx.tokenToSkills.get(token) || [];
      for (const candidate of candidates) {
        push(candidate);
        if (found.length >= MAX_PARTIAL_SKILL_MATCHES) break;
      }
      if (found.length >= MAX_PARTIAL_SKILL_MATCHES) break;
    }
  }

  if (found.length === 0 && norm.length >= 5) {
    for (let len = Math.min(norm.length, 12); len >= 5; len -= 1) {
      const prefix = norm.slice(0, len);
      const candidates = idx.tokenToSkills.get(prefix) || [];
      for (const candidate of candidates) {
        push(candidate);
        if (found.length >= MAX_PARTIAL_SKILL_MATCHES) break;
      }
      if (found.length >= MAX_PARTIAL_SKILL_MATCHES) break;
    }
  }

  return found;
}

function expandRequiredKeysForSkill(skill, idx) {
  const out = new Set();
  const phrases = [
    normalizeLabelForLookup(skill.labelEn),
    skillKeyToPoolPhrase(skill.key),
  ].filter(Boolean);

  for (const phrase of phrases) {
    if (idx.requiredSkillKeysSet.has(phrase)) out.add(phrase);

    for (const key of keysContainingAllWords(idx, phrase.split(' ').filter(Boolean))) {
      out.add(key);
      if (out.size >= MAX_EXPANDED_KEYS_PER_SKILL) return [...out];
    }

    for (const key of keysContainingPhraseSubstring(idx, phrase)) {
      out.add(key);
      if (out.size >= MAX_EXPANDED_KEYS_PER_SKILL) return [...out];
    }

    const single = phrase.split(' ').filter(Boolean);
    if (single.length === 1 && single[0].length >= MIN_SINGLE_TOKEN_SUBSTRING_LEN) {
      let added = 0;
      for (const reqKey of idx.requiredKeysList) {
        if (reqKey.includes(single[0])) {
          out.add(reqKey);
          added += 1;
          if (added >= 20) break;
        }
      }
    }
  }

  return [...out];
}

/**
 * @param {string[]|Array<{name?: string, label?: string}>} userSkills
 * @returns {Promise<{ requiredSkillKeys: string[], careerPathIds: string[], matchedSkillCount: number }>}
 */
async function resolveUserSkillsForPoolFetch(userSkills) {
  const inputs = Array.isArray(userSkills) ? userSkills : [];
  const idx = await ensureIndex();
  const requiredSkillKeys = new Set();
  const skillObjectIds = new Set();
  let matchedSkillCount = 0;

  for (const raw of inputs) {
    const text =
      typeof raw === 'string'
        ? raw
        : raw?.name || raw?.label || raw?.title || '';
    const trimmed = String(text || '').trim();
    if (!trimmed) continue;

    const norm = normalizeLabelForLookup(trimmed);
    if (norm && idx.requiredSkillKeysSet.has(norm)) requiredSkillKeys.add(norm);

    const matchedSkills = lookupSkills(trimmed, idx);
    if (matchedSkills.length === 0) {
      if (norm) requiredSkillKeys.add(norm);
      continue;
    }

    matchedSkillCount += matchedSkills.length;
    for (const skill of matchedSkills) {
      if (skill._id) skillObjectIds.add(String(skill._id));
      for (const key of expandRequiredKeysForSkill(skill, idx)) {
        requiredSkillKeys.add(key);
      }
    }
  }

  let careerPathIds = [];
  if (skillObjectIds.size > 0) {
    const objectIds = [];
    for (const sid of skillObjectIds) {
      try {
        objectIds.push(new mongoose.Types.ObjectId(sid));
      } catch {
        /* skip invalid */
      }
    }
    if (objectIds.length > 0) {
      const links = await CareerPathSkill.find({ skillId: { $in: objectIds } })
        .select('careerPathId')
        .lean();
      careerPathIds = [
        ...new Set(
          links
            .map((link) => (link.careerPathId != null ? String(link.careerPathId) : ''))
            .filter(Boolean)
        ),
      ];
    }
  }

  return {
    requiredSkillKeys: [...requiredSkillKeys],
    careerPathIds,
    matchedSkillCount,
  };
}

module.exports = {
  normalizePoolSkillKey,
  resolveUserSkillsForPoolFetch,
  ensureIndex,
  resetUserSkillPoolIndexForTests,
};
