/**
 * Skill Model Service
 *
 * Transforms unstructured ESCO occupation data (title, description, requiredSkills)
 * into a structured, machine-readable skill model suitable for matching algorithms.
 *
 * ESCO skill relations and URI labels are read from MongoDB (`EscoSkill`,
 * `EscoOccupationSkillRelation`). Import once via `npm run import:esco-skills`.
 */

const { getLocalizedFieldLenient } = require('../utils/i18nFields');
const { getOccupationSkillEntries } = require('./escoSkillLookupService');

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeSkillTitle(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ');
}

// ── Weight heuristics ──────────────────────────────────────────────────────

function computeCoreWeight(entry, index, totalCore) {
  const base = entry.skillType === 'knowledge' ? 0.65 : 0.80;
  const positionalBoost = totalCore > 1
    ? 0.20 * (1 - index / (totalCore - 1))
    : 0.10;
  return Math.min(1.0, Math.round((base + positionalBoost) * 100) / 100);
}

function computeOptionalWeight(entry, index, totalOptional) {
  const base = entry.skillType === 'knowledge' ? 0.20 : 0.30;
  const positionalBoost = totalOptional > 1
    ? 0.20 * (1 - index / (totalOptional - 1))
    : 0.10;
  return Math.min(0.5, Math.round((base + positionalBoost) * 100) / 100);
}

// ── Core builder ───────────────────────────────────────────────────────────

const MIN_CORE = 3;

/**
 * Build a structured skill model for a single occupation.
 *
 * @param {string} escoId
 * @param {object} opts
 * @returns {Promise<object|null>}
 */
async function buildSkillModel(escoId, { title, description, requiredSkills } = {}) {
  const titleText = getLocalizedFieldLenient(title);
  const descriptionText = getLocalizedFieldLenient(description);

  const { essential: essentialEntries, optional: optionalEntries } = await getOccupationSkillEntries(escoId);
  const hasEscoDbData = essentialEntries.length > 0 || optionalEntries.length > 0;

  const dedupeByTitle = (entries) => {
    const seen = new Set();
    return entries.filter((e) => {
      if (!e.title) return false;
      const key = e.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  let coreEntries = dedupeByTitle(essentialEntries);
  let optEntries = dedupeByTitle(optionalEntries);

  const coreKeySet = new Set(coreEntries.map((e) => e.title.toLowerCase()));
  optEntries = optEntries.filter((e) => !coreKeySet.has(e.title.toLowerCase()));

  if (coreEntries.length === 0 && Array.isArray(requiredSkills) && requiredSkills.length > 0) {
    const fallbackSkills = requiredSkills
      .filter((s) => typeof s === 'string' && s.trim() && !s.trim().toLowerCase().startsWith('http'))
      .map((s) => ({ uri: '', title: normalizeSkillTitle(s), skillType: 'skill/competence' }));

    coreEntries = dedupeByTitle(fallbackSkills);
    optEntries = [];
  }

  if (coreEntries.length === 0 && optEntries.length === 0) {
    return null;
  }

  while (coreEntries.length < MIN_CORE && optEntries.length > 0) {
    coreEntries.push(optEntries.shift());
  }

  const core_skills = coreEntries.map((e) => e.title);
  const optional_skills = optEntries.map((e) => e.title);

  const skill_weights = {};
  coreEntries.forEach((entry, i) => {
    skill_weights[entry.title] = computeCoreWeight(entry, i, coreEntries.length);
  });
  optEntries.forEach((entry, i) => {
    skill_weights[entry.title] = computeOptionalWeight(entry, i, optEntries.length);
  });

  const extraction_confidence = computeExtractionConfidence({
    coreCount: core_skills.length,
    optionalCount: optional_skills.length,
    hasDescription: Boolean(descriptionText),
    hasTitle: Boolean(titleText),
    fromEscoDb: hasEscoDbData,
  });

  return {
    core_skills,
    optional_skills,
    skill_weights,
    extraction_confidence,
    built_at: new Date(),
    built_with: hasEscoDbData ? 'esco_db' : 'fallback',
  };
}

function computeExtractionConfidence({ coreCount, optionalCount, hasDescription, hasTitle, fromEscoDb }) {
  let confidence = 0;

  if (fromEscoDb) confidence += 0.50;
  else confidence += 0.15;

  if (coreCount >= MIN_CORE) confidence += 0.25;
  else if (coreCount > 0) confidence += 0.10;

  if (optionalCount > 0) confidence += 0.10;
  if (hasTitle) confidence += 0.05;
  if (hasDescription) confidence += 0.10;

  return Math.min(1.0, Math.round(confidence * 100) / 100);
}

async function buildSkillModels(careerPaths) {
  const results = new Map();
  for (const cp of careerPaths) {
    const model = await buildSkillModel(cp.escoId, {
      title: cp.title,
      description: cp.description,
      requiredSkills: cp.requiredSkills,
    });
    if (model) {
      results.set(cp.escoId, model);
    }
  }
  return results;
}

async function buildSkillModelForOne(careerPath) {
  return buildSkillModel(careerPath.escoId, {
    title: careerPath.title,
    description: careerPath.description,
    requiredSkills: careerPath.requiredSkills,
  });
}

/** @deprecated No-op — data is loaded from MongoDB per occupation. */
async function loadEscoSkillData() {}

/** @deprecated Use resolveEscoSkillTitles from escoSkillLookupService. */
async function getSkillUriToTitleMap() {
  return {};
}

module.exports = {
  loadEscoSkillData,
  buildSkillModels,
  buildSkillModelForOne,
  getSkillUriToTitleMap,
  buildSkillModel,
  computeCoreWeight,
  computeOptionalWeight,
  computeExtractionConfidence,
};
