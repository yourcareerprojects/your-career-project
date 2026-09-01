const CareerPath = require('../../models/CareerPath');
const { materializeRuleStep } = require('./puzzleEscoMaterializer');
const { NEXT_STEPS_FETCH_CEILING } = require('./puzzleGraphService');
const { normalizePuzzleCategory } = require('../../../constants/puzzleCategories');

/** Max CareerPath docs fetched per rule before materialization. */
const RULE_QUERY_LIMIT = 8;

/**
 * Static rule hints for curated DACH piece keys (avoids schema churn on PuzzlePiece).
 * @type {Record<string, { iscoPrefix?: string, domain?: string, titleQuery?: string }>}
 */
const RULE_HINTS_BY_KEY = {
  'appr.electrician': { iscoPrefix: '74', titleQuery: 'electric' },
  'appr.it_specialist': { iscoPrefix: '25', titleQuery: 'software|ICT|information technology|Fachinformat' },
  'appr.carpenter': { iscoPrefix: '71', titleQuery: 'carpenter|joinery|Zimmer' },
  'occ.electrician': { iscoPrefix: '74', titleQuery: 'electric' },
  'occ.mechanical_engineer': { iscoPrefix: '21', titleQuery: 'mechanical engineer|Maschinenbau' },
  'occ.building_technician': { iscoPrefix: '31', titleQuery: 'building|Gebäudetechnik' },
  'study.mechanical_engineering': { iscoPrefix: '21', titleQuery: 'mechanical|Maschinenbau|engineer' },
  'path.university': { iscoPrefix: '21', titleQuery: 'engineer|analyst|scientist' },
  'path.applied_sciences': { iscoPrefix: '21', titleQuery: 'engineer|technician|applied' },
  'path.vocational_school': { iscoPrefix: '7', titleQuery: 'technician|craft|Fachkraft' },
  'path.technical_college': { iscoPrefix: '31', titleQuery: 'technician|Techniker' },
  'path.high_school': { iscoPrefix: '2', titleQuery: 'assistant|clerk|trainee' },
  'edu.abitur': { iscoPrefix: '2', titleQuery: 'engineer|analyst' },
  'edu.fachabitur': { iscoPrefix: '31', titleQuery: 'technician|engineer' },
  'edu.bachelors': { iscoPrefix: '21', titleQuery: 'engineer|specialist' },
  'edu.masters': { iscoPrefix: '21', titleQuery: 'engineer|manager|scientist' },
  'edu.realschulabschluss': { iscoPrefix: '7', titleQuery: 'technician|assistant|Fachkraft' },
  'edu.hauptschulabschluss': { iscoPrefix: '7', titleQuery: 'assistant|helper|Fachkraft' },
  'edu.ausbildung': { iscoPrefix: '7', titleQuery: 'technician|craft|Fachkraft' },
};

