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

const SUPPORTED_LANGS = ['en', 'de'];

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

/**
 * @param {object} profile - user.profile
 * @param {string} [language]
 * @returns {{ ready: boolean, pending: string[] }}
 */
function getProfileDisplayNarrativesReadiness(profile = {}, language = 'en') {
  const lang = normalizeLangCode(language, 'en');
  const pending = [];
  const structured = profile.structuredUserInfo || {};

  for (const key of STRUCTURED_DIMENSION_KEYS) {
    if (!isDimensionNarrativeReady(structured[key], lang)) {
      pending.push(`structuredUserInfo.${key}`);
    }
  }

  if (!isWhoAreYouNarrativeReady(profile.who_are_you || {}, lang)) {
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
  const contentReadiness = getProfileDisplayNarrativesReadiness(syntheticProfile, language);
  return {
    ready: pending.length === 0 && contentReadiness.ready,
    pending: [...pending, ...contentReadiness.pending],
  };
}

module.exports = {
  getProfileDisplayNarrativesReadiness,
  getDocumentNarrativeCacheReadiness,
  isWhoAreYouNarrativeReady,
  isDimensionNarrativeReady,
};
