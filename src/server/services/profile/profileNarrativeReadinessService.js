/**
 * Detect whether display-critical profile narratives are ready (not placeholders or low-quality fallbacks).
 */

const localizedContentService = require('../localization/localizedContentService');
const { EMPTY_PLACEHOLDER } = require('../jobAnalysis/dimensionSummaryGenerator');
const { PLACEHOLDER: WHO_ARE_YOU_PLACEHOLDER } = require('../jobAnalysis/whoAreYouNarrativeGenerator');
const { getRawItems, STRUCTURED_DIMENSION_KEYS } = require('./profileReviewSaveService');
const {
  meetsDimensionSummaryQuality,
  meetsWhoAreYouNarrativesQuality,
  isNarrativeCacheQualityVersionCurrent,
} = require('./narrativeQualityGate');
const {
  USER_IDENTITY_ANSWER_KEYS,
  normalizeUserIdentityAnswers,
  mergeProfileIdentityAnswers,
} = require('../embedding/userIdentityEmbeddingTextService');
const { overlayIdentityAnswersWithCvLocalization } = require('../documents/cvExtractLocalization');

const SUPPORTED_LANGS = ['en', 'de'];

function buildWhoAreYouRawAnswersFromIdentity(identityAnswers = {}) {
  const normalized = normalizeUserIdentityAnswers(identityAnswers || {});
  return USER_IDENTITY_ANSWER_KEYS.map((key) => String(normalized[key] || '').trim());
}

/**
 * Identity answers visible on GET /api/profile (CSI + userIdentityAnswers + cvExtractLocalization overlay).
 */
function getEffectiveIdentityAnswersForNarratives(profile = {}, language = 'en') {
  const merged = mergeProfileIdentityAnswers(profile);
  return overlayIdentityAnswersWithCvLocalization(
    merged,
    profile?.cvExtractLocalization?.userIdentity,
    language
  );
}

/**
 * DB profiles may store identity answers only on userIdentityAnswers while who_are_you.raw_answers
 * is empty — readiness checks must not treat that as "no answers".
 */
function enrichProfileForNarrativeChecks(profile = {}, language = 'en') {
  if (!profile || typeof profile !== 'object') return {};
  const identityRaw = buildWhoAreYouRawAnswersFromIdentity(
    getEffectiveIdentityAnswersForNarratives(profile, language)
  );
  const who = profile.who_are_you && typeof profile.who_are_you === 'object'
    ? { ...profile.who_are_you }
    : {};
  const storedRaw = Array.isArray(who.raw_answers)
    ? who.raw_answers.map((v) => String(v || '').trim())
    : [];
  if (!storedRaw.some(Boolean) && identityRaw.some(Boolean)) {
    return { ...profile, who_are_you: { ...who, raw_answers: identityRaw } };
  }
  return profile;
}

function normalizeLangCode(value, fallback = 'en') {
  const code = String(value || fallback).toLowerCase().split('-')[0] || fallback;
  return SUPPORTED_LANGS.includes(code) ? code : fallback;
}

function readDimensionSummaryText(value, language = 'en') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const lang = normalizeLangCode(language, 'en');
  if (typeof value.summary_text === 'string') {
    return String(value.summary_text).trim();
  }
  const summary = localizedContentService.get(value.summary_text, lang);
  if (typeof summary === 'string') return summary.trim();
  return '';
}

function isPlaceholderDimensionSummary(summaryText) {
  const s = String(summaryText || '').trim();
  return !s || s === EMPTY_PLACEHOLDER;
}

