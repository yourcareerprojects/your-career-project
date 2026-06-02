/**
 * DB-backed CV extraction worker (separate Node process).
 * Polls CvExtractionJob rows in `queued`, claims atomically, runs OCR → AI → localization.
 */
const path = require('path');
const mongoose = require('mongoose');

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, '../../', envFile) });

const connectDB = require('../../config/database');
const logger = require('../server/utils/logger');
const CvExtractionJob = require('../server/models/CvExtractionJob');
const User = require('../server/models/User');
const { processCvExtractionFromFilePath } = require('../server/services/cv/cvExtractionProcessor');
const { normalizeExternalApiError } = require('../server/utils/httpTimeouts');
const {
  claimNextQueuedCvExtractionJob,
  reclaimStaleProcessingCvExtractionJobs,
  updateJobStatus,
  completeJob,
  failJob,
  isDocumentCurrentlyProcessing,
} = require('../server/services/documents/cvExtractionJobService');
const {
  determineExtractionErrorKey,
  serializeInternalError,
} = require('../server/services/documents/cvExtractionErrorClassifier');
const {
  applyCvExtractionSuccessToUser,
  applyCvExtractionFailureToUser,
} = require('../server/services/documents/cvExtractionPersistence');
const { resolveJobLanguageFromDocument } = require('../server/services/documents/cvExtractionJobLanguage');
const {
  runCvWorkerPipelineContext,
  hrtimeDiffMs,
  getCvPipeline,
  serializeErrorSafe,
} = require('../server/utils/metricsLogger');
const { createCvWorkerScheduler } = require('../server/services/cv/cvWorkerScheduler');
const { createWorkerHeartbeatLoop } = require('../server/services/cv/cvWorkerHeartbeatService');
const { createCvQueueMetricsLogLoop } = require('../server/services/cv/cvQueueMetricsLogger');

function readIntEnv(name, def, min, max) {
  const raw = process.env[name];
  if (raw == null || raw === '') return def;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

const pollScheduler = createCvWorkerScheduler();

const workerRuntime = {
  status: /** @type {'starting'|'idle'|'processing'|'shutting_down'} */ ('starting'),
  activeJobs: 0,
  metadata: {
    batchSize: readIntEnv('CV_WORKER_BATCH_SIZE', 2, 1, 3),
    concurrency: readIntEnv('CV_WORKER_CONCURRENCY', 1, 1, 3),
  },
};

const heartbeatLoop = createWorkerHeartbeatLoop(() => ({
  status: workerRuntime.status,
  activeJobs: workerRuntime.activeJobs,
  metadata: workerRuntime.metadata,
}));

const queueMetricsLogLoop = createCvQueueMetricsLogLoop({
  source: 'cv-extraction-worker',
});

function buildSerializableExtractionResult(finished) {
  return {
    profile: finished.profile,
    status: finished.status,
    message: finished.message,
    messageKey: finished.messageKey || null,
    extractedFields: finished.extractedFields || null,
    cvExtractLocalization: finished.cvExtractLocalization ?? null,
    semanticInterpretation: finished.semanticInterpretation ?? null,
    semanticInterpretationLanguage: finished.semanticInterpretationLanguage ?? null,
    localizationStatus: finished.localizationStatus ?? null,
  };
}

function logCtx(job) {
  const pipe = getCvPipeline();
  return {
    jobId: job.jobId,
    documentId: String(job.documentId),
    userId: String(job.userId),
    language: resolveJobLanguageFromDocument(job),
    requestId: pipe?.requestId || null,
  };
}

async function pMapPool(items, concurrency, mapper) {
  if (!items.length) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  if (limit === 1) {
    for (const item of items) {
      await mapper(item);
    }
    return;
  }
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) break;
      await mapper(items[i]);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
}

/**
 * @param {import('mongoose').Document} jobDoc
 */
