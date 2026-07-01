const localizedContentService = require('./localizedContentService').default
  || require('./localizedContentService');
const { parseActivitiesFromText, formatActivitiesAsText } = require('../components/profile/WorkEnjoyMostCoaching');
const {
  parseInterestTopicsFromText,
  formatInterestTopicsAsText,
} = require('../components/profile/TopicsIndustriesCoaching');
const {
  parseNaturallyGoodAtFromText,
  formatNaturallyGoodAtAsText,
} = require('../components/profile/NaturallyGoodAtCoaching');
const {
  parseWorkEnvironmentFromText,
  formatWorkEnvironmentAsText,
} = require('../components/profile/WorkEnvironmentCoaching');
const {
  parseWorkingLifeAchievementFromText,
  formatWorkingLifeAchievementAsText,
} = require('../components/profile/WorkingLifeAchievementCoaching');

/** Backend sentinel for empty who-are-you narratives */
const WHO_ARE_YOU_PLACEHOLDER = 'No personal profile information available yet.';

const PROFILE_DISPLAY_MODE = {
  BULLETS: 'bullets',
  NARRATIVE: 'narrative',
};

const STORAGE_PREFIX = 'profileSectionDisplayModes';
const WHO_ARE_YOU_ANSWER_COUNT = 5;

function parseLinesFromText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function getWhoAreYouNarratives(whoAreYou, lang) {
  const fallback = Array(WHO_ARE_YOU_ANSWER_COUNT).fill('');
  const languagesToTry = [lang, 'en', 'de'].filter((code, index, arr) => (
    code && arr.indexOf(code) === index
  ));
  let raw = '';
  for (const code of languagesToTry) {
    const candidate = localizedContentService.getLocalizedWithFallback(whoAreYou?.summary_text, code, '').trim();
    if (candidate) {
      raw = candidate;
      break;
    }
  }
  if (!raw) return fallback;
  const normalizeNarrative = (item) => {
    const text = String(item || '').trim();
    return text === WHO_ARE_YOU_PLACEHOLDER ? '' : text;
  };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== WHO_ARE_YOU_ANSWER_COUNT) return fallback;
    return parsed.map(normalizeNarrative);
  } catch (_err) {
    return fallback;
  }
}

function hasIdentityNarrative(narratives, index) {
  return Boolean(String(narratives?.[index] || '').trim());
}

/**
 * Parse a stored identity answer into bullet lines for read-only display.
 *
 * @param {string} fieldKey
 * @param {string} text
 * @returns {string[]}
 */
function parseIdentityFieldToBullets(fieldKey, text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  switch (fieldKey) {
    case 'workEnjoyMost':
      return parseActivitiesFromText(raw);
    case 'topicsIndustriesInterest':
      return parseInterestTopicsFromText(raw);
    case 'naturallyGoodAt':
      return parseNaturallyGoodAtFromText(raw).strengths;
    case 'workEnvironmentFit': {
      const parsed = parseWorkEnvironmentFromText(raw);
      return [...parsed.workStyles, ...parsed.workEnvironments];
    }
    case 'workingLifeAchievement': {
      const parsed = parseWorkingLifeAchievementFromText(raw);
      return [...parsed.careerGoals, ...parsed.priorities];
    }
    default:
      return parseLinesFromText(raw);
  }
}

function identitySectionKey(fieldKey) {
  return `identity.${fieldKey}`;
}

function cleanIdentityBulletItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeEditableBulletRows(items = []) {
  const rows = (Array.isArray(items) ? items : []).map((item) => String(item || ''));
  return rows.length > 0 ? rows : [''];
}

/**
 * Parse a stored identity answer into an edit draft (single or dual bullet groups).
 *
 * @param {string} fieldKey
 * @param {string} text
 * @returns {{ kind: 'bullets', items: string[] } | { kind: 'dual', primary: string[], secondary: string[] }}
 */
