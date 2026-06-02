/**
 * Adaptive polling for CV extraction jobs. Structured for future SSE upgrade:
 * replace `pollOnce` internals with EventSource while keeping the same callbacks.
 */
const {
  getAdaptivePollDelayMs,
  getExtractionPollMaxDurationMs,
  EXTRACTION_SLOW_WARNING_MS,
  POLL_INTERVAL_MAX_MS,
} = require('../../constants/cvExtractionTiming');
const { resolveZombieSignalsFromStatus } = require('./cvExtractionZombie');

/**
 * @typedef {'queued'|'processing'|'completed'|'failed'} CvExtractionStatus
 */

/**
 * @typedef {'fast'|'slow'|'degraded'} CvExtractionPollPhase
 */

/**
 * @typedef {object} CvExtractionPollSnapshot
 * @property {CvExtractionStatus} status
 * @property {string|null} stage
 * @property {number} progress
 * @property {string} message
 * @property {'normal'|'delayed'|'retrying'|null} estimatedState
 * @property {string|null} errorKey
 * @property {number} elapsedMs
 * @property {boolean} isSlow
 * @property {boolean} isStuck
 * @property {string|null} estimatedDelayReason
 * @property {string|null} workerHealthSignal
 * @property {boolean} retryRecommended
 * @property {CvExtractionPollPhase} pollPhase
 */

/**
 * @param {Record<string, unknown>} data
 * @param {number} elapsedMs
 * @param {CvExtractionPollPhase} pollPhase
 * @returns {CvExtractionPollSnapshot}
 */
function buildPollSnapshot(data, elapsedMs, pollPhase) {
  const zombie = resolveZombieSignalsFromStatus(data, elapsedMs);
  return {
    status: data.status,
    stage: data.stage ?? null,
    progress: Number(data.progress ?? 0),
    message: data.message || data.progressLabel || '',
    estimatedState: data.estimatedState ?? null,
    errorKey: data.errorKey ?? null,
    elapsedMs: Number(data.elapsedMs ?? elapsedMs),
    isSlow: zombie.isSlow,
    isStuck: zombie.isStuck,
    estimatedDelayReason: zombie.estimatedDelayReason,
    workerHealthSignal: zombie.workerHealthSignal,
    retryRecommended: zombie.retryRecommended,
    pollPhase,
  };
}

/**
 * @param {number} elapsedMs
 * @param {number} maxDurationMs
 * @returns {CvExtractionPollPhase}
 */
function getPollPhase(elapsedMs, maxDurationMs) {
  if (elapsedMs >= maxDurationMs) return 'degraded';
  if (elapsedMs >= EXTRACTION_SLOW_WARNING_MS) return 'slow';
  return 'fast';
}

/**
 * @param {number} elapsedMs
 * @param {number} maxDurationMs
 * @param {CvExtractionPollPhase} pollPhase
 */
function getPollDelayForPhase(elapsedMs, maxDurationMs, pollPhase) {
  if (pollPhase === 'degraded') return POLL_INTERVAL_MAX_MS;
  if (pollPhase === 'slow') return POLL_INTERVAL_MAX_MS;
  return getAdaptivePollDelayMs(elapsedMs);
}

/**
 * @param {string} documentId
 * @param {string} token
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ ok: true, data: Record<string, unknown> } | { ok: false, httpStatus: number }>}
 */
