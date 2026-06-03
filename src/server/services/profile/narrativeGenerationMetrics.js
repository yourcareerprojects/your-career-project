const { CV_NARRATIVE_LEGACY_CALL_ESTIMATE_MS } = require('../../../constants/cvNarrativeBatch');
const logger = require('../../utils/logger');

const STRUCTURED_DIMENSION_KEYS = [
  'skillDomains',
  'skills',
  'skillsInDevelopment',
  'keyResponsibilities',
  'domains',
];

/**
 * Estimate legacy OpenAI calls: per populated dimension (generate + translate) + who (generate + translate) + embedding.
 *
 * @param {{ lists?: Record<string, string[]>, rawAnswers?: string[], onlyDimensionKeys?: string[], includeWhoAreYou?: boolean, includeEmbedding?: boolean }} params
 */
function estimateLegacyOpenAiCallCount({
  lists = {},
  rawAnswers = [],
  onlyDimensionKeys = null,
  includeWhoAreYou = true,
  includeEmbedding = true,
} = {}) {
  const keys = Array.isArray(onlyDimensionKeys) && onlyDimensionKeys.length > 0
    ? onlyDimensionKeys
    : STRUCTURED_DIMENSION_KEYS;
  let count = 0;
  for (const key of keys) {
    const items = Array.isArray(lists[key]) ? lists[key].filter((v) => String(v || '').trim()) : [];
    if (items.length > 0) count += 2;
  }
  const hasWho = includeWhoAreYou && (Array.isArray(rawAnswers) ? rawAnswers : []).some((v) => String(v || '').trim());
  if (hasWho) {
    count += 2;
    if (includeEmbedding) count += 1;
  }
  return count;
}

/**
 * @param {{
 *   batchEnabled: boolean,
 *   previousOpenAICallCount: number,
 *   newOpenAICallCount: number,
 *   latencyMs: number,
 *   documentId?: string,
 *   userId?: string,
 *   incremental?: boolean,
 * }} fields
 */
function logNarrativeGenerationMetrics(fields = {}) {
  const previousOpenAICallCount = Number(fields.previousOpenAICallCount) || 0;
  const newOpenAICallCount = Number(fields.newOpenAICallCount) || 0;
  const latencyMs = Number(fields.latencyMs) || 0;
  const estimatedLegacyLatencyMs = previousOpenAICallCount * CV_NARRATIVE_LEGACY_CALL_ESTIMATE_MS;
  const latencyDeltaMs = Math.round(estimatedLegacyLatencyMs - latencyMs);

  logger.info('cv_narrative_generation_metrics', {
    batchEnabled: Boolean(fields.batchEnabled),
    previousOpenAICallCount,
    newOpenAICallCount,
    latencyMs: Math.round(latencyMs),
    latencyDeltaMs,
    estimatedLegacyLatencyMs,
    documentId: fields.documentId ? String(fields.documentId).slice(0, 32) : undefined,
    userId: fields.userId ? String(fields.userId).slice(0, 32) : undefined,
    incremental: Boolean(fields.incremental),
  });
}

module.exports = {
  estimateLegacyOpenAiCallCount,
  logNarrativeGenerationMetrics,
  STRUCTURED_DIMENSION_KEYS,
};
