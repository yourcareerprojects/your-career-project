const { isCvDocumentType } = require('../../../constants/documentTypes');
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

const TERMINAL_STATUSES = new Set(['completed', 'failed']);

const STAGE_PROGRESS = {
  upload: 10,
  ocr: 35,
  extraction: 65,
  localization: 90,
};

const STAGE_MESSAGE = {
  upload: 'Waiting for processing',
  ocr: 'Reading your document',
  extraction: 'Analyzing skills and experience',
  localization: 'Preparing your profile',
};

function progressForStage(stage, status) {
  if (status === 'completed') return 100;
  if (status === 'failed') return 0;
  if (status === 'queued') return STAGE_PROGRESS.upload;
  return STAGE_PROGRESS[stage] ?? STAGE_PROGRESS.ocr;
}

function messageForStatus(status, stage) {
  if (status === 'completed') return 'Extraction completed';
  if (status === 'failed') return 'Extraction failed';
  if (status === 'queued') return STAGE_MESSAGE.upload;
  return STAGE_MESSAGE[stage] || STAGE_MESSAGE.ocr;
}

/**
 * Resolve machine status to queued | processing | completed | failed.
 * @param {object} params
 * @param {object|null} params.doc - lean embedded document
 * @param {object|null} params.job - lean CvExtractionJob
 */
function resolveExtractionMachineStatus({ doc, job }) {
  const docPipeline = doc?.extractionStatus;
  const docOutcome = doc?.extractionOutcomeStatus;
  const hasDocResult = Boolean(doc?.extractedProfileData);

  if (docPipeline === 'completed' || docOutcome === 'success' || docOutcome === 'partial') {
    return { status: 'completed', stage: 'localization' };
  }
  if (docPipeline === 'failed' || docOutcome === 'failed') {
    return { status: 'failed', stage: job?.stage || null };
  }

  if (job) {
    if (job.status === 'completed') {
      return { status: 'completed', stage: job.stage || 'localization' };
    }
    if (job.status === 'failed') {
      return { status: 'failed', stage: job.stage || null };
    }
    if (job.status === 'processing') {
      return { status: 'processing', stage: job.stage || 'ocr' };
    }
    if (job.status === 'queued') {
      return { status: 'queued', stage: job.stage || 'upload' };
    }
  }

  if (docPipeline === 'queued' || docPipeline === 'processing') {
    return {
      status: docPipeline === 'processing' ? 'processing' : 'queued',
      stage: docPipeline === 'processing' ? 'ocr' : 'upload',
    };
  }

  if (doc && isCvDocumentType(doc.type) && hasDocResult) {
    return { status: 'completed', stage: 'localization' };
  }

  if (doc && isCvDocumentType(doc.type)) {
    return { status: 'queued', stage: 'upload' };
  }

  return { status: 'queued', stage: 'upload' };
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
  const { status, stage } = resolveExtractionMachineStatus({ doc, job });
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
    errorKey = job ? resolvePublicErrorKey(job) : EXTRACTION_ERROR_KEYS.INTERNAL_ERROR;
  } else if (status === 'completed') {
    completedAt = job?.status === 'completed' && job?.updatedAt
      ? job.updatedAt
      : doc?.uploadDate || null;
    hasResult = true;
  }

  const progress = progressForStage(stage, status);
  const message = messageForStatus(status, stage);

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
    isSlow: zombie.isSlow,
    isStuck: zombie.isStuck,
    estimatedDelayReason: zombie.estimatedDelayReason,
    workerHealthSignal: zombie.workerHealthSignal,
    retryRecommended: zombie.retryRecommended,
  };
}

module.exports = {
  STAGE_PROGRESS,
  resolveExtractionMachineStatus,
  buildCvExtractionStatusResponse,
};
