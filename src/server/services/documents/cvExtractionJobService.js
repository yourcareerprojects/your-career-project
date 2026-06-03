const mongoose = require('mongoose');
const CvExtractionJob = require('../../models/CvExtractionJob');
const {
  EXTRACTION_ERROR_KEYS,
  EXTRACTION_INTERNAL_ERROR_CODES,
} = require('../../../constants/cvExtractionErrors');
const { applyCvExtractionFailureToUser } = require('./cvExtractionPersistence');
const {
  determineExtractionErrorKey,
  serializeInternalError,
} = require('./cvExtractionErrorClassifier');
const { normalizeCvJobLanguage } = require('./cvExtractionJobLanguage');

/** Max worker claims per job before stale reclaim marks the job failed. */
const MAX_RETRIES = 3;

function jobAttemptCount(job) {
  const n = job?.attemptCount;
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  return 0;
}

function toObjectId(value, label) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  throw new TypeError(`${label} must be a valid ObjectId`);
}

/**
 * Create a new CV extraction job (single atomic insert).
 * @param {string|mongoose.Types.ObjectId} documentId - embedded profile.documents subdocument _id
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {'en'|'de'} language - snapshot locale fixed at creation (not live user.language)
 * @returns {Promise<import('mongoose').Document>}
 */
async function createExtractionJob(documentId, userId, language = 'en') {
  const { getRateLimitService } = require('../rateLimit/RateLimitService');
  await getRateLimitService().checkGlobalQueuePressure();

  const { deleteCvExtractedTextCacheForDocument } = require('./cvExtractedTextCacheService');
  await deleteCvExtractedTextCacheForDocument(userId, documentId).catch(() => {});

  const id = new mongoose.Types.ObjectId();
  const snapshotLanguage = normalizeCvJobLanguage(language);
  const job = await CvExtractionJob.create({
    _id: id,
    jobId: id.toString(),
    documentId: toObjectId(documentId, 'documentId'),
    userId: toObjectId(userId, 'userId'),
    language: snapshotLanguage,
    status: 'queued',
    stage: 'upload',
    error: '',
    result: null,
  });
  return job;
}

/**
 * Atomically claim one queued job for processing (at most one winner).
 * @returns {Promise<import('mongoose').Document | null>}
 */
/**
 * Latest job for a user-owned document (indexed documentId + createdAt).
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function findLatestCvExtractionJobForUserDocument(userId, documentId) {
  return CvExtractionJob.findOne({
    userId: toObjectId(userId, 'userId'),
    documentId: toObjectId(documentId, 'documentId'),
  })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * True when any CV extraction job for this document is actively `processing`.
 * @param {string|mongoose.Types.ObjectId} documentId
 * @param {{ excludeJobId?: string }} [opts]
 * @returns {Promise<boolean>}
 */
async function isDocumentCurrentlyProcessing(documentId, opts = {}) {
  const filter = {
    documentId: toObjectId(documentId, 'documentId'),
    status: 'processing',
  };
  const excludeJobId = opts.excludeJobId != null ? String(opts.excludeJobId).trim() : '';
  if (excludeJobId) {
    filter.jobId = { $ne: excludeJobId };
  }
  return Boolean(await CvExtractionJob.exists(filter));
}

/** Max queued jobs to scan when document-level processing blocks a claim. */
const MAX_CLAIM_SCAN = 20;

async function releaseClaimedCvExtractionJob(jobId) {
  const jobIdStr = String(jobId || '').trim();
  if (!jobIdStr) return null;
  return CvExtractionJob.findOneAndUpdate(
    { jobId: jobIdStr, status: 'processing' },
    {
      $set: { status: 'queued', stage: 'upload' },
      $inc: { attemptCount: -1 },
      $unset: { processingStartedAt: '' },
    },
    { new: true }
  );
}

async function claimNextQueuedCvExtractionJob() {
  for (let scan = 0; scan < MAX_CLAIM_SCAN; scan += 1) {
    const processingDocumentIds = await CvExtractionJob.distinct('documentId', { status: 'processing' });
    const claimFilter = {
      status: 'queued',
      $expr: { $lt: [{ $ifNull: ['$attemptCount', 0] }, MAX_RETRIES] },
    };
    if (processingDocumentIds.length > 0) {
      claimFilter.documentId = { $nin: processingDocumentIds };
    }

    const claimed = await CvExtractionJob.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          status: 'processing',
          stage: 'ocr',
          processingStartedAt: new Date(),
        },
        $inc: { attemptCount: 1 },
      },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!claimed) return null;

    const hasConflict = await isDocumentCurrentlyProcessing(claimed.documentId, {
      excludeJobId: claimed.jobId,
    });
    if (hasConflict) {
      await releaseClaimedCvExtractionJob(claimed.jobId);
      continue;
    }
    return claimed;
  }
  return null;
}

const { getExtractionStaleMs } = require('../../../constants/cvExtractionTiming');

function getStaleProcessingCutoffMs() {
  return getExtractionStaleMs();
}

