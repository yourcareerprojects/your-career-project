/**
 * Feature flag: batched CV narrative orchestration entry point.
 * Both batched and legacy paths use the production-quality generators
 * (generateDimensionSummary + generateWhoAreYouNarratives).
 */

function isCvNarrativeBatchEnabled() {
  const raw = typeof process !== 'undefined' ? process.env?.CV_NARRATIVE_BATCH : undefined;
  const v = String(raw || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Rough per-call latency for legacy-vs-batch delta estimates (ms). */
const CV_NARRATIVE_LEGACY_CALL_ESTIMATE_MS = 900;

module.exports = {
  isCvNarrativeBatchEnabled,
  CV_NARRATIVE_LEGACY_CALL_ESTIMATE_MS,
};