async function processOneCvExtractionJob(jobDoc) {
  const jobId = jobDoc.jobId;
  const userId = jobDoc.userId;
  const documentId = jobDoc.documentId;
  const jobStartedHr = process.hrtime.bigint();

  const stageRef = { current: jobDoc.stage || 'ocr' };

  const safeFail = async (err) => {
    const errorKey = determineExtractionErrorKey(err, { stage: stageRef.current });
    const internalError = serializeInternalError(err);
    try {
      await failJob(jobId, err, { stage: stageRef.current });
    } catch (e) {
      logger.error('cv_worker_fail_job_error', {
        ...logCtx(jobDoc),
        errorKey,
        internalError,
        ...serializeErrorSafe(e),
      });
    }
    try {
      await applyCvExtractionFailureToUser(userId, documentId, errorKey);
    } catch (e) {
      logger.error('cv_worker_fail_user_doc_error', {
        ...logCtx(jobDoc),
        errorKey,
        ...serializeErrorSafe(e),
      });
    }
    logger.error('worker failed', {
      ...logCtx(jobDoc),
      errorKey,
      internalError,
      durationMs: Math.round(hrtimeDiffMs(jobStartedHr) * 1000) / 1000,
      ...serializeErrorSafe(err instanceof Error ? err : new Error(String(err))),
    });
  };

  try {
    const fresh = await CvExtractionJob.findOne({ jobId })
      .select({ status: 1, documentId: 1 })
      .lean();
    if (!fresh || fresh.status === 'completed' || fresh.status === 'failed') {
      return;
    }
    if (fresh.status !== 'processing') {
      return;
    }
    if (await isDocumentCurrentlyProcessing(fresh.documentId, { excludeJobId: jobId })) {
      logger.warn('cv_worker_job_aborted_document_processing_elsewhere', logCtx(jobDoc));
      return;
    }

    const uiLanguage = resolveJobLanguageFromDocument(jobDoc);

    const user = await User.findById(userId)
      .select({ 'profile.documents': 1 })
      .lean();
    if (!user) {
      await safeFail(new Error('User not found'));
      return;
    }
    const documents = user.profile?.documents || [];
    const doc = documents.find((d) => String(d._id) === String(documentId));
    if (!doc || !doc.path) {
      await safeFail(new Error('Document not found or missing path'));
      return;
    }
    const filePath = doc.path;

    logger.info('worker claimed job', logCtx(jobDoc));
    logger.info('worker processing started', logCtx(jobDoc));

    let stageHr = process.hrtime.bigint();
    let lastStage = null;
    let lastMeta = {};

    let finalBundle = await processCvExtractionFromFilePath(filePath, {
      uiLanguage,
      onStage: async (stage, meta = {}) => {
        stageRef.current = stage;
        if (lastStage) {
          logger.info('cv_worker_stage_finished', {
            ...logCtx(jobDoc),
            stage: lastStage,
            durationMs: Math.round(hrtimeDiffMs(stageHr) * 1000) / 1000,
            ...(lastStage === 'ocr' && lastMeta.ocrTextLength != null
              ? { textLength: lastMeta.ocrTextLength }
              : {}),
            ...(lastStage === 'extraction' && lastMeta.extractionStatus != null
              ? { extractionStatus: lastMeta.extractionStatus }
              : {}),
          });
        }
        lastStage = stage;
        lastMeta = meta;
        stageHr = process.hrtime.bigint();
        logger.info('cv_worker_stage_started', { ...logCtx(jobDoc), stage });
        await updateJobStatus(jobId, 'processing', stage);
      },
    });

    if (lastStage) {
      logger.info('cv_worker_stage_finished', {
        ...logCtx(jobDoc),
        stage: lastStage,
        durationMs: Math.round(hrtimeDiffMs(stageHr) * 1000) / 1000,
        localizationStatus: finalBundle.localizationStatus ?? null,
        extractionStatus: finalBundle?.status ?? null,
      });
    }

    const guard = await CvExtractionJob.findOne({ jobId, status: 'processing' }).select({ _id: 1 }).lean();
    if (!guard) {
      logger.warn('cv_worker_job_aborted_not_processing', logCtx(jobDoc));
      return;
    }

    const serializable = buildSerializableExtractionResult(finalBundle);

    try {
      await applyCvExtractionSuccessToUser(userId, documentId, serializable);
    } catch (persistErr) {
      await safeFail(persistErr);
      return;
    }

    const completedDoc = await completeJob(jobId, serializable);
    if (!completedDoc) {
      logger.warn('cv_worker_complete_job_noop', logCtx(jobDoc));
    }

    logger.info('worker completed', {
      ...logCtx(jobDoc),
      durationMs: Math.round(hrtimeDiffMs(jobStartedHr) * 1000) / 1000,
      extractionStatus: serializable.status ?? null,
    });
  } catch (err) {
    try {
      await safeFail(err);
    } catch (inner) {
      logger.error('cv_worker_safe_fail_error', { ...logCtx(jobDoc), ...serializeErrorSafe(inner) });
    }
  }
}