function buildStaleProcessingFilter(cutoff) {
  return {
    status: 'processing',
    $or: [
      { processingStartedAt: { $lt: cutoff } },
      { processingStartedAt: null, updatedAt: { $lt: cutoff } },
    ],
  };
}

async function deactivateFingerprintForJob(jobIdStr) {
  try {
    const { deactivateFingerprintByJobId } = require('../rateLimit/uploadDedupService');
    await deactivateFingerprintByJobId(jobIdStr);
  } catch {
    /* non-fatal */
  }
}

/**
 * Re-queue jobs stuck in `processing` (crash, deploy, hang) so they can be claimed again.
 * Jobs at or above {@link MAX_RETRIES} claims are marked failed instead of requeued.
 * @returns {Promise<{ requeued: number, failedMaxRetries: number }>}
 */
async function reclaimStaleProcessingCvExtractionJobs() {
  const staleMs = getStaleProcessingCutoffMs();
  const cutoff = new Date(Date.now() - staleMs);
  const staleFilter = buildStaleProcessingFilter(cutoff);

  const exceededJobs = await CvExtractionJob.find({
    ...staleFilter,
    $expr: { $gte: [{ $ifNull: ['$attemptCount', 0] }, MAX_RETRIES] },
  })
    .select({ jobId: 1, userId: 1, documentId: 1 })
    .lean();

  let failedMaxRetries = 0;
  for (const job of exceededJobs) {
    const failed = await CvExtractionJob.findOneAndUpdate(
      {
        jobId: job.jobId,
        ...staleFilter,
        $expr: { $gte: [{ $ifNull: ['$attemptCount', 0] }, MAX_RETRIES] },
      },
      {
        $set: {
          status: 'failed',
          errorKey: EXTRACTION_ERROR_KEYS.MAX_RETRIES_EXCEEDED,
          error: '',
          internalError: {
            message: `CV extraction exceeded maximum retry limit (${MAX_RETRIES}).`,
            code: 'MAX_RETRIES_EXCEEDED',
          },
        },
        $unset: { processingStartedAt: '', result: '' },
      },
      { new: true }
    );
    if (!failed) continue;
    failedMaxRetries += 1;
    try {
      await applyCvExtractionFailureToUser(
        job.userId,
        job.documentId,
        EXTRACTION_ERROR_KEYS.MAX_RETRIES_EXCEEDED
      );
    } catch {
      /* non-fatal */
    }
    await deactivateFingerprintForJob(String(job.jobId));
  }

  const res = await CvExtractionJob.updateMany(
    {
      ...staleFilter,
      $expr: { $lt: [{ $ifNull: ['$attemptCount', 0] }, MAX_RETRIES] },
    },
    {
      $set: {
        status: 'queued',
        stage: 'upload',
        error: '',
        errorKey: null,
        internalError: {
          message:
            'Requeued: processing did not finish before stale timeout (worker restart, crash, or hang).',
          code: EXTRACTION_INTERNAL_ERROR_CODES.STALE_REQUEUED,
        },
      },
      $unset: { processingStartedAt: '', result: '' },
    }
  );
  const requeued = res.modifiedCount ?? res.nModified ?? 0;
  return { requeued, failedMaxRetries };
}

/**
 * Update stage (and status) while job is actively `processing`.
 * @returns {Promise<import('mongoose').Document | null>}
 */
async function updateJobStatus(jobId, status, stage) {
  if (status === 'completed' || status === 'failed') {
    return null;
  }
  const jobIdStr = String(jobId || '').trim();
  if (!jobIdStr) return null;

  return CvExtractionJob.findOneAndUpdate(
    { jobId: jobIdStr, status: 'processing' },
    {
      $set: {
        status,
        stage,
      },
    },
    { new: true, timestamps: true }
  );
}

/**
 * Mark job failed (single atomic update, no-op if already terminal).
 * @param {string} jobId
 * @param {unknown} error
 * @param {{ stage?: string }} [opts]
 * @returns {Promise<import('mongoose').Document | null>}
 */
async function failJob(jobId, error, opts = {}) {
  const jobIdStr = String(jobId || '').trim();
  if (!jobIdStr) return null;

  const errorKey = determineExtractionErrorKey(error, opts);
  const internalError = serializeInternalError(error);

  const failed = await CvExtractionJob.findOneAndUpdate(
    { jobId: jobIdStr, status: 'processing' },
    {
      $set: {
        status: 'failed',
        errorKey,
        internalError,
        error: '',
      },
      $unset: { result: '', processingStartedAt: '' },
    },
    { new: true, timestamps: true }
  );

  if (failed) {
    await deactivateFingerprintForJob(jobIdStr);
  }
  return failed;
}

/**
 * Mark job completed and store result (single atomic update, at most one succeeds under concurrency).
 * @returns {Promise<import('mongoose').Document | null>}
 */
