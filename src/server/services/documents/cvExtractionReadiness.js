const { isCvDocumentType } = require('../../../constants/documentTypes');
const { CV_IDENTITY_REVIEW_FALLBACK_MS } = require('../../../constants/cvExtractionLayerTiming');
const { getDocumentNarrativeCacheReadiness } = require('../profile/profileNarrativeReadinessService');
const { layerStatusFromJob } = require('../cv/cvExtractionStateManager');
const { needsDeferredStructuredSemantic } = require('./cvPostExtractionWorkPlanner');

/** @typedef {'queued'|'processing'|'completed'|'failed'} CvExtractionPipelineStatus */
/** @typedef {'none'|'baseline'|'full'} CvReviewQuality */
/** @typedef {'idle'|'pending'|'complete'|'skipped'} CvEnrichmentTaskStatus */
/** @typedef {'upload'|'ocr'|'extraction'|'enrichment'|'done'|'failed'} CvExtractionDisplayStage */
/** @typedef {'upload'|'ocr'|'extraction'|'enriching'|'ready'|'failed'} CvUserPhase */
/** @typedef {'structured'|'localization'|'narrative'} CvBackgroundBlockingTask */

/**
 * @typedef {object} CvBackgroundEnrichment
 * @property {CvEnrichmentTaskStatus} structured
 * @property {CvEnrichmentTaskStatus} localization
 * @property {CvEnrichmentTaskStatus} narrative
 */

/**
 * @typedef {object} CvExtractionReadiness
 * @property {CvExtractionPipelineStatus} pipeline
 * @property {CvUserPhase} phase
 * @property {boolean} reviewReady
 * @property {boolean} identityReviewReady
 * @property {boolean} structuredReviewReady
 * @property {CvReviewQuality} reviewQuality
 * @property {CvBackgroundEnrichment} backgroundEnrichment
 * @property {boolean} isBackgroundEnriching
 * @property {CvExtractionDisplayStage} displayStage
 * @property {CvBackgroundBlockingTask|null} blockingTask
 * @property {boolean} narrativesReady
 */

/**
 * @param {unknown} value
 * @returns {CvEnrichmentTaskStatus}
 */
function normalizeEnrichmentTaskStatus(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'pending') return 'pending';
  if (s === 'complete' || s === 'completed') return 'complete';
  if (s === 'skipped') return 'skipped';
  return 'idle';
}

/**
 * Narrative background work starts only after structured is settled on the document.
 * @param {CvBackgroundEnrichment} background
 * @returns {boolean}
 */
function isAnyBackgroundTaskPending(background) {
  return background.structured === 'pending';
}

/**
 * @param {object|null|undefined} doc
 * @param {CvExtractionPipelineStatus} pipeline
 * @param {CvEnrichmentTaskStatus} structuredTask
 * @param {{ language?: string }} [options]
 * @returns {CvEnrichmentTaskStatus}
 */
function deriveNarrativeTaskStatus(doc, pipeline, structuredTask, options = {}) {
  const language = options.language === 'de' ? 'de' : 'en';
  if (pipeline === 'failed' || pipeline === 'queued' || pipeline === 'processing') {
    return 'idle';
  }
  if (!doc?.extractedProfileData) return 'skipped';

  // Non-CV uploads (e.g. legacy reference/transcript) do not use the CV narrative pipeline.
  const docType = String(doc?.type || '').trim();
  if (docType && !isCvDocumentType(docType)) {
    return doc?.narrativeEnrichment?.structuredUserInfo ? 'complete' : 'skipped';
  }

  if (structuredTask === 'pending') return 'idle';
  if (
    needsDeferredStructuredSemantic({
      semanticEnrichmentStatus: doc?.semanticEnrichmentStatus,
      messageKey: doc?.extractionMessageKey,
      localizationStatus: doc?.localizationStatus,
      narrativeEnrichmentStatus: doc?.narrativeEnrichmentStatus,
    })
  ) {
    return 'idle';
  }

  const persisted = normalizeEnrichmentTaskStatus(doc?.narrativeEnrichmentStatus);
  if (persisted === 'pending' || persisted === 'complete' || persisted === 'skipped') {
    return persisted;
  }

  const cache = getDocumentNarrativeCacheReadiness(doc, language);
  return cache.ready ? 'complete' : 'pending';
}

