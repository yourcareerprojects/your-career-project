/**
 * Shared CV extraction timing — keep frontend polling UX, worker stale reclaim,
 * and status `estimatedState` aligned. Override via env on the server where noted.
 */

/** Typical end-to-end extraction completes within this window under normal load. */
const EXTRACTION_EXPECTED_MS = 3 * 60 * 1000;

/** UI may show “taking longer than expected” after this (not a failure). */
const EXTRACTION_SLOW_WARNING_MS = 5 * 60 * 1000;

/**
 * Worker reclaims jobs stuck in `processing` longer than this (env: CV_EXTRACTION_STALE_PROCESSING_MS).
 * Default 90 minutes — must exceed frontend slow-warning; frontend never treats elapsed time as failure.
 */
const EXTRACTION_STALE_MS_DEFAULT = 90 * 60 * 1000;

/** Upper bound for a single worker attempt before stale reclaim (same as stale by default). */
const EXTRACTION_MAX_RUNTIME_MS_DEFAULT = EXTRACTION_STALE_MS_DEFAULT;

/** Client adaptive poll: frequent phase (≈2–3s). */
const POLL_INTERVAL_FAST_MIN_MS = 2000;
const POLL_INTERVAL_FAST_MAX_MS = 3000;

/** Mid backoff (≈5s). */
const POLL_INTERVAL_MID_MS = 5000;

/** Slow backoff (≈10s). */
const POLL_INTERVAL_SLOW_MS = 10000;

/** Maximum poll interval while job remains in-flight. */
const POLL_INTERVAL_MAX_MS = 20000;

/** Client stops polling after this duration even if the job is still queued/processing (env: CV_EXTRACTION_POLL_MAX_MS). */
const EXTRACTION_POLL_MAX_DURATION_MS_DEFAULT = 15 * 60 * 1000;

/** Elapsed time thresholds for client poll backoff tiers (derived from slow warning). */
const POLL_BACKOFF_MID_AFTER_MS = EXTRACTION_EXPECTED_MS;
const POLL_BACKOFF_SLOW_AFTER_MS = EXTRACTION_SLOW_WARNING_MS;
const POLL_BACKOFF_MAX_AFTER_MS = EXTRACTION_SLOW_WARNING_MS * 2;

function readPositiveIntEnv(name, fallback) {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getExtractionStaleMs() {
  return readPositiveIntEnv('CV_EXTRACTION_STALE_PROCESSING_MS', EXTRACTION_STALE_MS_DEFAULT);
}

function getExtractionMaxRuntimeMs() {
  return readPositiveIntEnv('CV_EXTRACTION_MAX_RUNTIME_MS', EXTRACTION_MAX_RUNTIME_MS_DEFAULT);
}

function getExtractionPollMaxDurationMs() {
  return readPositiveIntEnv('CV_EXTRACTION_POLL_MAX_MS', EXTRACTION_POLL_MAX_DURATION_MS_DEFAULT);
}

/**
 * @param {number} elapsedMs
 * @returns {number} delay before next poll
 */
function getAdaptivePollDelayMs(elapsedMs) {
  if (elapsedMs < POLL_BACKOFF_MID_AFTER_MS) {
    return (
      POLL_INTERVAL_FAST_MIN_MS
      + Math.floor(Math.random() * (POLL_INTERVAL_FAST_MAX_MS - POLL_INTERVAL_FAST_MIN_MS + 1))
    );
  }
  if (elapsedMs < POLL_BACKOFF_SLOW_AFTER_MS) {
    return POLL_INTERVAL_MID_MS;
  }
  if (elapsedMs < POLL_BACKOFF_MAX_AFTER_MS) {
    return POLL_INTERVAL_SLOW_MS;
  }
  return POLL_INTERVAL_MAX_MS;
}

/**
 * @param {number} elapsedMs
 * @param {{ isRequeued?: boolean }} [opts]
 * @returns {'normal'|'delayed'|'retrying'}
 */
function computeEstimatedState(elapsedMs, opts = {}) {
  if (opts.isRequeued) return 'retrying';
  if (elapsedMs >= EXTRACTION_SLOW_WARNING_MS) return 'delayed';
  return 'normal';
}

module.exports = {
  EXTRACTION_EXPECTED_MS,
  EXTRACTION_SLOW_WARNING_MS,
  EXTRACTION_STALE_MS_DEFAULT,
  EXTRACTION_MAX_RUNTIME_MS_DEFAULT,
  POLL_INTERVAL_FAST_MIN_MS,
  POLL_INTERVAL_FAST_MAX_MS,
  POLL_INTERVAL_MID_MS,
  POLL_INTERVAL_SLOW_MS,
  POLL_INTERVAL_MAX_MS,
  POLL_BACKOFF_MID_AFTER_MS,
  POLL_BACKOFF_SLOW_AFTER_MS,
  POLL_BACKOFF_MAX_AFTER_MS,
  EXTRACTION_POLL_MAX_DURATION_MS_DEFAULT,
  getExtractionStaleMs,
  getExtractionMaxRuntimeMs,
  getExtractionPollMaxDurationMs,
  getAdaptivePollDelayMs,
  computeEstimatedState,
};
