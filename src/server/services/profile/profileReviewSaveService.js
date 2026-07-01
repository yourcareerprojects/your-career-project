const {
  normalizeUserIdentityAnswers,
  USER_IDENTITY_ANSWER_KEYS,
} = require('../embedding/userIdentityEmbeddingTextService');
const localizedContentService = require('../localization/localizedContentService');
const { EMPTY_PLACEHOLDER } = require('../jobAnalysis/dimensionSummaryGenerator');
const { filterIndustryDomainRawItems } = require('../../constants/industryDomainFilters');
const { normalizeIndustryDomains } = require('../../../constants/industries');
const { getProfileStructuredListMaxItems } = require('../../../constants/profileReviewFieldLimits');
const { normalizeStructuredListItemLabel, normalizeStructuredListItemLabels } = require('../../../constants/structuredListItemLabel');
const { meetsDimensionSummaryQuality } = require('./narrativeQualityGate');
const { isMinorStructuredListEdit } = require('./identityAnswerChangeClassifier');

function mergeUniqueStrings(a = [], b = []) {
  return [...new Set(
    [...(a || []), ...(b || [])]
      .map((v) => normalizeStructuredListItemLabel(v))
      .filter(Boolean)
  )];
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
  return meetsDimensionSummaryQuality(summaryText, dimensionValue.raw_items);
}

