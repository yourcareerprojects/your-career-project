const {
  normalizeUserIdentityAnswers,
  USER_IDENTITY_ANSWER_KEYS,
} = require('../embedding/userIdentityEmbeddingTextService');
const localizedContentService = require('../localization/localizedContentService');
const { filterIndustryDomainRawItems } = require('../../constants/industryDomainFilters');

function mergeUniqueStrings(a = [], b = []) {
  return [...new Set([...(a || []), ...(b || [])].map((v) => String(v || '').trim()).filter(Boolean))];
}

function getRawItems(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.raw_items)) return value.raw_items;
  return [];
}

const STRUCTURED_DIMENSION_KEYS = [
  'skillDomains',
  'skills',
  'skillsInDevelopment',
  'keyResponsibilities',
  'domains',
];

/** True when stored summary_text can be read for the given language (matches normalize path). */
function canReuseDimensionNarrative(dimensionValue, language = 'en') {
  if (!dimensionValue || typeof dimensionValue !== 'object') return false;
  if (!Array.isArray(dimensionValue.raw_items)) return false;
  if (!dimensionValue.summary_text) return false;
  const lang = String(language || 'en').toLowerCase().split('-')[0] || 'en';
  const summaryText = String(localizedContentService.get(dimensionValue.summary_text, lang) || '').trim();
  return summaryText.length > 0;
}

