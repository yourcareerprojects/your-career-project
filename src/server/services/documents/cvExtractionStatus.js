const { EXTRACTION_ERROR_KEYS } = require('../../../constants/cvExtractionErrors');
const {
  EXTRACTION_EXPECTED_MS,
  computeEstimatedState,
} = require('../../../constants/cvExtractionTiming');
const {
  resolvePublicErrorKey,
  isStaleRequeuedJob,
} = require('./cvExtractionErrorClassifier');
const { buildZombieSignalsForJob } = require('./cvExtractionZombieSignals');
const {
  computeCvExtractionReadiness,
  legacyPollStageFromReadiness,
} = require('./cvExtractionReadiness');
const { layerStatusFromJob } = require('../cv/cvExtractionStateManager');

const TERMINAL_STATUSES = new Set(['completed', 'failed']);

function resolveFailedExtractionErrorKey(job, doc) {
  const fromJob = job ? resolvePublicErrorKey(job) : null;
  if (fromJob && fromJob !== EXTRACTION_ERROR_KEYS.INTERNAL_ERROR) {
    return fromJob;
  }
  const messageKey = String(doc?.extractionMessageKey || '').trim();
  if (messageKey === 'documentUpload.extraction.noDocumentText') {
    return EXTRACTION_ERROR_KEYS.OCR_FAILED;
  }
  if (messageKey === 'documentUpload.extraction.semanticInterpretationNone') {
    return EXTRACTION_ERROR_KEYS.EXTRACTION_FAILED;
  }
  return fromJob || EXTRACTION_ERROR_KEYS.INTERNAL_ERROR;
}

const DISPLAY_PROGRESS = {
  upload: 10,
  ocr: 35,
  extraction: 65,
  /** CV text extracted; background enrichment may still run */
  extracted: 72,
  done: 100,
  failed: 0,
};

/** Progress while `phase === enriching`, keyed by `blockingTask`. */
const ENRICHMENT_PROGRESS_BY_TASK = {
  structured: 78,
  localization: 88,
  narrative: 94,
};

const DISPLAY_MESSAGE = {
  upload: 'Waiting for processing',
  ocr: 'Reading your document',
  extraction: 'Analyzing skills and experience',
  extracted: 'CV extracted — finishing background enhancements',
  done: 'Profile preparation complete',
  failed: 'Extraction failed',
};

const ENRICHMENT_MESSAGE_BY_TASK = {
  structured: 'Interpreting strengths and experience from your CV',
  localization: 'Applying bilingual profile formatting',
  narrative: 'Preparing profile summaries for review',
};

function progressForReadiness(readiness) {
  if (readiness.pipeline === 'failed') return DISPLAY_PROGRESS.failed;
  if (readiness.pipeline === 'completed' && readiness.isBackgroundEnriching) {
    const task = readiness.blockingTask;
    if (task && ENRICHMENT_PROGRESS_BY_TASK[task] != null) {
      return ENRICHMENT_PROGRESS_BY_TASK[task];
    }
    return DISPLAY_PROGRESS.extracted;
  }
  if (readiness.pipeline === 'completed') return DISPLAY_PROGRESS.done;
  if (readiness.pipeline === 'queued') return DISPLAY_PROGRESS.upload;
  return DISPLAY_PROGRESS[readiness.displayStage] ?? DISPLAY_PROGRESS.ocr;
}

function messageForReadiness(readiness) {
  if (readiness.pipeline === 'failed') return DISPLAY_MESSAGE.failed;
  if (readiness.pipeline === 'completed' && readiness.isBackgroundEnriching) {
    const task = readiness.blockingTask;
    if (task && ENRICHMENT_MESSAGE_BY_TASK[task]) {
      return ENRICHMENT_MESSAGE_BY_TASK[task];
    }
    return DISPLAY_MESSAGE.extracted;
  }
  if (readiness.pipeline === 'completed') return DISPLAY_MESSAGE.done;
  return DISPLAY_MESSAGE[readiness.displayStage] || DISPLAY_MESSAGE.ocr;
}