function parseIdentityFieldForEdit(fieldKey, text) {
  const raw = String(text || '').trim();
  if (fieldKey === 'workEnvironmentFit') {
    const parsed = parseWorkEnvironmentFromText(raw);
    return {
      kind: 'dual',
      primary: normalizeEditableBulletRows(parsed.workStyles),
      secondary: normalizeEditableBulletRows(parsed.workEnvironments),
    };
  }
  if (fieldKey === 'workingLifeAchievement') {
    const parsed = parseWorkingLifeAchievementFromText(raw);
    return {
      kind: 'dual',
      primary: normalizeEditableBulletRows(parsed.careerGoals),
      secondary: normalizeEditableBulletRows(parsed.priorities),
    };
  }
  return {
    kind: 'bullets',
    items: normalizeEditableBulletRows(parseIdentityFieldToBullets(fieldKey, raw)),
  };
}

/**
 * @param {string} fieldKey
 * @param {{ kind: 'bullets', items: string[] } | { kind: 'dual', primary: string[], secondary: string[] }} draft
 * @returns {string}
 */
function formatIdentityFieldFromEdit(fieldKey, draft) {
  if (!draft || typeof draft !== 'object') return '';
  if (draft.kind === 'dual') {
    const primary = cleanIdentityBulletItems(draft.primary);
    const secondary = cleanIdentityBulletItems(draft.secondary);
    if (fieldKey === 'workEnvironmentFit') {
      return formatWorkEnvironmentAsText({ workStyles: primary, workEnvironments: secondary });
    }
    if (fieldKey === 'workingLifeAchievement') {
      return formatWorkingLifeAchievementAsText({ careerGoals: primary, priorities: secondary });
    }
    return '';
  }
  const items = cleanIdentityBulletItems(draft.items);
  switch (fieldKey) {
    case 'workEnjoyMost':
      return formatActivitiesAsText(items);
    case 'topicsIndustriesInterest':
      return formatInterestTopicsAsText(items);
    case 'naturallyGoodAt':
      return formatNaturallyGoodAtAsText({ strengths: items });
    default:
      return items.join('\n');
  }
}

/**
 * @param {string} fieldKey
 * @param {object} draft
 * @returns {boolean}
 */
function identityFieldDraftHasContent(fieldKey, draft) {
  const formatted = formatIdentityFieldFromEdit(fieldKey, draft);
  if (!formatted.trim()) return false;
  if (draft?.kind === 'dual') {
    return cleanIdentityBulletItems(draft.primary).length > 0
      && cleanIdentityBulletItems(draft.secondary).length > 0;
  }
  return cleanIdentityBulletItems(draft?.items).length > 0;
}

function profileSectionStorageKey(userId) {
  const id = String(userId || '').trim();
  return id ? `${STORAGE_PREFIX}:${id}` : STORAGE_PREFIX;
}

function readProfileSectionDisplayModes(userId) {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(profileSectionStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function persistProfileSectionDisplayMode(userId, sectionKey, mode, existingModes = {}) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const next = {
    ...existingModes,
    [sectionKey]: mode === PROFILE_DISPLAY_MODE.NARRATIVE
      ? PROFILE_DISPLAY_MODE.NARRATIVE
      : PROFILE_DISPLAY_MODE.BULLETS,
  };
  try {
    window.localStorage.setItem(profileSectionStorageKey(userId), JSON.stringify(next));
  } catch (_err) {
    // Ignore quota / private-mode errors.
  }
}

/**
 * @param {Record<string, string>} storedModes
 * @param {string} sectionKey
 * @param {boolean} narrativeAvailable
 */
function resolveSectionDisplayMode(storedModes, sectionKey, narrativeAvailable) {
  const stored = storedModes?.[sectionKey];
  if (stored === PROFILE_DISPLAY_MODE.NARRATIVE && narrativeAvailable) {
    return PROFILE_DISPLAY_MODE.NARRATIVE;
  }
  return PROFILE_DISPLAY_MODE.BULLETS;
}

module.exports = {
  WHO_ARE_YOU_PLACEHOLDER,
  PROFILE_DISPLAY_MODE,
  getWhoAreYouNarratives,
  hasIdentityNarrative,
  parseIdentityFieldToBullets,
  parseIdentityFieldForEdit,
  formatIdentityFieldFromEdit,
  identityFieldDraftHasContent,
  identitySectionKey,
  profileSectionStorageKey,
  readProfileSectionDisplayModes,
  persistProfileSectionDisplayMode,
  resolveSectionDisplayMode,
};
