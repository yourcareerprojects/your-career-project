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
    displayStage: data.displayStage ?? null,
    progress: Number(data.progress ?? 0),
    message: data.message || data.progressLabel || '',
    estimatedState: data.estimatedState ?? null,
    errorKey: data.errorKey ?? null,
    elapsedMs: Number(data.elapsedMs ?? elapsedMs),
    reviewReady: Boolean(data.reviewReady),
    identityReviewReady: Boolean(data.identityReviewReady ?? data.reviewReady),
    structuredReviewReady: Boolean(data.structuredReviewReady),
    extractionLayers: data.extractionLayers ?? null,
    reviewQuality: data.reviewQuality ?? null,
    phase: data.phase ?? null,
    narrativesReady: Boolean(data.narrativesReady),
    blockingTask: data.blockingTask ?? null,
    isBackgroundEnriching: Boolean(data.isBackgroundEnriching),
    backgroundEnrichment: data.backgroundEnrichment ?? null,
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

  // Poll until terminal status, timeout, or abort.
  // eslint-disable-next-line no-constant-condition
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

    if (data.status === 'failed') {
      return { kind: 'failed', data };
    }
    if (data.status === 'completed' && isCvExtractionPollTerminal(data)) {
      return { kind: 'completed', data };
    }

    const fingerprint = `${data.status}:${snapshot.phase}:${snapshot.blockingTask}:${snapshot.progress}`;
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

  if (typeof doc.reviewReady === 'boolean') {
    const pipeline = doc.extractionStatus;
    if (pipeline === 'failed') return false;
    if (pipeline === 'queued' || pipeline === 'processing') return true;
    return !doc.reviewReady;
  }

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

/** @typedef {'structured'|'localization'|'narrative'} CvBackgroundBlockingTask */

/**
 * @param {CvBackgroundBlockingTask|null|undefined} blockingTask
 * @returns {string}
 */
function mapBlockingTaskToMessageKey(blockingTask) {
  const map = {
    structured: 'documentUpload.async.enrichingStructured',
    localization: 'documentUpload.async.enrichingLocalization',
    narrative: 'documentUpload.async.enrichingNarrative',
  };
  return map[blockingTask] || 'documentUpload.async.enriching';
}

/**
 * @param {CvBackgroundBlockingTask|null|undefined} blockingTask
 * @param {string|null|undefined} [legacyStage]
 */
function uiPhaseForBackgroundEnrichment(blockingTask, legacyStage = null) {
  const task = blockingTask || legacyStage;
  if (task === 'structured') return 'enrichingStructured';
  if (task === 'localization') return 'enrichingLocalization';
  if (task === 'narrative') return 'enrichingNarrative';
  return 'enriching';
}

/**
 * Poll stops when worker failed or extraction is completed and background enrichment settled.
 * @param {Record<string, unknown>} data
 */
function isCvExtractionPollTerminal(data) {
  if (data.status === 'failed') return true;
  if (data.status !== 'completed') return false;
  const phase = data.phase != null ? String(data.phase) : null;
  if (phase === 'ready') return true;
  if (phase === 'enriching' || Boolean(data.isBackgroundEnriching)) return false;
  return true;
}

/**
 * True while worker or post-extraction enrichment UI should show in-progress state.
 * @param {string|null|undefined} uiPhase
 */
function isCvExtractionUiPhaseInProgress(uiPhase) {
  if (!uiPhase || uiPhase === 'idle') return false;
  return uiPhase !== 'completed' && uiPhase !== 'failed' && uiPhase !== 'timedOut';
}

/**
 * Map API status/stage to UI sub-phase keys used by DocumentUploadForm.
 * @param {CvExtractionStatus} status
 * @param {string|null} stage
 * @param {{ isBackgroundEnriching?: boolean, displayStage?: string|null, phase?: string|null, blockingTask?: CvBackgroundBlockingTask|null }} [extras]
 */
function mapExtractionStatusToUiPhase(status, stage, extras = {}) {
  const phase = extras.phase != null ? String(extras.phase) : null;
  const isBackgroundEnriching = Boolean(extras.isBackgroundEnriching);
  const displayStage = extras.displayStage ?? null;
  const blockingTask = extras.blockingTask ?? null;

  if (phase === 'ready' || (status === 'completed' && phase === 'ready')) return 'completed';
  if (phase === 'enriching' || (status === 'completed' && isBackgroundEnriching)) {
    return uiPhaseForBackgroundEnrichment(blockingTask, stage);
  }
  if (phase === 'failed' || status === 'failed') return 'failed';
  if (phase === 'upload' || status === 'queued') return 'queued';
  if (phase === 'extraction') return 'extraction';
  if (phase === 'ocr') return 'ocr';

  if (status === 'completed') {
    if (isBackgroundEnriching) {
      return uiPhaseForBackgroundEnrichment(blockingTask, stage);
    }
    return 'completed';
  }
  if (status === 'failed') return 'failed';
  if (status === 'queued') return 'queued';
  if (status === 'processing') {
    if (stage === 'structured' || stage === 'localization' || stage === 'narrative') {
      return uiPhaseForBackgroundEnrichment(stage, null);
    }
    if (stage === 'enrichment' || displayStage === 'enrichment') return 'enriching';
    if (stage === 'extraction' || displayStage === 'extraction') return 'extraction';
    if (stage === 'ocr' || stage === 'upload' || displayStage === 'ocr' || displayStage === 'upload') {
      return 'ocr';
    }
    return 'ocr';
  }
  return 'queued';
}

