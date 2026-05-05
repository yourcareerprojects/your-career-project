/**
 * Skill Model Service
 *
 * Transforms unstructured ESCO occupation data (title, description, requiredSkills)
 * into a structured, machine-readable skill model suitable for matching algorithms.
 *
 * Output schema per occupation:
 * {
 *   core_skills:            string[]           – all essential skills (≥3)
 *   optional_skills:        string[]           – beneficial but not blocking
 *   skill_weights:          { [skill]: number} – 0.1-1.0 relevance weight
 *   extraction_confidence:  number             – 0.0-1.0
 * }
 *
 * Primary strategy: deterministic extraction from the ESCO CSV relation types
 * (essential → core, optional → optional) with heuristic weighting.
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ── CSV paths ──────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../../../ESCO dataset - v1.2.0 - classification - en - csv');
const SKILLS_CSV = path.join(DATA_DIR, 'skills_en.csv');
const OCC_SKILL_REL_CSV = path.join(DATA_DIR, 'occupationSkillRelations_en.csv');

// ── Caches (populated once via loadEscoSkillData) ──────────────────────────
let _skillUriToTitle = null;   // URI → preferredLabel
let _occEssentialSkills = null; // occupationUri → [{ uri, title, skillType }]
let _occOptionalSkills = null;  // occupationUri → [{ uri, title, skillType }]
let _loadPromise = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeSkillTitle(raw) {
  if (!raw || typeof raw !== 'string') return '';
  // Capitalize first letter, trim whitespace, collapse multiple spaces
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed;
}

/**
 * Load skills CSV + occupation-skill relations into memory.
 * Thread-safe: only one load happens, subsequent calls await the same promise.
 */
async function loadEscoSkillData() {
  if (_skillUriToTitle && _occEssentialSkills && _occOptionalSkills) {
    return;
  }
  if (_loadPromise) {
    return _loadPromise;
  }

  _loadPromise = (async () => {
    // 1. Parse skill titles
    const skillMap = {};
    if (fs.existsSync(SKILLS_CSV)) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(SKILLS_CSV)
          .pipe(csv())
          .on('data', (row) => {
            const uri = row['conceptUri'];
            const title = row['preferredLabel'];
            if (uri && title) skillMap[uri] = normalizeSkillTitle(title);
          })
          .on('end', resolve)
          .on('error', reject);
      });
    }
    _skillUriToTitle = skillMap;

    // 2. Parse occupation-skill relations (both essential AND optional)
    const essential = {};
    const optional = {};

    if (fs.existsSync(OCC_SKILL_REL_CSV)) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(OCC_SKILL_REL_CSV)
          .pipe(csv())
          .on('data', (row) => {
            const occUri = row['occupationUri'];
            const relType = (row['relationType'] || '').toLowerCase();
            const skillType = (row['skillType'] || '').toLowerCase();
            const skillUri = row['skillUri'];

            if (!occUri || !skillUri) return;

            const title = skillMap[skillUri] || '';
            const entry = { uri: skillUri, title, skillType };

            if (relType === 'essential') {
              if (!essential[occUri]) essential[occUri] = [];
              essential[occUri].push(entry);
            } else if (relType === 'optional') {
              if (!optional[occUri]) optional[occUri] = [];
              optional[occUri].push(entry);
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });
    }

    _occEssentialSkills = essential;
    _occOptionalSkills = optional;
  })();

  return _loadPromise;
}

// ── Weight heuristics ──────────────────────────────────────────────────────

/**
 * Assign a relevance weight to a core (essential) skill.
 *
 * Strategy:
 * - "knowledge" type skills get slightly lower weight (foundational, not differentiating)
 * - "skill/competence" type skills get higher weight (actionable, differentiating)
 * - Position within the list provides a mild rank signal (ESCO lists skills roughly
 *   by importance for each occupation).
 * - All core weights fall in [0.6, 1.0].
 */
function computeCoreWeight(entry, index, totalCore) {
  const base = entry.skillType === 'knowledge' ? 0.65 : 0.80;
  // Mild positional decay: first skill gets a small boost, last skill no boost
  const positionalBoost = totalCore > 1
    ? 0.20 * (1 - index / (totalCore - 1))
    : 0.10;
  return Math.min(1.0, Math.round((base + positionalBoost) * 100) / 100);
}

/**
 * Assign a relevance weight to an optional skill.
 *
 * Strategy:
 * - All optional weights fall in [0.1, 0.5].
 * - "skill/competence" types get slightly higher weight than "knowledge".
 * - Mild positional decay.
 */
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
 * @param {string} escoId  – ESCO occupation URI
 * @param {object} opts
 * @param {string} opts.title          – occupation title (fallback context)
 * @param {string} opts.description    – occupation description (fallback context)
 * @param {string[]} opts.requiredSkills – already-imported skill titles (fallback)
 * @returns {object|null}  Skill model object or null when no data is available.
 */