/**
 * Resolve machine status to queued | processing | completed | failed.
 * @param {object} params
 * @param {object|null} params.doc - lean embedded document
 * @param {object|null} params.job - lean CvExtractionJob
 */
function resolveReadinessLanguage(job) {
  return job?.language === 'de' ? 'de' : 'en';
}

function resolveExtractionMachineStatus({ doc, job }) {
  const readiness = computeCvExtractionReadiness(doc, job, {
    language: resolveReadinessLanguage(job),
  });
  return {
    status: readiness.pipeline,
    stage: legacyPollStageFromReadiness(readiness, job),
    readiness,
  };
}

/**
 * Build stable extraction status payload for GET .../extraction-status.
 * @param {object} params
 * @param {string} params.documentId
 * @param {object|null} params.doc
 * @param {object|null} params.job
 * @param {Date} [params.now]
 * @param {string|null} [params.workerHealthSignal]
 */
function buildCvExtractionStatusResponse({
  documentId,
  doc,
  job,
  now = new Date(),
  workerHealthSignal = null,
}) {
  const readiness = computeCvExtractionReadiness(doc, job, {
    language: resolveReadinessLanguage(job),
  });
  const status = readiness.pipeline;
  const stage = legacyPollStageFromReadiness(readiness, job);
  const jobId = job?.jobId ? String(job.jobId) : null;

  const updatedAt = job?.updatedAt || job?.createdAt || doc?.uploadDate || null;
  const startedAt = job?.createdAt || doc?.uploadDate || null;
  const elapsedMs = startedAt ? Math.max(0, now.getTime() - new Date(startedAt).getTime()) : 0;

  const isRequeued = isStaleRequeuedJob(job);

  const estimatedState = TERMINAL_STATUSES.has(status)
    ? null
    : computeEstimatedState(elapsedMs, { isRequeued });

  let errorKey = null;
  let completedAt = null;
  const hasDocResult = Boolean(doc?.extractedProfileData);
  let hasResult = hasDocResult || Boolean(job?.result);

  if (status === 'failed') {
    errorKey = resolveFailedExtractionErrorKey(job, doc);
  } else if (status === 'completed') {
    completedAt = job?.status === 'completed' && job?.updatedAt
      ? job.updatedAt
      : doc?.uploadDate || null;
    hasResult = hasDocResult || Boolean(job?.result);
  }

  const progress = progressForReadiness(readiness);
  const message = messageForReadiness(readiness);

  const zombie = buildZombieSignalsForJob({
    status,
    elapsedMs,
    job,
    doc,
    now,
    workerHealthSignal,
  });

  return {
    documentId: String(documentId),
    jobId,
    status,
    stage,
    phase: readiness.phase,
    displayStage: readiness.displayStage,
    progress,
    message,
    estimatedState,
    progressLabel: message,
    errorKey,
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    elapsedMs,
    expectedDurationMs: EXTRACTION_EXPECTED_MS,
    completedAt: status === 'completed' && completedAt
      ? new Date(completedAt).toISOString()
      : null,
    hasResult,
    reviewReady: readiness.reviewReady,
    identityReviewReady: readiness.identityReviewReady,
    structuredReviewReady: readiness.structuredReviewReady,
    reviewQuality: readiness.reviewQuality,
    extractionLayers: layerStatusFromJob(job),
    isBackgroundEnriching: readiness.isBackgroundEnriching,
    backgroundEnrichment: readiness.backgroundEnrichment,
    narrativesReady: readiness.narrativesReady,
    blockingTask: readiness.blockingTask,
    isSlow: zombie.isSlow,
    isStuck: zombie.isStuck,
    estimatedDelayReason: zombie.estimatedDelayReason,
    workerHealthSignal: zombie.workerHealthSignal,
    retryRecommended: zombie.retryRecommended,
  };
}

module.exports = {
  DISPLAY_PROGRESS,
  resolveExtractionMachineStatus,
  buildCvExtractionStatusResponse,
  computeCvExtractionReadiness,
};
