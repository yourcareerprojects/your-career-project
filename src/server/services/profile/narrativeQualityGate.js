/**
 * Detect low-quality profile narratives (deterministic fallbacks, unified-batch one-liners).
 * Used by cache readiness so stale bad document caches are not copied to the profile.
 */

const { buildDeterministicFallback, EMPTY_PLACEHOLDER } = require('../jobAnalysis/dimensionSummaryGenerator');
const { PLACEHOLDER: WHO_ARE_YOU_PLACEHOLDER } = require('../jobAnalysis/whoAreYouNarrativeGenerator');
const { NARRATIVE_CACHE_QUALITY_VERSION } = require('../../../constants/narrativeCacheQuality');
const { normalizeStructuredListItemLabel } = require('../../../constants/structuredListItemLabel');

const WHO_DETERMINISTIC_PREFIX = 'You describe yourself as ';

/** Minimum polished dimension summary length by raw-item count. */
const MIN_DIMENSION_SUMMARY_LENGTH = {
  1: 55,
  2: 90,
  default: 100,
};

function normalizeRawItems(rawItems = []) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((v) => normalizeStructuredListItemLabel(v))
    .filter(Boolean);
}

function countSentences(text = '') {
  return String(text || '')
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .length;
}

function isDeterministicDimensionSummary(summaryText, rawItems = []) {
  const text = String(summaryText || '').trim();
  if (!text || text === EMPTY_PLACEHOLDER) return true;
  const items = normalizeRawItems(rawItems);
  if (items.length === 0) return false;
  try {
    return text === buildDeterministicFallback(items);
  } catch (_) {
    return false;
  }
}

function meetsDimensionSummaryQuality(summaryText, rawItems = []) {
  const text = String(summaryText || '').trim();
  const items = normalizeRawItems(rawItems);
  if (items.length === 0) {
    return !text || text === EMPTY_PLACEHOLDER;
  }
  if (!text || text === EMPTY_PLACEHOLDER) return false;
  if (isDeterministicDimensionSummary(text, items)) return false;

  const minLen = MIN_DIMENSION_SUMMARY_LENGTH[items.length]
    || MIN_DIMENSION_SUMMARY_LENGTH.default;
  if (text.length < minLen) return false;

  if (items.length >= 2 && countSentences(text) < 2) return false;

  return true;
}

function isDeterministicWhoAreYouLine(narrativeLine, rawAnswer = '') {
  const line = String(narrativeLine || '').trim();
  const raw = String(rawAnswer || '').trim();
  if (!line || line === WHO_ARE_YOU_PLACEHOLDER) return true;
  if (!raw) return false;
  if (line === raw) return true;
  if (line === `${WHO_DETERMINISTIC_PREFIX}${raw.replace(/[.?!]+$/, '')}.`) return true;
  if (line.startsWith(WHO_DETERMINISTIC_PREFIX) && raw.length < 30) return true;
  return false;
}

function meetsWhoAreYouLineQuality(narrativeLine, rawAnswer = '') {
  const raw = String(rawAnswer || '').trim();
  if (!raw) return true;
  const line = String(narrativeLine || '').trim();
  if (!line || line === WHO_ARE_YOU_PLACEHOLDER) return false;
  if (line === raw) return true;
  if (isDeterministicWhoAreYouLine(line, raw)) return false;
  if (raw.length >= 15 && line.length < 80) return false;
  if (countSentences(line) < 2 && line.length < 120) return false;
  return true;
}

function meetsWhoAreYouNarrativesQuality(narrativeLines = [], rawAnswers = []) {
  const lines = Array.isArray(narrativeLines) ? narrativeLines : [];
  const answers = Array.isArray(rawAnswers) ? rawAnswers : [];
  if (!answers.some((v) => String(v || '').trim())) return true;
  if (lines.length !== 5) return false;
  for (let i = 0; i < 5; i += 1) {
    if (!meetsWhoAreYouLineQuality(lines[i], answers[i])) return false;
  }
  return true;
}

function isNarrativeCacheQualityVersionCurrent(enrichment = {}) {
  return Number(enrichment?.qualityVersion) >= NARRATIVE_CACHE_QUALITY_VERSION;
}

function stampNarrativeEnrichmentQuality(enrichment = {}) {
  return {
    ...enrichment,
    qualityVersion: NARRATIVE_CACHE_QUALITY_VERSION,
  };
}

module.exports = {
  NARRATIVE_CACHE_QUALITY_VERSION,
  meetsDimensionSummaryQuality,
  meetsWhoAreYouLineQuality,
  meetsWhoAreYouNarrativesQuality,
  isDeterministicDimensionSummary,
  isDeterministicWhoAreYouLine,
  isNarrativeCacheQualityVersionCurrent,
  stampNarrativeEnrichmentQuality,
};
