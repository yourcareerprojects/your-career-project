const CvExtractionJob = require('../models/CvExtractionJob');
const User = require('../models/User');
const { EXTRACTION_ERROR_KEYS } = require('../../constants/cvExtractionErrors');
const { getExtractionStaleMs } = require('../../constants/cvExtractionTiming');
const {
  MAX_RETRIES,
  jobAttemptCount,
  createExtractionJob,
  claimNextQueuedCvExtractionJob,
  reclaimStaleProcessingCvExtractionJobs,
  isDocumentCurrentlyProcessing,
  retryCvExtractionForDocument,
} = require('../services/documents/cvExtractionJobService');

describe('cvExtractionJob retries', () => {
  let userId;
  let documentId;

  beforeEach(async () => {
    const user = await User.create({
      email: `retry-test-${Date.now()}@example.com`,
      password: 'test-password-123',
      profile: {
        documents: [
          {
            type: 'cv',
            name: 'cv.pdf',
            path: '/tmp/cv.pdf',
            uploadDate: new Date(),
          },
        ],
      },
    });
    userId = user._id;
    documentId = user.profile.documents[0]._id;
  });

  test('jobAttemptCount treats missing attemptCount as 0', () => {
    expect(jobAttemptCount({})).toBe(0);
    expect(jobAttemptCount({ attemptCount: null })).toBe(0);
    expect(jobAttemptCount({ attemptCount: 2 })).toBe(2);
  });

  test('claimNextQueuedCvExtractionJob increments attemptCount', async () => {
    const job = await createExtractionJob(documentId, userId, 'en');
    const claimed = await claimNextQueuedCvExtractionJob();
    expect(claimed).not.toBeNull();
    expect(String(claimed.jobId)).toBe(String(job.jobId));
    expect(claimed.attemptCount).toBe(1);

    const reloaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(reloaded.attemptCount).toBe(1);
    expect(reloaded.status).toBe('processing');
  });

  test('legacy job without attemptCount starts at 1 on first claim', async () => {
    const job = await createExtractionJob(documentId, userId, 'en');
    await CvExtractionJob.updateOne({ jobId: job.jobId }, { $unset: { attemptCount: '' } });

    const claimed = await claimNextQueuedCvExtractionJob();
    expect(claimed.attemptCount).toBe(1);
  });

  test('stale reclaim requeues only when attemptCount is below MAX_RETRIES', async () => {
    const job = await createExtractionJob(documentId, userId, 'en');
    const staleAt = new Date(Date.now() - getExtractionStaleMs() - 60_000);
    await CvExtractionJob.updateOne(
      { jobId: job.jobId },
      {
        $set: {
          status: 'processing',
          stage: 'ocr',
          attemptCount: 2,
          processingStartedAt: staleAt,
        },
      }
    );

    const { requeued, failedMaxRetries } = await reclaimStaleProcessingCvExtractionJobs();
    expect(requeued).toBe(1);
    expect(failedMaxRetries).toBe(0);

    const reloaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(reloaded.status).toBe('queued');
    expect(reloaded.attemptCount).toBe(2);
  });

  test('stale reclaim fails job when attemptCount reached MAX_RETRIES', async () => {
    const job = await createExtractionJob(documentId, userId, 'en');
    const staleAt = new Date(Date.now() - getExtractionStaleMs() - 60_000);
    await CvExtractionJob.updateOne(
      { jobId: job.jobId },
      {
        $set: {
          status: 'processing',
          stage: 'ocr',
          attemptCount: MAX_RETRIES,
          processingStartedAt: staleAt,
        },
      }
    );

    const { requeued, failedMaxRetries } = await reclaimStaleProcessingCvExtractionJobs();
    expect(requeued).toBe(0);
    expect(failedMaxRetries).toBe(1);

    const reloaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(reloaded.status).toBe('failed');
    expect(reloaded.errorKey).toBe(EXTRACTION_ERROR_KEYS.MAX_RETRIES_EXCEEDED);
  });

  test('failed jobs are not requeued by stale reclaim', async () => {
    const job = await createExtractionJob(documentId, userId, 'en');
    const staleAt = new Date(Date.now() - getExtractionStaleMs() - 60_000);
    await CvExtractionJob.updateOne(
      { jobId: job.jobId },
      {
        $set: {
          status: 'failed',
          errorKey: EXTRACTION_ERROR_KEYS.OCR_FAILED,
          attemptCount: 1,
          processingStartedAt: staleAt,
        },
      }
    );

    const { requeued, failedMaxRetries } = await reclaimStaleProcessingCvExtractionJobs();
    expect(requeued).toBe(0);
    expect(failedMaxRetries).toBe(0);

    const reloaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(reloaded.status).toBe('failed');
    expect(reloaded.errorKey).toBe(EXTRACTION_ERROR_KEYS.OCR_FAILED);
  });

  test('isDocumentCurrentlyProcessing is true only while status is processing', async () => {
    const job = await createExtractionJob(documentId, userId, 'en');
    expect(await isDocumentCurrentlyProcessing(documentId)).toBe(false);

    await CvExtractionJob.updateOne({ jobId: job.jobId }, { $set: { status: 'processing' } });
    expect(await isDocumentCurrentlyProcessing(documentId)).toBe(true);
    expect(await isDocumentCurrentlyProcessing(documentId, { excludeJobId: job.jobId })).toBe(
      false
    );

    await CvExtractionJob.updateOne({ jobId: job.jobId }, { $set: { status: 'queued' } });
    expect(await isDocumentCurrentlyProcessing(documentId)).toBe(false);
  });

  test('claimNextQueuedCvExtractionJob skips document with another processing job', async () => {
    const jobA = await createExtractionJob(documentId, userId, 'en');
    const jobB = await createExtractionJob(documentId, userId, 'en');

    await CvExtractionJob.updateOne(
      { jobId: jobA.jobId },
      {
        $set: {
          status: 'processing',
          stage: 'ocr',
          processingStartedAt: new Date(),
          attemptCount: 1,
        },
      }
    );

    const claimed = await claimNextQueuedCvExtractionJob();
    expect(claimed).toBeNull();

    const reloadedB = await CvExtractionJob.findOne({ jobId: jobB.jobId }).lean();
    expect(reloadedB.status).toBe('queued');
  });

  test('retryCvExtractionForDocument does not requeue while document is processing', async () => {
    const job = await createExtractionJob(documentId, userId, 'en');
    await CvExtractionJob.updateOne(
      { jobId: job.jobId },
      {
        $set: {
          status: 'processing',
          stage: 'ocr',
          processingStartedAt: new Date(),
          attemptCount: 1,
        },
      }
    );

    const user = await User.findById(userId).lean();
    const doc = user.profile.documents[0];

    const result = await retryCvExtractionForDocument({
      userId,
      documentId,
      doc,
      language: 'en',
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe('already_processing');
    expect(result.retryRecommended).toBe(false);

    const reloaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(reloaded.status).toBe('processing');
  });

  test('queued job at MAX_RETRIES is not claimed again', async () => {
    const job = await createExtractionJob(documentId, userId, 'en');
    await CvExtractionJob.updateOne(
      { jobId: job.jobId },
      { $set: { status: 'queued', attemptCount: MAX_RETRIES } }
    );

    const claimed = await claimNextQueuedCvExtractionJob();
    expect(claimed).toBeNull();

    const reloaded = await CvExtractionJob.findOne({ jobId: job.jobId }).lean();
    expect(reloaded.status).toBe('queued');
    expect(reloaded.attemptCount).toBe(MAX_RETRIES);
  });
});