/**
 * @param {object|null|undefined} doc
 * @param {CvExtractionPipelineStatus} pipeline
 * @param {{ language?: string }} [options]
 * @returns {CvBackgroundEnrichment}
 */
function buildBackgroundEnrichment(doc, pipeline, options = {}) {
  const structured = normalizeEnrichmentTaskStatus(doc?.semanticEnrichmentStatus);
  const localization = normalizeEnrichmentTaskStatus(doc?.localizationStatus);
  const narrative = deriveNarrativeTaskStatus(doc, pipeline, structured, options);
  return { structured, localization, narrative };
}

/**
 * @param {CvUserPhase} phase
 * @returns {CvExtractionDisplayStage}
 */
function displayStageFromPhase(phase) {
  if (phase === 'enriching') return 'enrichment';
  if (phase === 'ready') return 'done';
  if (phase === 'upload' || phase === 'ocr' || phase === 'extraction' || phase === 'failed') {
    return phase;
  }
  return 'upload';
}

/**
 * @param {CvExtractionPipelineStatus} pipeline
 * @param {CvBackgroundEnrichment} background
 * @param {CvExtractionDisplayStage|null} [workerDisplayStage]
 * @returns {CvUserPhase}
 */
function computeUserPhase(pipeline, background, workerDisplayStage = null) {
  if (pipeline === 'failed') return 'failed';
  if (pipeline === 'queued') return 'upload';
  if (pipeline === 'processing') {
    if (workerDisplayStage === 'extraction') return 'extraction';
    if (workerDisplayStage === 'upload') return 'upload';
    return 'ocr';
  }
  return isAnyBackgroundTaskPending(background) ? 'enriching' : 'ready';
}

/** Narrative background work never blocks review UI — only structured can block poll UX. */
function blockingTaskFromBackground(background) {
  if (background.structured === 'pending') return 'structured';
  return null;
}

/**
 * @param {object|null|undefined} doc
 * @param {object|null|undefined} job
 * @param {Date} [now]
 */
function computeIdentityReviewReady(doc, job, now = new Date()) {
  const hasDocResult = Boolean(doc?.extractedProfileData);
  if (!hasDocResult) return false;
  if (doc?.reviewReady === true) return true;

  const identityStatus = normalizeEnrichmentTaskStatus(doc?.identityEnrichmentStatus);
  if (identityStatus === 'complete') return true;

  const layers = layerStatusFromJob(job);
  if (layers.identity === 'done') return true;

  const heuristicsAt = job?.heuristicsCompletedAt
    ? new Date(job.heuristicsCompletedAt).getTime()
    : null;
  if (layers.heuristics === 'done' && heuristicsAt) {
    return now.getTime() - heuristicsAt >= CV_IDENTITY_REVIEW_FALLBACK_MS;
  }
  return false;
}

function computeStructuredReviewReady(doc) {
  if (!doc?.extractedProfileData) return false;
  return normalizeEnrichmentTaskStatus(doc?.semanticEnrichmentStatus) === 'complete';
}

/**
 * @param {object} params
 * @param {CvExtractionPipelineStatus} params.pipeline
 * @param {boolean} params.reviewReady
 * @param {boolean} params.identityReviewReady
 * @param {boolean} params.structuredReviewReady
 * @param {CvReviewQuality} params.reviewQuality
 * @param {object|null|undefined} params.doc
 * @param {CvExtractionDisplayStage|null} [params.workerDisplayStage]
 * @param {{ language?: string }} [params.options]
 * @param {object|null|undefined} [params.job]
 * @param {Date} [params.now]
 * @returns {CvExtractionReadiness}
 */
