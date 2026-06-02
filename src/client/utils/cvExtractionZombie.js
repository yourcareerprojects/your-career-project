const {
  computeZombieJobSignals,
  computeNoProgressMs,
  EXTRACTION_DELAY_REASONS,
  WORKER_HEALTH_SIGNALS,
} = require('../../constants/cvExtractionZombie');

/**
 * Prefer server-computed zombie fields; fall back to local computation from poll snapshot.
 * @param {Record<string, unknown>} data - extraction-status API payload
 * @param {number} [fallbackElapsedMs]
 */
function resolveZombieSignalsFromStatus(data, fallbackElapsedMs) {
  const status = data?.status;
  const elapsedMs = Number(data?.elapsedMs ?? fallbackElapsedMs ?? 0);
  const updatedAt = data?.updatedAt ?? null;
  const estimatedState = data?.estimatedState ?? null;
  const isRequeued = estimatedState === 'retrying';

  if (typeof data?.isSlow === 'boolean' && typeof data?.isStuck === 'boolean') {
    return {
      isSlow: data.isSlow,
      isStuck: data.isStuck,
      estimatedDelayReason: data.estimatedDelayReason ?? null,
      workerHealthSignal: data.workerHealthSignal ?? null,
      retryRecommended: Boolean(data.retryRecommended),
    };
  }

  const workerHealthSignal = data?.workerHealthSignal ?? null;
  const noProgressMs = computeNoProgressMs(updatedAt);

  return computeZombieJobSignals({
    status,
    elapsedMs,
    noProgressMs,
    isRequeued,
    workerHealthSignal,
  });
}

/**
 * @param {ReturnType<typeof resolveZombieSignalsFromStatus>} signals
 * @returns {'normal'|'slow'|'stuck'|'recovery'}
 */
function mapZombieSignalsToUxPhase(signals, pollActive) {
  if (signals.isStuck) return pollActive ? 'stuck' : 'recovery';
  if (signals.isSlow) return 'slow';
  return 'normal';
}

/**
 * @param {string|null|undefined} reason
 * @param {string|null|undefined} workerSignal
 * @returns {string} i18n key under documentUpload.async.recovery
 */
function getDelayReasonI18nKey(reason, workerSignal) {
  if (workerSignal === WORKER_HEALTH_SIGNALS.UNAVAILABLE) {
    return 'documentUpload.async.recovery.workerUnavailable';
  }
  if (workerSignal === WORKER_HEALTH_SIGNALS.DEGRADED) {
    return 'documentUpload.async.recovery.workerDegraded';
  }
  switch (reason) {
    case EXTRACTION_DELAY_REASONS.SLOW:
      return 'documentUpload.async.recovery.slow';
    case EXTRACTION_DELAY_REASONS.SYSTEM_LOAD:
      return 'documentUpload.async.recovery.stuck';
    case EXTRACTION_DELAY_REASONS.NO_PROGRESS:
      return 'documentUpload.async.recovery.noProgress';
    case EXTRACTION_DELAY_REASONS.WORKER_UNAVAILABLE:
      return 'documentUpload.async.recovery.workerUnavailable';
    case EXTRACTION_DELAY_REASONS.RETRYING:
      return 'documentUpload.async.retrying';
    default:
      return 'documentUpload.async.stillProcessing';
  }
}

module.exports = {
  resolveZombieSignalsFromStatus,
  mapZombieSignalsToUxPhase,
  getDelayReasonI18nKey,
  EXTRACTION_DELAY_REASONS,
  WORKER_HEALTH_SIGNALS,
};