async function fetchCvExtractionStatus(documentId, token, signal) {
  const res = await fetch(
    `/api/documents/${encodeURIComponent(documentId)}/extraction-status?_ts=${Date.now()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal,
    }
  );
  if (!res.ok) {
    return { ok: false, httpStatus: res.status };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, data };
}

function abortableDelay(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeoutId;
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timeoutId = setTimeout(resolve, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {number} startedAt
 * @param {number} maxDurationMs
 */
function getPollElapsedMs(startedAt, maxDurationMs) {
  return Math.min(Date.now() - startedAt, maxDurationMs);
}

/**
 * @param {number} elapsedMs
 * @param {number} maxDurationMs
 */
function isPollDurationExceeded(elapsedMs, maxDurationMs) {
  return elapsedMs >= maxDurationMs;
}

/**
 * Poll until backend reports `completed` or `failed`, or until max duration is reached.
 * After the slow-warning threshold, polling degrades to longer intervals (never silent endless fast polls).
 *
 * @param {object} options
 * @param {string} options.documentId
 * @param {string} options.token
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxDurationMs] defaults to {@link getExtractionPollMaxDurationMs}
 * @param {(snapshot: CvExtractionPollSnapshot) => void} [options.onUpdate]
 * @param {(consecutiveErrors: number) => void} [options.onPollError]
 * @param {(phase: CvExtractionPollPhase) => void} [options.onPollPhaseChange]
 * @returns {Promise<
 *   | { kind: 'completed', data: Record<string, unknown> }
 *   | { kind: 'failed', data: Record<string, unknown> }
 *   | { kind: 'timedOut', elapsedMs: number, data?: Record<string, unknown>, snapshot?: CvExtractionPollSnapshot }
 *   | { kind: 'aborted' }
 * >}
 */
async function watchCvExtractionUntilTerminal({
  documentId,
  token,
  signal,
  maxDurationMs = getExtractionPollMaxDurationMs(),
  onUpdate,
  onPollError,
  onPollPhaseChange,
}) {
  const startedAt = Date.now();
  let consecutiveErrors = 0;
  let lastFingerprint = null;
  let lastData = null;
  let lastSnapshot = null;
  let lastPollPhase = null;

  while (true) {
    if (signal?.aborted) {
      return { kind: 'aborted' };
    }

    const elapsedMs = getPollElapsedMs(startedAt, maxDurationMs);
    const pollPhase = getPollPhase(elapsedMs, maxDurationMs);
    if (pollPhase !== lastPollPhase) {
      lastPollPhase = pollPhase;
      onPollPhaseChange?.(pollPhase);
    }

    if (isPollDurationExceeded(elapsedMs, maxDurationMs)) {
      return {
        kind: 'timedOut',
        elapsedMs,
        data: lastData ?? undefined,
        snapshot: lastSnapshot ?? undefined,
      };
    }

    let result;
    try {
      result = await fetchCvExtractionStatus(documentId, token, signal);
    } catch (e) {
      if (e?.name === 'AbortError') return { kind: 'aborted' };
      throw e;
    }

    if (!result.ok) {
      consecutiveErrors += 1;
      onPollError?.(consecutiveErrors);
      const delay = getPollDelayForPhase(elapsedMs, maxDurationMs, pollPhase);
      const remainingMs = maxDurationMs - getPollElapsedMs(startedAt, maxDurationMs);
      if (remainingMs <= 0) {
        return {
          kind: 'timedOut',
          elapsedMs: maxDurationMs,
          data: lastData ?? undefined,
          snapshot: lastSnapshot ?? undefined,
        };
      }
      try {
        await abortableDelay(Math.min(delay * consecutiveErrors, 30000, remainingMs), signal);
      } catch (e) {
        if (e?.name === 'AbortError') return { kind: 'aborted' };
        throw e;
      }
      continue;
    }

    consecutiveErrors = 0;
    const data = result.data;
    lastData = data;
    const snapshot = buildPollSnapshot(data, elapsedMs, pollPhase);
    lastSnapshot = snapshot;
    onUpdate?.(snapshot);

    if (data.status === 'completed') {
      return { kind: 'completed', data };
    }
    if (data.status === 'failed') {
      return { kind: 'failed', data };
    }

    const fingerprint = `${data.status}:${snapshot.stage}:${snapshot.progress}`;
    const delay = getPollDelayForPhase(elapsedMs, maxDurationMs, pollPhase);
    const stallMultiplier = fingerprint === lastFingerprint ? 1.25 : 1;
    lastFingerprint = fingerprint;

    const remainingMs = maxDurationMs - getPollElapsedMs(startedAt, maxDurationMs);
    if (remainingMs <= 0) {
      return {
        kind: 'timedOut',
        elapsedMs: maxDurationMs,
        data: lastData ?? undefined,
        snapshot: lastSnapshot ?? undefined,
      };
    }

    try {
      await abortableDelay(Math.min(Math.round(delay * stallMultiplier), remainingMs), signal);
    } catch (e) {
      if (e?.name === 'AbortError') return { kind: 'aborted' };
      throw e;
    }
  }
}

/**
 * @param {object} doc
 * @returns {boolean}
 */
function isActiveCvExtractionDocument(doc) {
  if (!doc || !doc.type) return false;
  const type = doc.type;
  const isCv = type === 'cv' || type === 'resume';
  if (!isCv) return false;

  const outcome = doc.extractionOutcomeStatus;
  if (outcome === 'success' || outcome === 'partial' || outcome === 'failed') {
    return false;
  }

  const pipeline = doc.extractionStatus;
  if (pipeline === 'queued' || pipeline === 'processing') return true;
  if (doc.extractedProfileData) return false;
  if (pipeline === 'completed' || pipeline === 'failed') return false;

  return true;
}

/**
 * Map API status/stage to UI sub-phase keys used by DocumentUploadForm.
 * @param {CvExtractionStatus} status
 * @param {string|null} stage
 */
function mapExtractionStatusToUiPhase(status, stage) {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'queued') return 'queued';
  if (status === 'processing') {
    if (stage === 'localization') return 'localization';
    if (stage === 'extraction') return 'extraction';
    if (stage === 'ocr' || stage === 'upload') return 'ocr';
    return 'ocr';
  }
  return 'queued';
}

module.exports = {
  fetchCvExtractionStatus,
  watchCvExtractionUntilTerminal,
  isActiveCvExtractionDocument,
  mapExtractionStatusToUiPhase,
  buildPollSnapshot,
  getPollPhase,
};
