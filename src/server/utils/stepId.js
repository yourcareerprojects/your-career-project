/**
 * Server-side deterministic step ID generation.
 *
 * Mirrors the frontend behavior in `src/client/utils/stepIdUtils.js`, but is
 * implemented in CommonJS for backend usage.
 *
 * Format: {title-slug}-{simulationId}-{category}-{index}
 */
const MAX_TITLE_SLUG_LENGTH = 50;
const DEFAULT_SIMULATION_ID = 'local';
const DEFAULT_CATEGORY = 'unknown';
const DEFAULT_INDEX = 0;
const CATEGORY_MAP = {
  // prioritized list keys -> display category keys used by the client
  nextCareerRoles: 'nextSteps',
  outsideTheBoxRoles: 'outsideTheBox'
};

/** Same idea as client `titleStringForStepId` — prioritized list titles are often `{ en, de }`. */
function titleStringForStepId(title) {
  if (title == null || title === '') return '';
  if (typeof title === 'string' || typeof title === 'number') return String(title);
  if (typeof title === 'object' && !Array.isArray(title)) {
    if (title.en != null && String(title.en).trim() !== '') return String(title.en).trim();
    if (title.de != null && String(title.de).trim() !== '') return String(title.de).trim();
  }
  return '';
}

function slugifyTitle(title) {
  const raw = titleStringForStepId(title);
  if (!raw) return '';
  return raw
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase()
    .substring(0, MAX_TITLE_SLUG_LENGTH);
}

function generateStepId(title, simulationId, category, index) {
  const titleStr = titleStringForStepId(title);
  if (!titleStr) {
    throw new Error('Title is required for stepId generation');
  }

  const titleSlug = slugifyTitle(title);
  const simId = simulationId || DEFAULT_SIMULATION_ID;
  const cat = category || DEFAULT_CATEGORY;
  const idx = typeof index === 'number' ? index : DEFAULT_INDEX;

  return `${titleSlug}-${simId}-${cat}-${idx}`;
}

function mapPrioritizedListCategoryToStepCategory(listCategory) {
  return CATEGORY_MAP[listCategory] || listCategory || DEFAULT_CATEGORY;
}

module.exports = {
  slugifyTitle,
  generateStepId,
  mapPrioritizedListCategoryToStepCategory,
  CATEGORY_MAP
};