async function completeJob(jobId, result) {
  const jobIdStr = String(jobId || '').trim();
  if (!jobIdStr) return null;

  const completed = await CvExtractionJob.findOneAndUpdate(
    { jobId: jobIdStr, status: 'processing' },
    {
      $set: {
        status: 'completed',
        result: result === undefined ? null : result,
      },
      $unset: { error: '', errorKey: '', internalError: '', processingStartedAt: '' },
    },
    { new: true, timestamps: true }
  );

  if (completed) {
    await deactivateFingerprintForJob(jobIdStr);
  }
  return completed;
}

const { buildZombieSignalsForJob, getPublicWorkerHealthForExtractionStatus } = require('./cvExtractionZombieSignals');
const { buildCvExtractionStatusResponse, resolveExtractionMachineStatus } = require('./cvExtractionStatus');
const { isCvDocumentType } = require('../../../constants/documentTypes');

/**
 * User-initiated retry for a stuck or failed CV extraction (idempotent).
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string|mongoose.Types.ObjectId} params.documentId
 * @param {object|null} [params.doc] embedded document
 * @param {'en'|'de'} [params.language]
 * @returns {Promise<
 *   | { ok: true, action: 'requeued'|'created'|'already_active'|'already_processing'|'noop', job: object, statusPayload: object, retryRecommended?: boolean }
 *   | { ok: false, code: 'NOT_CV'|'NOT_FOUND'|'ALREADY_COMPLETED'|'MAX_RETRIES', message: string }
 * >}
 */
async function retryCvExtractionForDocument({ userId, documentId, doc, language = 'en' }) {
  if (!doc || !isCvDocumentType(doc.type)) {
    return { ok: false, code: 'NOT_CV', message: 'Document is not a CV' };
  }

  const now = new Date();
  const job = await findLatestCvExtractionJobForUserDocument(userId, documentId);
  const { workerHealthSignal } = await getPublicWorkerHealthForExtractionStatus(now);

  if (await isDocumentCurrentlyProcessing(documentId)) {
    const activeJob =
      job?.status === 'processing'
        ? job
        : await CvExtractionJob.findOne({
            documentId: toObjectId(documentId, 'documentId'),
            status: 'processing',
          })
            .sort({ createdAt: -1 })
            .lean();
    const statusPayload = buildCvExtractionStatusResponse({
      documentId,
      doc,
      job: activeJob || job,
      now,
      workerHealthSignal,
    });
    return {
      ok: true,
      action: 'already_processing',
      retryRecommended: false,
      job: activeJob || job,
      statusPayload,
    };
  }

  if (job?.status === 'completed') {
    const { status } = resolveExtractionMachineStatus({ doc, job });
    if (status === 'completed') {
      return { ok: false, code: 'ALREADY_COMPLETED', message: 'Extraction already completed' };
    }
  }

  if (job && job.status === 'queued') {
    const { status } = resolveExtractionMachineStatus({ doc, job });
    const elapsedMs = job.createdAt
      ? Math.max(0, now.getTime() - new Date(job.createdAt).getTime())
      : 0;
    const zombie = buildZombieSignalsForJob({
      status,
      elapsedMs,
      job,
      doc,
      now,
      workerHealthSignal,
    });

    if (!zombie.retryRecommended) {
      const statusPayload = buildCvExtractionStatusResponse({
        documentId,
        doc,
        job,
        now,
        workerHealthSignal,
      });
      return {
        ok: true,
        action: 'already_active',
        job,
        statusPayload,
      };
    }

    const statusPayload = buildCvExtractionStatusResponse({
      documentId,
      doc,
      job,
      now,
      workerHealthSignal,
    });
    return { ok: true, action: 'noop', job, statusPayload };
  }

  if (job?.status === 'failed') {
    const attempts = jobAttemptCount(job);
    if (attempts >= MAX_RETRIES) {
      return { ok: false, code: 'MAX_RETRIES', message: 'Maximum retry attempts reached' };
    }
  }

  const { getRateLimitService } = require('../rateLimit/RateLimitService');
  await getRateLimitService().assertJobCreationAllowed(userId);

  const newJob = await createExtractionJob(documentId, userId, language);

  const User = require('../../models/User');
  await User.updateOne(
    { _id: toObjectId(userId, 'userId'), 'profile.documents._id': toObjectId(documentId, 'documentId') },
    { $set: { 'profile.documents.$.extractionStatus': 'queued' } }
  );

  const statusPayload = buildCvExtractionStatusResponse({
    documentId,
    doc: { ...doc, extractionStatus: 'queued' },
    job: newJob.toObject ? newJob.toObject() : newJob,
    now,
    workerHealthSignal,
  });

  return { ok: true, action: 'created', job: newJob, statusPayload };
}

module.exports = {
  MAX_RETRIES,
  jobAttemptCount,
  createExtractionJob,
  updateJobStatus,
  failJob,
  completeJob,
  isDocumentCurrentlyProcessing,
  claimNextQueuedCvExtractionJob,
  reclaimStaleProcessingCvExtractionJobs,
  findLatestCvExtractionJobForUserDocument,
  retryCvExtractionForDocument,
};