function buildSkillModel(escoId, { title, description, requiredSkills } = {}) {
  const essentialEntries = (_occEssentialSkills && _occEssentialSkills[escoId]) || [];
  const optionalEntries = (_occOptionalSkills && _occOptionalSkills[escoId]) || [];

  // Dedupe by title (some entries share a title through URI aliases)
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

  // Remove optional entries that duplicate core entries
  const coreKeySet = new Set(coreEntries.map((e) => e.title.toLowerCase()));
  optEntries = optEntries.filter((e) => !coreKeySet.has(e.title.toLowerCase()));

  // --- Fallback: if no ESCO CSV data, fall back to existing requiredSkills ---
  if (coreEntries.length === 0 && Array.isArray(requiredSkills) && requiredSkills.length > 0) {
    const fallbackSkills = requiredSkills
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => ({ uri: '', title: normalizeSkillTitle(s), skillType: 'skill/competence' }));

    // All fallback skills become core (no cap)
    coreEntries = dedupeByTitle(fallbackSkills);
    optEntries = [];
  }

  // If still nothing, we cannot build a model
  if (coreEntries.length === 0 && optEntries.length === 0) {
    return null;
  }

  // If core_skills has fewer than MIN_CORE, promote from optional
  while (coreEntries.length < MIN_CORE && optEntries.length > 0) {
    coreEntries.push(optEntries.shift());
  }

  // Build arrays
  const core_skills = coreEntries.map((e) => e.title);
  const optional_skills = optEntries.map((e) => e.title);

  // Build weights map
  const skill_weights = {};
  coreEntries.forEach((entry, i) => {
    skill_weights[entry.title] = computeCoreWeight(entry, i, coreEntries.length);
  });
  optEntries.forEach((entry, i) => {
    skill_weights[entry.title] = computeOptionalWeight(entry, i, optEntries.length);
  });

  // Extraction confidence
  const extraction_confidence = computeExtractionConfidence({
    coreCount: core_skills.length,
    optionalCount: optional_skills.length,
    hasDescription: Boolean(description && description.trim()),
    hasTitle: Boolean(title && title.trim()),
    fromCsv: essentialEntries.length > 0 || optionalEntries.length > 0
  });

  return {
    core_skills,
    optional_skills,
    skill_weights,
    extraction_confidence,
    built_at: new Date(),
    built_with: essentialEntries.length > 0 || optionalEntries.length > 0 ? 'esco_csv' : 'fallback'
  };
}

/**
 * Compute a confidence score reflecting how reliably the skill model
 * represents the actual role requirements.
 */
function computeExtractionConfidence({ coreCount, optionalCount, hasDescription, hasTitle, fromCsv }) {
  let confidence = 0;

  // Base: having ESCO CSV relation data is the strongest signal
  if (fromCsv) confidence += 0.50;
  else confidence += 0.15; // fallback path

  // Core skill count: having at least MIN_CORE is a strong signal
  if (coreCount >= MIN_CORE) confidence += 0.25;
  else if (coreCount > 0) confidence += 0.10;

  // Having optional skills is a good signal for completeness
  if (optionalCount > 0) confidence += 0.10;

  // Metadata presence
  if (hasTitle) confidence += 0.05;
  if (hasDescription) confidence += 0.10;

  return Math.min(1.0, Math.round(confidence * 100) / 100);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Ensure ESCO skill data is loaded, then build skill models for an array
 * of CareerPath-like objects.
 *
 * @param {object[]} careerPaths – array of { escoId, title, description, requiredSkills }
 * @returns {Map<string, object>} escoId → skillModel (null values omitted)
 */
async function buildSkillModels(careerPaths) {
  await loadEscoSkillData();

  const results = new Map();
  for (const cp of careerPaths) {
    const model = buildSkillModel(cp.escoId, {
      title: cp.title,
      description: cp.description,
      requiredSkills: cp.requiredSkills
    });
    if (model) {
      results.set(cp.escoId, model);
    }
  }
  return results;
}

/**
 * Build a skill model for a single CareerPath document.
 * Ensures data is loaded first.
 *
 * @param {object} careerPath – { escoId, title, description, requiredSkills }
 * @returns {object|null}
 */
async function buildSkillModelForOne(careerPath) {
  await loadEscoSkillData();
  return buildSkillModel(careerPath.escoId, {
    title: careerPath.title,
    description: careerPath.description,
    requiredSkills: careerPath.requiredSkills
  });
}

/**
 * Return the cached skill URI → title map (useful for other services).
 */
async function getSkillUriToTitleMap() {
  await loadEscoSkillData();
  return _skillUriToTitle || {};
}

module.exports = {
  loadEscoSkillData,
  buildSkillModels,
  buildSkillModelForOne,
  getSkillUriToTitleMap,
  // Exported for testing
  buildSkillModel,
  computeCoreWeight,
  computeOptionalWeight,
  computeExtractionConfidence
};