function structuredRawListsEqual(left = [], right = []) {
  const a = (Array.isArray(left) ? left : []).map((v) => String(v || '').trim()).filter(Boolean);
  const b = (Array.isArray(right) ? right : []).map((v) => String(v || '').trim()).filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function extractKeyResponsibilities(structuredUserInfo = {}) {
  if (Array.isArray(structuredUserInfo.keyResponsibilities) && structuredUserInfo.keyResponsibilities.length > 0) {
    return structuredUserInfo.keyResponsibilities.filter(Boolean);
  }
  if (Array.isArray(structuredUserInfo.workExperience)) {
    return structuredUserInfo.workExperience
      .map((item) => String(item?.description || '').trim())
      .filter(Boolean);
  }
  return [];
}

function buildMergedStructuredPayload(existingStructured = {}, incomingStructured = {}, mode = 'merge') {
  const merge = mode === 'merge';
  const incoming = incomingStructured && typeof incomingStructured === 'object' ? incomingStructured : {};

  const incomingSkillDomains = Array.isArray(incoming.skillDomains) ? incoming.skillDomains.filter(Boolean) : [];
  const incomingSkills = Array.isArray(incoming.skills)
    ? incoming.skills.map((skill) => (typeof skill === 'string' ? skill : skill?.name)).filter(Boolean)
    : [];
  const incomingSkillsInDevelopment = Array.isArray(incoming.skillsInDevelopment)
    ? incoming.skillsInDevelopment.filter(Boolean)
    : [];
  const incomingKeyResponsibilities = extractKeyResponsibilities(incoming);
  const incomingDomains = Array.isArray(incoming.domains) ? incoming.domains.filter(Boolean) : [];

  return {
    skillDomains: merge
      ? mergeUniqueStrings(getRawItems(existingStructured.skillDomains), incomingSkillDomains)
      : incomingSkillDomains,
    skills: merge
      ? mergeUniqueStrings(getRawItems(existingStructured.skills), incomingSkills)
      : incomingSkills,
    skillsInDevelopment: merge
      ? mergeUniqueStrings(getRawItems(existingStructured.skillsInDevelopment), incomingSkillsInDevelopment)
      : incomingSkillsInDevelopment,
    keyResponsibilities: merge
      ? mergeUniqueStrings(getRawItems(existingStructured.keyResponsibilities), incomingKeyResponsibilities)
      : incomingKeyResponsibilities,
    domains: merge
      ? mergeUniqueStrings(getRawItems(existingStructured.domains), incomingDomains)
      : incomingDomains,
  };
}

/**
 * Merges structured lists and reuses existing narrative summaries when raw_items are unchanged.
 * Lets review-save skip LLM regeneration (forceRegenerate: false) on merge/full-update.
 */
function buildMergedStructuredPayloadForNormalization(
  existingStructured = {},
  incomingStructured = {},
  mode = 'merge'
) {
  const mergedArrays = buildMergedStructuredPayload(existingStructured, incomingStructured, mode);
  const existing = existingStructured && typeof existingStructured === 'object' ? existingStructured : {};
  const out = {};
  for (const key of STRUCTURED_DIMENSION_KEYS) {
    const mergedRaw = Array.isArray(mergedArrays[key]) ? mergedArrays[key] : [];
    const existingDim = existing[key];
    const mergedComparable = key === 'domains' ? filterIndustryDomainRawItems(mergedRaw) : mergedRaw;
    const existingComparable =
      key === 'domains' ? filterIndustryDomainRawItems(getRawItems(existingDim)) : getRawItems(existingDim);
    if (
      structuredRawListsEqual(mergedComparable, existingComparable)
      && canReuseDimensionNarrative(existingDim)
    ) {
      out[key] = {
        raw_items: mergedRaw,
        summary_text: existingDim.summary_text,
      };
    } else {
      out[key] = mergedRaw;
    }
  }
  return out;
}

function buildMergedUserIdentity(existingIdentity = {}, incomingIdentity = {}, mode = 'merge') {
  const existing = normalizeUserIdentityAnswers(existingIdentity || {});
  const incoming = normalizeUserIdentityAnswers(incomingIdentity || {});

  if (mode !== 'merge') {
    return USER_IDENTITY_ANSWER_KEYS.reduce((acc, key) => {
      acc[key] = String(incoming[key] || '').trim();
      return acc;
    }, {});
  }

  return USER_IDENTITY_ANSWER_KEYS.reduce((acc, key) => {
    acc[key] = String(incoming[key] || existing[key] || '').trim();
    return acc;
  }, {});
}

function normalizeSeniorityFields(seniority = {}) {
  const currentStatus = seniority.currentStatus ? String(seniority.currentStatus).trim() : '';
  const highestDegree = seniority.highestDegree ? String(seniority.highestDegree).trim() : '';
  const mostSeniorWorkExperience = seniority.mostSeniorWorkExperience
    ? String(seniority.mostSeniorWorkExperience).trim()
    : '';

  let yearsOfExperience = null;
  if (
    seniority.yearsOfExperience !== undefined
    && seniority.yearsOfExperience !== null
    && seniority.yearsOfExperience !== ''
  ) {
    const val = parseInt(seniority.yearsOfExperience, 10);
    yearsOfExperience = (val >= 0 && val <= 50) ? val : null;
  }

  return {
    currentStatus,
    yearsOfExperience,
    highestDegree,
    mostSeniorWorkExperience,
  };
}

function applySeniorityToUser(user, normalizedSeniority) {
  if (!user.profile.seniority) user.profile.seniority = {};
  user.profile.seniority.currentStatus = normalizedSeniority.currentStatus;
  user.profile.seniority.yearsOfExperience = normalizedSeniority.yearsOfExperience;
  user.profile.seniority.highestDegree = normalizedSeniority.highestDegree;
  user.profile.seniority.mostSeniorWorkExperience = normalizedSeniority.mostSeniorWorkExperience;
  user.markModified('profile.seniority');
}

function readSeniorityFromProfile(profile = {}) {
  const seniority = profile.seniority || {};
  return {
    currentStatus: seniority.currentStatus || '',
    yearsOfExperience: seniority.yearsOfExperience ?? null,
    highestDegree: seniority.highestDegree || '',
    mostSeniorWorkExperience: seniority.mostSeniorWorkExperience || '',
  };
}

function verifySeniorityPersisted(storedSeniority, expectedSeniority) {
  const stored = readSeniorityFromProfile({ seniority: storedSeniority });
  return (
    stored.currentStatus === expectedSeniority.currentStatus
    && stored.yearsOfExperience === expectedSeniority.yearsOfExperience
    && stored.highestDegree === expectedSeniority.highestDegree
    && stored.mostSeniorWorkExperience === expectedSeniority.mostSeniorWorkExperience
  );
}

module.exports = {
  STRUCTURED_DIMENSION_KEYS,
  mergeUniqueStrings,
  getRawItems,
  canReuseDimensionNarrative,
  structuredRawListsEqual,
  extractKeyResponsibilities,
  buildMergedStructuredPayload,
  buildMergedStructuredPayloadForNormalization,
  buildMergedUserIdentity,
  normalizeSeniorityFields,
  applySeniorityToUser,
  readSeniorityFromProfile,
  verifySeniorityPersisted,
};