function assembleReadiness({
  pipeline,
  reviewReady,
  identityReviewReady,
  structuredReviewReady,
  reviewQuality,
  doc,
  workerDisplayStage = null,
  options = {},
  job = null,
  now = new Date(),
}) {
  const backgroundEnrichment = buildBackgroundEnrichment(doc, pipeline, options);
  const phase = computeUserPhase(pipeline, backgroundEnrichment, workerDisplayStage);
  const isBackgroundEnriching = pipeline === 'completed' && isAnyBackgroundTaskPending(backgroundEnrichment);
  const blockingTask = isBackgroundEnriching ? blockingTaskFromBackground(backgroundEnrichment) : null;
  const identityReady = identityReviewReady ?? computeIdentityReviewReady(doc, job, now);
  const structuredReady = structuredReviewReady ?? computeStructuredReviewReady(doc);

  return {
    pipeline,
    phase,
    reviewReady: reviewReady || identityReady,
    identityReviewReady: identityReady,
    structuredReviewReady: structuredReady,
    reviewQuality,
    backgroundEnrichment,
    isBackgroundEnriching,
    displayStage: displayStageFromPhase(phase),
    blockingTask,
    narrativesReady: backgroundEnrichment.narrative === 'complete',
  };
}

/**
 * @param {object|null|undefined} doc
 * @param {object|null|undefined} [job]
 * @param {{ language?: string, now?: Date }} [options]
 * @returns {CvExtractionReadiness}
 */