function structuredRawListsEqual(left = [], right = []) {
  const a = (Array.isArray(left) ? left : []).map((v) => String(v || '').trim()).filter(Boolean);
  const b = (Array.isArray(right) ? right : []).map((v) => String(v || '').trim()).filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function comparableRawListForDimension(key, rawList = []) {
  const list = Array.isArray(rawList) ? rawList : [];
  if (key === 'domains') {
    return normalizeIndustryDomains(
      filterIndustryDomainRawItems(normalizeStructuredListItemLabels(list)),
      { keepUnknown: true }
    );
  }
  return normalizeStructuredListItemLabels(list);
}

function isAcceptedField(acceptedFields, fieldKey) {
  if (!acceptedFields || typeof acceptedFields !== 'object') return true;
  return acceptedFields[fieldKey] !== false;
}

/**
 * Effective structured lists from CV extraction + review checkboxes (mirrors client buildStructuredGoodAtFromReview).
 *
 * @param {object} extractedProfileData
 * @param {Record<string, boolean>} [acceptedFields]
 * @returns {{ lists: Record<string, string[]>, userIdentity: Record<string, string> }}
 */
function buildStructuredBaselineFromExtraction(extractedProfileData = {}, acceptedFields = {}) {
  const structuredUserInfo = extractedProfileData?.structuredUserInfo || {};
  const pickStrings = (key) => {
    const maxItems = getProfileStructuredListMaxItems(key);
    const items = structuredUserInfo[key] || [];
    const out = [];
    for (let i = 0; i < items.length && out.length < maxItems; i += 1) {
      if (!isAcceptedField(acceptedFields, `structuredUserInfo.${key}.${i}`)) continue;
      const v = normalizeStructuredListItemLabel(items[i]);
      if (v) out.push(v);
    }
    return out;
  };

  const skillItems = structuredUserInfo.skills || [];
  const skillsOut = [];
  const skillsMax = getProfileStructuredListMaxItems('skills');
  for (let i = 0; i < skillItems.length && skillsOut.length < skillsMax; i += 1) {
    if (!isAcceptedField(acceptedFields, `structuredUserInfo.skills.${i}`)) continue;
    const v = normalizeStructuredListItemLabel(skillItems[i]);
    if (v) skillsOut.push(v);
  }

  let keyResponsibilities = pickStrings('keyResponsibilities');
  if (keyResponsibilities.length === 0) {
    keyResponsibilities = extractKeyResponsibilities(structuredUserInfo);
  }

  return {
    lists: {
      skillDomains: pickStrings('skillDomains'),
      skills: skillsOut,
      skillsInDevelopment: pickStrings('skillsInDevelopment'),
      keyResponsibilities,
      domains: pickStrings('domains'),
    },
    userIdentity: normalizeUserIdentityAnswers(extractedProfileData?.userIdentity || {}),
  };
}

function normalizeIncomingStructuredLists(incomingStructured = {}) {
  const incoming = incomingStructured && typeof incomingStructured === 'object' ? incomingStructured : {};
  const incomingSkills = Array.isArray(incoming.skills)
    ? incoming.skills.map((skill) => normalizeStructuredListItemLabel(skill)).filter(Boolean)
    : [];
  return {
    skillDomains: Array.isArray(incoming.skillDomains)
      ? normalizeStructuredListItemLabels(incoming.skillDomains)
      : [],
    skills: incomingSkills,
    skillsInDevelopment: Array.isArray(incoming.skillsInDevelopment)
      ? normalizeStructuredListItemLabels(incoming.skillsInDevelopment)
      : [],
    keyResponsibilities: extractKeyResponsibilities(incoming),
    domains: Array.isArray(incoming.domains)
      ? normalizeStructuredListItemLabels(incoming.domains)
      : [],
  };
}

function userIdentityMatchesExtraction(incomingIdentity = {}, extractionIdentity = {}) {
  const a = normalizeUserIdentityAnswers(incomingIdentity);
  const b = normalizeUserIdentityAnswers(extractionIdentity);
  return USER_IDENTITY_ANSWER_KEYS.every((key) => (a[key] || '') === (b[key] || ''));
}

/**
 * Dimensions whose incoming lists match extraction baseline and do not already reuse stored narratives.
 *
 * @param {object} params
 * @returns {string[]}
 */
function resolveDeferDimensionKeysForExtraction({
  existingStructured = {},
  incomingStructured = {},
  extractionBaseline = null,
  mode = 'merge',
}) {
  if (!extractionBaseline?.lists) return [];
  const incomingLists = normalizeIncomingStructuredLists(incomingStructured);
  const deferKeys = [];

  for (const key of STRUCTURED_DIMENSION_KEYS) {
    const incomingComparable = comparableRawListForDimension(key, incomingLists[key]);
    const extractionComparable = comparableRawListForDimension(key, extractionBaseline.lists[key]);
    if (!structuredRawListsEqual(incomingComparable, extractionComparable)) continue;

    const mergedArrays = buildMergedStructuredPayload(existingStructured, incomingStructured, mode);
    const mergedComparable = comparableRawListForDimension(key, mergedArrays[key]);
    const existingDim = existingStructured[key];
    const existingComparable = comparableRawListForDimension(key, getRawItems(existingDim));

    if (
      structuredRawListsEqual(mergedComparable, existingComparable)
      && canReuseDimensionNarrative(existingDim)
    ) {
      continue;
    }
    deferKeys.push(key);
  }
  return deferKeys;
}

/**
 * @param {object} extractedProfile
 * @param {Record<string, boolean>} [acceptedFields]
 * @returns {{ lists: Record<string, string[]>, userIdentity: Record<string, string> } | null}
 */
function loadExtractionBaselineFromDocument(doc, acceptedFields = {}) {
  if (!doc?.extractedProfileData || typeof doc.extractedProfileData !== 'object') return null;
  return buildStructuredBaselineFromExtraction(doc.extractedProfileData, acceptedFields);
}

/**
 * Dimension keys in merged normalize payload that still need LLM (plain arrays, no summary_text).
 *
 * @param {object} mergedPayload
 * @returns {string[]}
 */
function resolveDimensionKeysNeedingLlmRegeneration(mergedPayload = {}) {
  const input = mergedPayload && typeof mergedPayload === 'object' ? mergedPayload : {};
  return STRUCTURED_DIMENSION_KEYS.filter((key) => {
    const value = input[key];
    if (Array.isArray(value)) return true;
    if (!value || typeof value !== 'object') return false;
    return !value.summary_text;
  });
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

  const incomingSkillDomains = Array.isArray(incoming.skillDomains)
    ? normalizeStructuredListItemLabels(incoming.skillDomains)
    : [];
  const incomingSkills = Array.isArray(incoming.skills)
    ? normalizeStructuredListItemLabels(incoming.skills)
    : [];
  const incomingSkillsInDevelopment = Array.isArray(incoming.skillsInDevelopment)
    ? normalizeStructuredListItemLabels(incoming.skillsInDevelopment)
    : [];
  const incomingKeyResponsibilities = extractKeyResponsibilities(incoming);
  const incomingDomains = Array.isArray(incoming.domains)
    ? normalizeStructuredListItemLabels(incoming.domains)
    : [];

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
  mode = 'merge',
  options = {}
) {
  const {
    extractionNarrativeCache = null,
    reuseExtractionNarrativeKeys = [],
  } = options;
  const reuseSet = new Set(Array.isArray(reuseExtractionNarrativeKeys) ? reuseExtractionNarrativeKeys : []);
  const cachedStructured = extractionNarrativeCache?.structuredUserInfo || {};

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
      continue;
    }
    if (
      isMinorStructuredListEdit(existingComparable, mergedComparable)
      && canReuseDimensionNarrative(existingDim)
    ) {
      out[key] = {
        raw_items: mergedRaw,
        summary_text: existingDim.summary_text,
      };
      continue;
    }
    if (reuseSet.has(key) && cachedStructured[key]?.summary_text) {
      const cachedDim = {
        raw_items: mergedRaw,
        summary_text: cachedStructured[key].summary_text,
      };
      if (canReuseDimensionNarrative(cachedDim)) {
        out[key] = cachedDim;
        continue;
      }
    }
    out[key] = mergedRaw;
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
  comparableRawListForDimension,
  extractKeyResponsibilities,
  buildMergedStructuredPayload,
  buildMergedStructuredPayloadForNormalization,
  buildStructuredBaselineFromExtraction,
  normalizeIncomingStructuredLists,
  userIdentityMatchesExtraction,
  resolveDeferDimensionKeysForExtraction,
  resolveReuseExtractionNarrativeKeys: resolveDeferDimensionKeysForExtraction,
  resolveDimensionKeysNeedingLlmRegeneration,
  loadExtractionBaselineFromDocument,
  buildMergedUserIdentity,
  normalizeSeniorityFields,
  applySeniorityToUser,
  readSeniorityFromProfile,
  verifySeniorityPersisted,
};