/**
 * Resolve i18n key for extraction progress copy (prefers API `phase` / `blockingTask`).
 * @param {object|null|undefined} snapshot — poll snapshot or status payload
 * @param {object} [context]
 * @param {boolean} [context.pollReconnecting]
 * @param {'normal'|'delayed'|'retrying'|null} [context.extractionEstimatedState]
 * @param {boolean} [context.hasActivePoll]
 * @param {() => string|null} [context.getZombieMessageKey] — returns i18n key from zombie helpers
 */
function resolveExtractionProgressMessageKey(snapshot, context = {}) {
  const {
    pollReconnecting = false,
    extractionEstimatedState = null,
    hasActivePoll = false,
    getZombieMessageKey = null,
  } = context;

  if (pollReconnecting) return 'documentUpload.async.pollReconnecting';
  if (typeof getZombieMessageKey === 'function') {
    const zombieKey = getZombieMessageKey();
    if (zombieKey) return zombieKey;
  }
  if (extractionEstimatedState === 'retrying') return 'documentUpload.async.retrying';
  if (extractionEstimatedState === 'delayed') return 'documentUpload.async.takingLonger';
  if (hasActivePoll && extractionEstimatedState === 'normal') {
    return 'documentUpload.async.stillProcessing';
  }

  const phase = snapshot?.phase != null ? String(snapshot.phase) : null;
  if (phase === 'enriching' && snapshot?.blockingTask) {
    return mapBlockingTaskToMessageKey(snapshot.blockingTask);
  }
  if (phase === 'upload') return 'documentUpload.async.extractionQueued';
  if (phase === 'ocr') return 'documentUpload.async.ocr';
  if (phase === 'extraction') return 'documentUpload.async.extraction';
  if (phase === 'ready') return 'documentUpload.async.completed';

  const map = {
    queued: 'documentUpload.async.extractionQueued',
    ocr: 'documentUpload.async.ocr',
    extraction: 'documentUpload.async.extraction',
    enriching: 'documentUpload.async.enriching',
    enrichingStructured: 'documentUpload.async.enrichingStructured',
    enrichingLocalization: 'documentUpload.async.enrichingLocalization',
    enrichingNarrative: 'documentUpload.async.enrichingNarrative',
    completed: 'documentUpload.async.completed',
  };
  const uiPhase = mapExtractionStatusToUiPhase(
    snapshot?.status,
    snapshot?.stage ?? null,
    {
      isBackgroundEnriching: snapshot?.isBackgroundEnriching,
      displayStage: snapshot?.displayStage,
      phase: snapshot?.phase,
    }
  );
  return map[uiPhase] || 'documentUpload.async.extractionQueued';
}

/**
 * @param {object} doc
 * @returns {boolean}
 */
function documentNeedsFullReviewQuality(doc) {
  if (!doc) return true;
  if (doc.reviewQuality === 'full') return false;
  if (doc.reviewQuality === 'baseline') return true;
  const status = String(doc.semanticEnrichmentStatus || '');
  const messageKey = String(doc.extractionMessageKey || '');
  return (
    status !== 'complete'
    || messageKey === 'documentUpload.extraction.heuristicFallback'
    || messageKey === 'documentUpload.extraction.aiTimeout'
  );
}

/**
 * True when review should call ensure-localization (UI locale differs from CV source).
 * @param {object|null|undefined} doc
 * @param {string} uiLangCode
 */
function documentNeedsCvLocalization(doc, uiLangCode) {
  if (!doc?.extractedProfileData) return false;
  const locStatus = String(doc.localizationStatus || '').toLowerCase();
  if (locStatus === 'complete' || locStatus === 'partial' || locStatus === 'skipped') {
    return false;
  }
  const source =
    doc.semanticInterpretationLanguage === 'de' || doc.semanticInterpretationLanguage === 'en'
      ? doc.semanticInterpretationLanguage
      : doc.cvExtractLocalization?.documentLanguage === 'de'
        ? 'de'
        : 'en';
  const target = String(uiLangCode || 'en').toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
  return source !== target;
}

module.exports = {
  fetchCvExtractionStatus,
  watchCvExtractionUntilTerminal,
  isActiveCvExtractionDocument,
  mapExtractionStatusToUiPhase,
  mapBlockingTaskToMessageKey,
  uiPhaseForBackgroundEnrichment,
  isCvExtractionPollTerminal,
  isCvExtractionUiPhaseInProgress,
  resolveExtractionProgressMessageKey,
  documentNeedsFullReviewQuality,
  documentNeedsCvLocalization,
  buildPollSnapshot,
  getPollPhase,
};