function getRuleHints(piece) {
  const key = String(piece?.key || '');
  return RULE_HINTS_BY_KEY[key] || {};
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildIscoPrefixRegex(prefix) {
  const p = String(prefix || '').trim();
  if (!p) return null;
  return new RegExp(`^${escapeRegex(p)}`);
}

function buildTitleOrRegex(titleQuery) {
  const q = String(titleQuery || '').trim();
  if (!q) return null;
  return new RegExp(q, 'i');
}

function baseCareerPathFilter(excludeEscoIds = []) {
  const excluded = excludeEscoIds.map((id) => String(id)).filter(Boolean);
  return {
    simulationExcluded: { $ne: true },
    escoId: {
      $type: 'string',
      $nin: ['', ...excluded],
    },
  };
}

const CAREER_PATH_PROJECTION = {
  escoId: 1,
  title: 1,
  description: 1,
  iscoGroup: 1,
  domain: 1,
  seniority: 1,
  skillModel: 1,
  altTitles: 1,
  altTitlesDe: 1,
};

/**
 * Shared finder used by rules A/C.
 */
async function findCareerPathsByHints(hints, options = {}) {
  const {
    maxSeniority = 3,
    minSeniority = 0,
    excludeEscoIds = [],
    limit = RULE_QUERY_LIMIT,
  } = options;

  const filter = {
    ...baseCareerPathFilter(excludeEscoIds),
    'seniority.seniority_level': { $gte: minSeniority, $lte: maxSeniority },
  };

  const andClauses = [];
  const iscoRe = buildIscoPrefixRegex(hints.iscoPrefix);
  const titleRe = buildTitleOrRegex(hints.titleQuery);

  if (iscoRe || titleRe) {
    const or = [];
    if (iscoRe) or.push({ iscoGroup: iscoRe });
    if (titleRe) {
      or.push({ 'title.en': titleRe });
      or.push({ 'title.de': titleRe });
      or.push({ altTitles: titleRe });
      or.push({ altTitlesDe: titleRe });
    }
    andClauses.push({ $or: or });
  }

  if (hints.domain) {
    andClauses.push({ domain: new RegExp(escapeRegex(hints.domain), 'i') });
  }

  if (andClauses.length) {
    filter.$and = andClauses;
  } else {
    // No hints → do not open-ended scan the catalog
    return [];
  }

  return CareerPath.find(filter)
    .select(CAREER_PATH_PROJECTION)
    .sort({ 'seniority.seniority_level': 1, 'title.en': 1 })
    .limit(Math.max(1, Math.min(limit, RULE_QUERY_LIMIT)))
    .lean();
}

/**
 * Rule A — apprenticeship → related occupations
 */
async function findApprenticeshipCandidates(piece, ctx = {}) {
  if (piece.category !== 'apprenticeship') return [];
  const hints = getRuleHints(piece);
  return findCareerPathsByHints(hints, {
    maxSeniority: 3,
    excludeEscoIds: ctx.excludeEscoIds || [],
  });
}

/**
 * Rule B — occupation → +1 seniority in same ISCO family
 */
async function findSeniorityStepCandidates(piece, ctx = {}) {
  if (piece.category !== 'occupation') {
    return [];
  }
  if (!piece.escoId && !piece.careerPathId) return [];

  let current = null;
  if (piece.careerPathId) {
    current = await CareerPath.findById(piece.careerPathId)
      .select(CAREER_PATH_PROJECTION)
      .lean();
  }
  if (!current && piece.escoId) {
    current = await CareerPath.findOne({ escoId: piece.escoId })
      .select(CAREER_PATH_PROJECTION)
      .lean();
  }
  if (!current) {
    // Fall back to hints when curated stub has no ESCO link yet
    const hints = getRuleHints(piece);
    return findCareerPathsByHints(hints, {
      minSeniority: 1,
      maxSeniority: 4,
      excludeEscoIds: ctx.excludeEscoIds || [],
    });
  }

  const currentLevel = Number(current.seniority?.seniority_level);
  const level = Number.isFinite(currentLevel) ? currentLevel : 0;
  const nextLevel = Math.min(6, level + 1);
  if (nextLevel <= level) return [];

  const isco = String(current.iscoGroup || '').trim();
  // Prefer 3-digit minor group, else 2-digit sub-major
  const prefix = isco.length >= 3 ? isco.slice(0, 3) : isco.slice(0, 2);
  const hints = getRuleHints(piece);
  const effectivePrefix = prefix || hints.iscoPrefix;
  if (!effectivePrefix) return [];

  const excludeEscoIds = [
    ...(ctx.excludeEscoIds || []),
    current.escoId,
  ].filter(Boolean);

  const filter = {
    ...baseCareerPathFilter(excludeEscoIds),
    iscoGroup: buildIscoPrefixRegex(effectivePrefix),
    'seniority.seniority_level': { $gt: level, $lte: nextLevel },
  };

  return CareerPath.find(filter)
    .select(CAREER_PATH_PROJECTION)
    .sort({ 'seniority.seniority_level': 1, 'title.en': 1 })
    .limit(RULE_QUERY_LIMIT)
    .lean();
}

/**
 * Rule C — study / pathway / education → related occupations
 */
async function findStudyPathwayCandidates(piece, ctx = {}) {
  const key = String(piece.key || '');
  const category = piece.category;
  const isStudyOrPath =
    category === 'university' ||
    category === 'school' ||
    key.startsWith('study.') ||
    key.startsWith('path.') ||
    key.startsWith('edu.');

  if (!isStudyOrPath) return [];
  // Apprenticeship handled by rule A; skip edu seeds that are purely narrative experience
  if (category === 'apprenticeship') return [];

  const hints = getRuleHints(piece);
  return findCareerPathsByHints(hints, {
    maxSeniority: 3,
    excludeEscoIds: ctx.excludeEscoIds || [],
  });
}

const RULES = [
  {
    id: 'apprenticeship_to_occupation',
    relationType: 'progresses_to',
    weightBase: 40,
    when: (piece) => piece.category === 'apprenticeship',
    findCandidates: findApprenticeshipCandidates,
  },
  {
    id: 'occupation_seniority_step',
    relationType: 'progresses_to',
    weightBase: 35,
    when: (piece) => piece.category === 'occupation',
    findCandidates: findSeniorityStepCandidates,
  },
  {
    id: 'study_or_pathway_to_occupations',
    relationType: 'qualifies_for',
    weightBase: 30,
    when: (piece) => {
      const key = String(piece.key || '');
      const c = piece.category;
      return (
        c === 'university' ||
        c === 'school' ||
        key.startsWith('study.') ||
        key.startsWith('path.') ||
        (key.startsWith('edu.') && c !== 'apprenticeship')
      );
    },
    findCandidates: findStudyPathwayCandidates,
  },
];

/**
 * Run applicable rules and materialize enough steps to fill remaining slots.
 *
 * @param {object} fromPiece — puzzle piece (serialized or lean)
 * @param {{
 *   excludePieceIds?: Array,
 *   excludeEscoIds?: string[],
 *   slotsRemaining?: number,
 * }} [ctx]
 * @returns {Promise<Array>}
 */
async function generateRuleSteps(fromPiece, ctx = {}) {
  const slotsRemaining = Math.max(
    0,
    ctx.slotsRemaining ?? NEXT_STEPS_FETCH_CEILING
  );
  if (!fromPiece?._id && !fromPiece?.id) return [];
  if (slotsRemaining <= 0) return [];

  const normalizedCategory =
    normalizePuzzleCategory(fromPiece.category) || fromPiece.category;
  const piece = { ...fromPiece, category: normalizedCategory };

  const fromPieceId = piece._id || piece.id;
  const excludeEscoIds = new Set(
    (ctx.excludeEscoIds || []).map((id) => String(id)).filter(Boolean)
  );
  const excludePieceIds = new Set(
    (ctx.excludePieceIds || []).map((id) => String(id))
  );

  const ruleCtx = { excludeEscoIds: [...excludeEscoIds] };
  const candidates = [];

  for (const rule of RULES) {
    if (!rule.when(piece)) continue;
    const docs = await rule.findCandidates(piece, ruleCtx);
    for (const doc of docs) {
      if (!doc?.escoId || excludeEscoIds.has(String(doc.escoId))) continue;
      candidates.push({
        careerPath: doc,
        ruleId: rule.id,
        relationType: rule.relationType,
        weight: rule.weightBase,
      });
      excludeEscoIds.add(String(doc.escoId));
    }
  }

  const steps = [];
  for (const candidate of candidates) {
    if (steps.length >= slotsRemaining) break;
    const step = await materializeRuleStep(fromPieceId, candidate.careerPath, {
      relationType: candidate.relationType,
      weight: candidate.weight,
      ruleId: candidate.ruleId,
    });
    if (excludePieceIds.has(String(step.piece.id))) continue;
    excludePieceIds.add(String(step.piece.id));
    steps.push(step);
  }

  return steps;
}

/**
 * Pure helpers exported for unit tests (no DB).
 */
function iscoFamilyPrefix(iscoGroup, preferredLength = 3) {
  const isco = String(iscoGroup || '').trim();
  if (!isco) return '';
  if (isco.length >= preferredLength) return isco.slice(0, preferredLength);
  return isco.slice(0, Math.min(2, isco.length));
}

function allowedSeniorityStepLevels(currentLevel) {
  const level = Math.max(0, Math.min(6, Math.floor(Number(currentLevel) || 0)));
  const next = Math.min(6, level + 1);
  if (next <= level) return [];
  return [next];
}

module.exports = {
  RULE_HINTS_BY_KEY,
  RULE_QUERY_LIMIT,
  RULES,
  getRuleHints,
  generateRuleSteps,
  findCareerPathsByHints,
  findApprenticeshipCandidates,
  findSeniorityStepCandidates,
  findStudyPathwayCandidates,
  iscoFamilyPrefix,
  allowedSeniorityStepLevels,
  buildIscoPrefixRegex,
};