let shuttingDown = false;
let pollTimer = null;

function scheduleNextTick(delayMs) {
  if (shuttingDown) return;
  pollTimer = setTimeout(runTick, Math.max(0, delayMs));
}

async function runTick() {
  if (shuttingDown) return;
  let nextDelayMs = 500;
  let nextDelayReason = 'idle_backoff';

  try {
    const { requeued, failedMaxRetries } = await reclaimStaleProcessingCvExtractionJobs();
    if (requeued > 0) {
      logger.info('job requeued', { count: requeued, reason: 'stale_processing' });
    }
    if (failedMaxRetries > 0) {
      logger.info('job failed max retries', { count: failedMaxRetries, reason: 'max_retries_exceeded' });
    }

    const batch = readIntEnv('CV_WORKER_BATCH_SIZE', 2, 1, 3);
    const concurrency = readIntEnv('CV_WORKER_CONCURRENCY', 1, 1, 3);

    const claimed = [];
    for (let i = 0; i < batch; i += 1) {
      const job = await claimNextQueuedCvExtractionJob();
      if (!job) break;
      claimed.push(job);
    }

    if (claimed.length > 0) {
      workerRuntime.status = 'processing';
    } else if (workerRuntime.activeJobs === 0) {
      workerRuntime.status = 'idle';
    }

    await pMapPool(claimed, concurrency, async (job) => {
      workerRuntime.activeJobs += 1;
      try {
        await runCvWorkerPipelineContext(
          { jobId: job.jobId, documentId: String(job.documentId), userId: String(job.userId) },
          async () => {
            await processOneCvExtractionJob(job);
          }
        );
      } catch (err) {
        logger.error('cv_worker_job_outer_error', {
          jobId: job.jobId,
          documentId: String(job.documentId),
          userId: String(job.userId),
          ...serializeErrorSafe(err),
        });
        try {
          const still = await CvExtractionJob.findOne({ jobId: job.jobId, status: 'processing' })
            .select({ _id: 1 })
            .lean();
          if (still) {
            const stage = job.stage || 'upload';
            const errorKey = determineExtractionErrorKey(err, { stage });
            await failJob(job.jobId, err, { stage });
            await applyCvExtractionFailureToUser(job.userId, job.documentId, errorKey);
          }
        } catch (e2) {
          logger.error('cv_worker_job_outer_recover_failed', { jobId: job.jobId, ...serializeErrorSafe(e2) });
        }
      } finally {
        workerRuntime.activeJobs = Math.max(0, workerRuntime.activeJobs - 1);
        workerRuntime.status = workerRuntime.activeJobs > 0 ? 'processing' : 'idle';
      }
    });

    const schedule = pollScheduler.nextDelayAfterTick({
      claimedCount: claimed.length,
      requeuedCount: requeued,
      batchSize: batch,
      concurrency,
    });
    nextDelayMs = schedule.delayMs;
    nextDelayReason = schedule.reason;
  } catch (tickErr) {
    logger.error('cv_worker_tick_failed', serializeErrorSafe(tickErr));
  } finally {
    if (!shuttingDown) {
      logger.debug('cv_worker_next_tick_scheduled', {
        delayMs: nextDelayMs,
        reason: nextDelayReason,
      });
      scheduleNextTick(nextDelayMs);
    }
  }
}

async function main() {
  logger.info('cv_worker_starting', {
    batchSize: workerRuntime.metadata.batchSize,
    concurrency: workerRuntime.metadata.concurrency,
  });
  await connectDB();
  heartbeatLoop.start();
  queueMetricsLogLoop.start();
  runTick();
}

function shutdown() {
  shuttingDown = true;
  workerRuntime.status = 'shutting_down';
  if (pollTimer) clearTimeout(pollTimer);
  heartbeatLoop.stop();
  queueMetricsLogLoop.stop();
  const { shutdownTesseractWorkerPool } = require('../server/services/documents/tesseractWorkerPool');
  Promise.resolve()
    .then(() => heartbeatLoop.tick())
    .catch(() => {})
    .then(() => shutdownTesseractWorkerPool())
    .catch(() => {})
    .then(() => mongoose.connection.close())
    .catch(() => {})
    .finally(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  logger.error('cv_worker_fatal_startup', serializeErrorSafe(e));
  process.exit(1);
});