function parseWhoAreYouNarratives(summaryText = '') {
  const raw = String(summaryText || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/** True when a language slot has real narrative lines for answered identity slots. */
function isWhoAreYouSummaryDisplayReadyForLanguage(summaryField, rawAnswers = [], language = 'en') {
  const lang = normalizeLangCode(language, 'en');
  const answers = Array.isArray(rawAnswers) ? rawAnswers : [];
  if (!answers.some((v) => String(v || '').trim())) return true;
  const summaryRaw = String(localizedContentService.get(summaryField, lang) || '').trim();
  if (!summaryRaw) return false;
  const parsed = parseWhoAreYouNarratives(summaryRaw);
  if (parsed.length !== 5) return false;
  for (let idx = 0; idx < 5; idx += 1) {
    if (!String(answers[idx] || '').trim()) continue;
    const line = String(parsed[idx] || '').trim();
    if (!line || line === WHO_ARE_YOU_PLACEHOLDER) return false;
  }
  return true;
}

function isWhoAreYouNarrativeReady(whoAreYou = {}, language = 'en') {
  const lang = normalizeLangCode(language, 'en');
  const rawAnswers = Array.isArray(whoAreYou.raw_answers) ? whoAreYou.raw_answers : [];
  if (!rawAnswers.some((v) => String(v || '').trim())) {
    return true;
  }
  const summaryRaw = String(localizedContentService.get(whoAreYou.summary_text, lang) || '').trim();
  if (!summaryRaw) return false;
  const parsed = parseWhoAreYouNarratives(summaryRaw);
  if (parsed.length !== 5) return false;
  if (!parsed.some((line) => {
    const t = String(line || '').trim();
    return t && t !== WHO_ARE_YOU_PLACEHOLDER;
  })) {
    return false;
  }
  return meetsWhoAreYouNarrativesQuality(parsed, rawAnswers);
}

function isDimensionNarrativeReady(dimensionValue, language = 'en') {
  const rawItems = getRawItems(dimensionValue);
  if (rawItems.length === 0) return true;
  const summaryText = readDimensionSummaryText(dimensionValue, language);
  if (isPlaceholderDimensionSummary(summaryText)) return false;
  return meetsDimensionSummaryQuality(summaryText, rawItems);
}

/** Display polling: any persisted non-placeholder summary is enough to stop the loading state. */
function isDimensionNarrativeDisplayReady(dimensionValue, language = 'en') {
  const rawItems = getRawItems(dimensionValue);
  if (rawItems.length === 0) return true;
  const summaryText = readDimensionSummaryText(dimensionValue, language);
  return !isPlaceholderDimensionSummary(summaryText);
}

/** Display polling: each answered slot needs a non-placeholder narrative line. */
function isWhoAreYouNarrativeDisplayReady(whoAreYou = {}, language = 'en') {
  const lang = normalizeLangCode(language, 'en');
  const rawAnswers = Array.isArray(whoAreYou.raw_answers) ? whoAreYou.raw_answers : [];
  return isWhoAreYouSummaryDisplayReadyForLanguage(whoAreYou.summary_text, rawAnswers, lang);
}

/**
 * @param {object} profile - user.profile
 * @param {string} [language]
 * @returns {{ ready: boolean, pending: string[] }}
 */
function getProfileDisplayNarrativesReadiness(profile = {}, language = 'en') {
  const enriched = enrichProfileForNarrativeChecks(profile, language);
  const lang = normalizeLangCode(language, 'en');
  const pending = [];
  const structured = enriched.structuredUserInfo || {};

  for (const key of STRUCTURED_DIMENSION_KEYS) {
    if (!isDimensionNarrativeDisplayReady(structured[key], lang)) {
      pending.push(`structuredUserInfo.${key}`);
    }
  }

  if (!isWhoAreYouNarrativeDisplayReady(enriched.who_are_you || {}, lang)) {
    pending.push('who_are_you');
  }

  return { ready: pending.length === 0, pending };
}

function getProfileNarrativeQualityReadiness(profile = {}, language = 'en') {
  const enriched = enrichProfileForNarrativeChecks(profile, language);
  const lang = normalizeLangCode(language, 'en');
  const pending = [];
  const structured = enriched.structuredUserInfo || {};

  for (const key of STRUCTURED_DIMENSION_KEYS) {
    if (!isDimensionNarrativeReady(structured[key], lang)) {
      pending.push(`structuredUserInfo.${key}`);
    }
  }

  if (!isWhoAreYouNarrativeReady(enriched.who_are_you || {}, lang)) {
    pending.push('who_are_you');
  }

  return { ready: pending.length === 0, pending };
}

/**
 * @param {object} doc - embedded document subdoc
 * @returns {{ ready: boolean, pending: string[] }}
 */
function getDocumentNarrativeCacheReadiness(doc, language = 'en') {
  if (!doc?.narrativeEnrichment?.structuredUserInfo) {
    return { ready: false, pending: ['narrativeEnrichment'] };
  }
  const pending = [];
  if (!isNarrativeCacheQualityVersionCurrent(doc.narrativeEnrichment)) {
    pending.push('narrativeEnrichment.qualityVersion');
  }
  const syntheticProfile = {
    structuredUserInfo: doc.narrativeEnrichment.structuredUserInfo,
    who_are_you: doc.narrativeEnrichment.who_are_you || {},
  };
  const contentReadiness = getProfileNarrativeQualityReadiness(syntheticProfile, language);
  return {
    ready: pending.length === 0 && contentReadiness.ready,
    pending: [...pending, ...contentReadiness.pending],
  };
}

module.exports = {
  buildWhoAreYouRawAnswersFromIdentity,
  getEffectiveIdentityAnswersForNarratives,
  enrichProfileForNarrativeChecks,
  isWhoAreYouSummaryDisplayReadyForLanguage,
  getProfileDisplayNarrativesReadiness,
  getProfileNarrativeQualityReadiness,
  getDocumentNarrativeCacheReadiness,
  isWhoAreYouNarrativeReady,
  isWhoAreYouNarrativeDisplayReady,
  isDimensionNarrativeReady,
  isDimensionNarrativeDisplayReady,
};