function computeCvExtractionReadiness(doc, job = null, options = {}) {
  const language = options.language === 'de' ? 'de' : 'en';
  const now = options.now instanceof Date ? options.now : new Date();
  const readinessOptions = { language };
  const hasDocResult = Boolean(doc?.extractedProfileData);
  const docPipeline = String(doc?.extractionStatus ?? '').trim().toLowerCase();
  const docOutcome = String(doc?.extractionOutcomeStatus ?? '').trim().toLowerCase();

  const reviewQualityFromEnrichment = (background) => (
    background.structured === 'complete' ? 'full' : 'baseline'
  );

  if (docPipeline === 'failed' || docOutcome === 'failed') {
    return assembleReadiness({
      pipeline: 'failed',
      reviewReady: false,
      identityReviewReady: false,
      structuredReviewReady: false,
      reviewQuality: 'none',
      doc,
      options: readinessOptions,
      job,
      now,
    });
  }

  const pipelineCompleteByDoc =
    docPipeline === 'completed'
    || docOutcome === 'success'
    || docOutcome === 'partial';

  if (pipelineCompleteByDoc) {
    const backgroundEnrichment = buildBackgroundEnrichment(doc, 'completed', readinessOptions);
    return assembleReadiness({
      pipeline: 'completed',
      reviewReady: hasDocResult,
      identityReviewReady: computeIdentityReviewReady(doc, job, now),
      structuredReviewReady: computeStructuredReviewReady(doc),
      reviewQuality: hasDocResult ? reviewQualityFromEnrichment(backgroundEnrichment) : 'none',
      doc,
      options: readinessOptions,
      job,
      now,
    });
  }

  if (job) {
    const jobStatus = String(job.status ?? '').trim().toLowerCase();
    if (jobStatus === 'failed') {
      return assembleReadiness({
        pipeline: 'failed',
        reviewReady: false,
        identityReviewReady: false,
        structuredReviewReady: false,
        reviewQuality: 'none',
        doc,
        options: readinessOptions,
        job,
        now,
      });
    }
    if (jobStatus === 'completed') {
      const backgroundEnrichment = buildBackgroundEnrichment(doc, 'completed', readinessOptions);
      return assembleReadiness({
        pipeline: 'completed',
        reviewReady: hasDocResult,
        identityReviewReady: computeIdentityReviewReady(doc, job, now),
        structuredReviewReady: computeStructuredReviewReady(doc),
        reviewQuality: hasDocResult ? reviewQualityFromEnrichment(backgroundEnrichment) : 'none',
        doc,
        options: readinessOptions,
        job,
        now,
      });
    }
    if (jobStatus === 'processing') {
      const jobStage = String(job.stage || 'ocr').trim().toLowerCase();
      const workerDisplayStage =
        jobStage === 'extraction' ? 'extraction'
          : jobStage === 'upload' ? 'upload'
            : 'ocr';
      const identityReady = computeIdentityReviewReady(doc, job, now);
      return assembleReadiness({
        pipeline: 'processing',
        reviewReady: identityReady,
        identityReviewReady: identityReady,
        structuredReviewReady: computeStructuredReviewReady(doc),
        reviewQuality: identityReady && hasDocResult ? 'baseline' : 'none',
        doc,
        workerDisplayStage,
        options: readinessOptions,
        job,
        now,
      });
    }
    if (jobStatus === 'queued') {
      return assembleReadiness({
        pipeline: 'queued',
        reviewReady: false,
        identityReviewReady: false,
        structuredReviewReady: false,
        reviewQuality: 'none',
        doc,
        workerDisplayStage: 'upload',
        options: readinessOptions,
        job,
        now,
      });
    }
  }

  if (docPipeline === 'queued' || docPipeline === 'processing') {
    const identityReady = computeIdentityReviewReady(doc, job, now);
    return assembleReadiness({
      pipeline: docPipeline === 'processing' ? 'processing' : 'queued',
      reviewReady: identityReady,
      identityReviewReady: identityReady,
      structuredReviewReady: computeStructuredReviewReady(doc),
      reviewQuality: identityReady && hasDocResult ? 'baseline' : 'none',
      doc,
      workerDisplayStage: docPipeline === 'processing' ? 'ocr' : 'upload',
      options: readinessOptions,
      job,
      now,
    });
  }

  if (doc && isCvDocumentType(doc.type) && hasDocResult) {
    const backgroundEnrichment = buildBackgroundEnrichment(doc, 'completed', readinessOptions);
    return assembleReadiness({
      pipeline: 'completed',
      reviewReady: true,
      identityReviewReady: true,
      structuredReviewReady: computeStructuredReviewReady(doc),
      reviewQuality: reviewQualityFromEnrichment(backgroundEnrichment),
      doc,
      options: readinessOptions,
      job,
      now,
    });
  }

  if (doc && isCvDocumentType(doc.type)) {
    return assembleReadiness({
      pipeline: 'queued',
      reviewReady: false,
      identityReviewReady: false,
      structuredReviewReady: false,
      reviewQuality: 'none',
      doc,
      workerDisplayStage: 'upload',
      options: readinessOptions,
      job,
      now,
    });
  }

  return assembleReadiness({
    pipeline: 'queued',
    reviewReady: false,
    identityReviewReady: false,
    structuredReviewReady: false,
    reviewQuality: 'none',
    doc,
    workerDisplayStage: 'upload',
    options: readinessOptions,
    job,
    now,
  });
}

function legacyPollStageFromReadiness(readiness, job = null) {
  if (readiness.displayStage === 'done') return 'done';
  if (readiness.displayStage === 'failed') return job?.stage || 'failed';
  if (readiness.displayStage === 'enrichment') {
    return readiness.blockingTask || 'enrichment';
  }
  if (readiness.displayStage === 'extraction') return 'extraction';
  if (readiness.displayStage === 'ocr') return 'ocr';
  if (readiness.displayStage === 'upload') return 'upload';
  return 'upload';
}

module.exports = {
  computeCvExtractionReadiness,
  legacyPollStageFromReadiness,
  normalizeEnrichmentTaskStatus,
  deriveNarrativeTaskStatus,
  assembleReadiness,
  computeIdentityReviewReady,
  computeStructuredReviewReady,
};
