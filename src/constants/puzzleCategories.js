/**
 * Career Puzzle piece categories (five umbrella types).
 * Legacy slugs are normalized via normalizePuzzleCategory for existing data.
 */
const PUZZLE_CATEGORIES = [
  'school',
  'apprenticeship',
  'university',
  'further_education',
  'occupation',
];

/** @type {Record<string, string>} */
const LEGACY_PUZZLE_CATEGORY_MAP = {
  school: 'school',
  vocational_school: 'school',
  high_school: 'school',
  technical_college: 'school',
  apprenticeship: 'apprenticeship',
  university: 'university',
  certification: 'further_education',
  further_education: 'further_education',
  occupation: 'occupation',
  promotion: 'occupation',
  career_change: 'occupation',
  specialization: 'occupation',
};

/**
 * Next-step category chips allowed for each path-tip career stage.
 * Order within each list follows user-facing progression, not PUZZLE_CATEGORIES.
 * @type {Record<string, string[]>}
 */
const NEXT_CATEGORIES_BY_TIP = {
  school: ['school', 'apprenticeship', 'university'],
  apprenticeship: [
    'apprenticeship',
    'occupation',
    'further_education',
    'university',
  ],
  university: ['university', 'occupation', 'further_education'],
  further_education: ['further_education', 'occupation', 'university'],
  occupation: ['occupation', 'further_education', 'university'],
};

/**
 * Catalog piece keys used as graph roots when the path tip's display category
 * no longer matches its catalog piece (e.g. locked seed edited to Realschule
 * while pieceId is still edu.bachelors).
 * @type {Record<string, string>}
 */
const STAGE_GRAPH_PROXY_KEYS = {
  school: 'edu.realschulabschluss',
  apprenticeship: 'edu.ausbildung',
  university: 'edu.bachelors',
  further_education: 'edu.professional',
  occupation: 'occ.electrician',
};

const PUZZLE_CATEGORY_SET = new Set(PUZZLE_CATEGORIES);

/**
 * Map a stored / legacy category slug to one of the five canonical values.
 * @param {unknown} value
 * @returns {string}
 */
function normalizePuzzleCategory(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (PUZZLE_CATEGORY_SET.has(key)) return key;
  return LEGACY_PUZZLE_CATEGORY_MAP[key] || '';
}

function isPuzzleCategory(value) {
  return PUZZLE_CATEGORY_SET.has(String(value || '').trim());
}

/**
 * Display category for a path node (snapshot wins over catalog piece).
 * @param {{ snapshot?: { category?: unknown }, piece?: { category?: unknown }, category?: unknown }|null|undefined} node
 * @returns {string}
 */
function getNodeDisplayCategory(node) {
  if (!node || typeof node !== 'object') return '';
  return (
    normalizePuzzleCategory(node.snapshot?.category) ||
    normalizePuzzleCategory(node.piece?.category) ||
    normalizePuzzleCategory(node.category) ||
    ''
  );
}

/**
 * Career stage that gates next-step category chips / options.
 *
 * Uses the tip's display category, except for the narrative `exp.none` seed
 * (still showing as occupation): then the graph-from education node drives the
 * stage so school-leavers see school/apprenticeship/university. Editing the tip
 * category away from occupation, or editing the education snapshot, updates this.
 *
 * @param {{ pieceKey?: string, snapshot?: object, piece?: object, category?: string, instanceId?: string }|null|undefined} tip
 * @param {{ snapshot?: object, piece?: object, category?: string, instanceId?: string }|null|undefined} graphFrom
 * @returns {string}
 */
function resolveNextStepStageCategory(tip, graphFrom = null) {
  const tipCategory = getNodeDisplayCategory(tip);
  const graphCategory = getNodeDisplayCategory(graphFrom);
  const tipKey = String(tip?.pieceKey || '');
  const tipIsNarrativeNoExperience =
    tipKey === 'exp.none' && tipCategory === 'occupation';
  const graphDiffers =
    Boolean(graphFrom) &&
    Boolean(tip?.instanceId) &&
    String(graphFrom.instanceId) !== String(tip.instanceId);

  if (tipIsNarrativeNoExperience && graphDiffers && graphCategory) {
    return graphCategory;
  }
  return tipCategory;
}

/**
 * Ordered next-step categories allowed for a path tip's category.
 * Unknown / empty tips fall back to all five canonical categories (PUZZLE_CATEGORIES order).
 * @param {unknown} tipCategory
 * @returns {string[]}
 */
function getAllowedNextCategories(tipCategory) {
  const normalized = normalizePuzzleCategory(tipCategory);
  if (normalized && NEXT_CATEGORIES_BY_TIP[normalized]) {
    return [...NEXT_CATEGORIES_BY_TIP[normalized]];
  }
  return [...PUZZLE_CATEGORIES];
}

/**
 * Keep only next-step candidates whose piece category is allowed for the stage.
 * @param {Array<{ piece?: { category?: unknown } }>} steps
 * @param {Iterable<string>} allowedCategories
 * @returns {typeof steps}
 */
function filterStepsByAllowedCategories(steps, allowedCategories) {
  const allowed = new Set(
    [...(allowedCategories || [])]
      .map((category) => normalizePuzzleCategory(category) || String(category || '').trim())
      .filter(Boolean)
  );
  if (!allowed.size) return [...(steps || [])];
  return (steps || []).filter((step) => {
    const category =
      normalizePuzzleCategory(step?.piece?.category) ||
      String(step?.piece?.category || '').trim();
    return category && allowed.has(category);
  });
}

/**
 * Pick the most suitable category chip to preselect.
 * For education-stage tips, prefer the first allowed option that advances
 * beyond the tip category (e.g. school → apprenticeship). For occupation tips,
 * prefer staying in occupation. Falls back to the first available allowed category.
 *
 * @param {unknown} tipCategory
 * @param {string[]} [availableCategories] — already filtered to categories with steps
 * @returns {string|null}
 */
function getPreferredNextCategory(tipCategory, availableCategories = []) {
  const available = (availableCategories || []).filter(Boolean);
  if (!available.length) return null;

  const tip = normalizePuzzleCategory(tipCategory);
  const allowedWithSteps = getAllowedNextCategories(tipCategory).filter((category) =>
    available.includes(category)
  );
  const pool = allowedWithSteps.length ? allowedWithSteps : available;

  if (tip === 'occupation') {
    return pool[0] || null;
  }

  const forward = pool.find((category) => category !== tip);
  return forward || pool[0] || null;
}

module.exports = {
  PUZZLE_CATEGORIES,
  PUZZLE_CATEGORY_SET,
  LEGACY_PUZZLE_CATEGORY_MAP,
  NEXT_CATEGORIES_BY_TIP,
  STAGE_GRAPH_PROXY_KEYS,
  normalizePuzzleCategory,
  isPuzzleCategory,
  getNodeDisplayCategory,
  resolveNextStepStageCategory,
  getAllowedNextCategories,
  getPreferredNextCategory,
  filterStepsByAllowedCategories,
};
