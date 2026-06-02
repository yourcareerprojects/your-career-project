/**
 * Zombie job detection — aligned with cvExtractionTiming.js and backend stale reclaim.
 * Frontend polling, extraction-status API, and recovery UX share these rules.
 */
const {
  EXTRACTION_EXPECTED_MS,
  EXTRACTION_SLOW_WARNING_MS,
  POLL_BACKOFF_MAX_AFTER_MS,
} = require('./cvExtractionTiming');

/** Non-terminal job elapsed ≥ this → “slow” (info). Matches typical completion window. */
const EXTRACTION_SLOW_MS = EXTRACTION_EXPECTED_MS;

/** Non-terminal job elapsed ≥ this → “stuck” (warning + recovery actions). */
const EXTRACTION_STUCK_MS = POLL_BACKOFF_MAX_AFTER_MS;

/**
 * No `updatedAt` movement for this long while in-flight → treat as stuck (no progress).
 * Half of slow-warning so stage stalls surface before the full stuck threshold.
 */
const EXTRACTION_NO_PROGRESS_MS = Math.floor(EXTRACTION_SLOW_WARNING_MS / 2);

/** Public delay reason enum (user-safe, no internal codes). */
const EXTRACTION_DELAY_REASONS = {
  NORMAL: 'normal',
  SLOW: 'slow',
  SYSTEM_LOAD: 'system_load',
  NO_PROGRESS: 'no_progress',
  WORKER_UNAVAILABLE: 'worker_unavailable',
  RETRYING: 'retrying',
};

/** Aggregated worker signal exposed to clients (never raw heartbeat details). */
const WORKER_HEALTH_SIGNALS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
};

const TERMINAL_STATUSES = new Set(['completed', 'failed']);

/**
 * Map internal worker availability to a public health signal.
 * @param {'healthy'|'stale'|'missing'|null|undefined} availability
 * @returns {'healthy'|'degraded'|'unavailable'|null}
 */
function mapWorkerAvailabilityToSignal(availability) {
  if (availability === 'healthy') return WORKER_HEALTH_SIGNALS.HEALTHY;
  if (availability === 'stale') return WORKER_HEALTH_SIGNALS.DEGRADED;
  if (availability === 'missing') return WORKER_HEALTH_SIGNALS.UNAVAILABLE;
  return null;
}

/**
 * @param {object} params
 * @param {'queued'|'processing'|'completed'|'failed'} params.status
 * @param {number} params.elapsedMs
 * @param {number} [params.noProgressMs] ms since last job/doc update
 * @param {boolean} [params.isRequeued]
 * @param {'healthy'|'degraded'|'unavailable'|null} [params.workerHealthSignal]
 * @returns {{
 *   isSlow: boolean,
 *   isStuck: boolean,
 *   estimatedDelayReason: string|null,
 *   workerHealthSignal: string|null,
 *   retryRecommended: boolean,
 * }}
 */
function computeZombieJobSignals({
  status,
  elapsedMs,
  noProgressMs = 0,
  isRequeued = false,
  workerHealthSignal = null,
}) {
  if (TERMINAL_STATUSES.has(status)) {
    return {
      isSlow: false,
      isStuck: false,
      estimatedDelayReason: null,
      workerHealthSignal,
      retryRecommended: status === 'failed',
    };
  }

  const workerDown =
    workerHealthSignal === WORKER_HEALTH_SIGNALS.UNAVAILABLE
    || workerHealthSignal === WORKER_HEALTH_SIGNALS.DEGRADED;

  const isSlow = elapsedMs >= EXTRACTION_SLOW_MS;
  const noProgressStuck = noProgressMs >= EXTRACTION_NO_PROGRESS_MS && elapsedMs >= EXTRACTION_SLOW_MS;
  const elapsedStuck = elapsedMs >= EXTRACTION_STUCK_MS;
  const workerStuck = workerDown && elapsedMs >= EXTRACTION_SLOW_MS;
  const isStuck = elapsedStuck || noProgressStuck || workerStuck;

  let estimatedDelayReason = EXTRACTION_DELAY_REASONS.NORMAL;
  if (isRequeued) {
    estimatedDelayReason = EXTRACTION_DELAY_REASONS.RETRYING;
  } else if (workerHealthSignal === WORKER_HEALTH_SIGNALS.UNAVAILABLE) {
    estimatedDelayReason = EXTRACTION_DELAY_REASONS.WORKER_UNAVAILABLE;
  } else if (noProgressStuck && !elapsedStuck) {
    estimatedDelayReason = EXTRACTION_DELAY_REASONS.NO_PROGRESS;
  } else if (isStuck) {
    estimatedDelayReason = EXTRACTION_DELAY_REASONS.SYSTEM_LOAD;
  } else if (isSlow) {
    estimatedDelayReason = EXTRACTION_DELAY_REASONS.SLOW;
  }

  const retryRecommended = isStuck || (
    workerHealthSignal === WORKER_HEALTH_SIGNALS.UNAVAILABLE && isSlow
  );

  return {
    isSlow,
    isStuck,
    estimatedDelayReason,
    workerHealthSignal,
    retryRecommended,
  };
}

/**
 * @param {Date|string|null|undefined} updatedAt
 * @param {Date} [now]
 * @returns {number}
 */
function computeNoProgressMs(updatedAt, now = new Date()) {
  if (!updatedAt) return 0;
  const ts = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(String(updatedAt));
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, now.getTime() - ts);
}

module.exports = {
  EXTRACTION_SLOW_MS,
  EXTRACTION_STUCK_MS,
  EXTRACTION_NO_PROGRESS_MS,
  EXTRACTION_DELAY_REASONS,
  WORKER_HEALTH_SIGNALS,
  mapWorkerAvailabilityToSignal,
  computeZombieJobSignals,
  computeNoProgressMs,
};
