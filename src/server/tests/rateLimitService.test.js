const mongoose = require('mongoose');
const MemoryRateLimitStore = require('../services/rateLimit/MemoryRateLimitStore');
const { RateLimitService, resetRateLimitServiceForTests } = require('../services/rateLimit/RateLimitService');
const RateLimitError = require('../services/rateLimit/RateLimitError');
const CvExtractionJob = require('../models/CvExtractionJob');
const User = require('../models/User');
const {
  computeUploadContentHash,
  computeUploadContentHashFromPath,
  findActiveDuplicateUpload,
  registerUploadFingerprint,
} = require('../services/rateLimit/uploadDedupService');
const { resetRateLimitStoreForTests } = require('../services/rateLimit/createRateLimitStore');
const { MAX_GLOBAL_QUEUED_JOBS } = require('../config/rateLimitConfig');
const { createExtractionJob } = require('../services/documents/cvExtractionJobService');

describe('RateLimitService', () => {
  let service;
  let userId;

  beforeEach(async () => {
    resetRateLimitServiceForTests();
    resetRateLimitStoreForTests();
    service = new RateLimitService(new MemoryRateLimitStore());
    const user = await User.create({
      email: `rl-${Date.now()}@example.com`,
      password: 'Test123!@#',
    });
    userId = user._id;
  });

  test('allows uploads under per-minute limit', async () => {
    await service.recordUploadAttempt(userId);
    await service.recordUploadAttempt(userId);
    await expect(service.assertUploadLimitsOnly(userId)).resolves.toBeUndefined();
  });

  test('blocks when uploads per minute exceeded', async () => {
    await service.recordUploadAttempt(userId);
    await service.recordUploadAttempt(userId);
    await service.recordUploadAttempt(userId);
    await expect(service.assertUploadLimitsOnly(userId)).rejects.toBeInstanceOf(RateLimitError);
    try {
      await service.assertUploadLimitsOnly(userId);
    } catch (e) {
      expect(e.limitType).toBe('uploads_per_minute');
      expect(e.statusCode).toBe(429);
      expect(e.toJSON().errorKey).toBe('RATE_LIMITED');
      expect(e.toJSON().message).toBeTruthy();
      expect(JSON.stringify(e.toJSON())).not.toMatch(/stack/i);
    }
  });

  test('blocks when concurrent extraction jobs at cap', async () => {
    const docId = new mongoose.Types.ObjectId();
    await CvExtractionJob.create({
      _id: new mongoose.Types.ObjectId(),
      jobId: new mongoose.Types.ObjectId().toString(),
      documentId: docId,
      userId,
      language: 'en',
      status: 'queued',
      stage: 'upload',
    });
    await CvExtractionJob.create({
      _id: new mongoose.Types.ObjectId(),
      jobId: new mongoose.Types.ObjectId().toString(),
      documentId: new mongoose.Types.ObjectId(),
      userId,
      language: 'en',
      status: 'processing',
      stage: 'ocr',
    });
    await expect(service.checkConcurrentJobs(userId)).rejects.toMatchObject({
      limitType: 'concurrent_jobs',
    });
  });

  test('allows global queue when queued count is below limit', async () => {
    jest.spyOn(service, 'countGlobalQueuedJobs').mockResolvedValue(MAX_GLOBAL_QUEUED_JOBS - 1);
    await expect(service.checkGlobalQueuePressure()).resolves.toBe(MAX_GLOBAL_QUEUED_JOBS - 1);
    jest.restoreAllMocks();
  });

  test('blocks when global queued jobs at cap', async () => {
    jest.spyOn(service, 'countGlobalQueuedJobs').mockResolvedValue(MAX_GLOBAL_QUEUED_JOBS);
    await expect(service.checkGlobalQueuePressure()).rejects.toMatchObject({
      limitType: 'global_queue',
      statusCode: 429,
      message: 'System busy, please try again shortly',
    });
    jest.restoreAllMocks();
  });

  test('countGlobalQueuedJobs only includes queued status', async () => {
    const docId = new mongoose.Types.ObjectId();
    const procId = new mongoose.Types.ObjectId();
    await CvExtractionJob.create({
      _id: procId,
      jobId: procId.toString(),
      documentId: new mongoose.Types.ObjectId(),
      userId,
      language: 'en',
      status: 'processing',
      stage: 'ocr',
    });
    await CvExtractionJob.create({
      _id: docId,
      jobId: docId.toString(),
      documentId: new mongoose.Types.ObjectId(),
      userId,
      language: 'en',
      status: 'queued',
      stage: 'upload',
    });
    expect(await service.countGlobalQueuedJobs()).toBe(1);
  });

  test('older events fall outside minute window after prune', async () => {
    const store = service.store;
    const key = String(userId);
    const old = Date.now() - 2 * 60 * 1000;
    store.eventsByUser.set(key, [old, old, old]);
    await expect(service.assertUploadLimitsOnly(userId)).resolves.toBeUndefined();
  });
});

describe('createExtractionJob global queue gate', () => {
  let userId;
  let documentId;

  beforeEach(async () => {
    resetRateLimitServiceForTests();
    const user = await User.create({
      email: `global-gate-${Date.now()}@example.com`,
      password: 'Test123!@#',
      profile: {
        documents: [{
          type: 'cv',
          name: 'cv.pdf',
          path: '/tmp/cv.pdf',
          uploadDate: new Date(),
        }],
      },
    });
    userId = user._id;
    documentId = user.profile.documents[0]._id;
  });

  test('rejects job creation when global queue is at capacity', async () => {
    const { getRateLimitService } = require('../services/rateLimit/RateLimitService');
    const rl = getRateLimitService();
    jest.spyOn(rl, 'checkGlobalQueuePressure').mockRejectedValue(
      new RateLimitError('global_queue')
    );
    await expect(createExtractionJob(documentId, userId, 'en')).rejects.toMatchObject({
      limitType: 'global_queue',
      statusCode: 429,
    });
    const created = await CvExtractionJob.countDocuments({ documentId });
    expect(created).toBe(0);
    jest.restoreAllMocks();
  });
});

describe('upload deduplication', () => {
  let userId;
  let documentId;

  beforeEach(async () => {
    const user = await User.create({
      email: `dedup-${Date.now()}@example.com`,
      password: 'Test123!@#',
      profile: {
        documents: [{
          type: 'cv',
          name: 'cv.pdf',
          path: '/tmp/cv.pdf',
          uploadDate: new Date(),
          extractionStatus: 'queued',
        }],
      },
    });
    userId = user._id;
    documentId = user.profile.documents[0]._id;
  });

  test('computeUploadContentHash is stable for same bytes', () => {
    const buf = Buffer.from('same-content');
    expect(computeUploadContentHash(buf)).toBe(computeUploadContentHash(buf));
  });

  test('computeUploadContentHashFromPath matches buffer hash', async () => {
    const fs = require('fs').promises;
    const os = require('os');
    const path = require('path');
    const buf = Buffer.from('stream-hash-content');
    const tmpPath = path.join(os.tmpdir(), `cv-hash-test-${Date.now()}.bin`);
    await fs.writeFile(tmpPath, buf);
    try {
      expect(await computeUploadContentHashFromPath(tmpPath)).toBe(computeUploadContentHash(buf));
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  test('findActiveDuplicateUpload returns existing job when fingerprint active', async () => {
    const hash = computeUploadContentHash(Buffer.from('duplicate-me'));
    const jobId = new mongoose.Types.ObjectId().toString();
    await registerUploadFingerprint({
      userId,
      contentHash: hash,
      documentId,
      jobId,
    });
    await CvExtractionJob.create({
      _id: new mongoose.Types.ObjectId(),
      jobId,
      documentId,
      userId,
      language: 'en',
      status: 'queued',
      stage: 'upload',
    });
    const dup = await findActiveDuplicateUpload(userId, hash);
    expect(dup).not.toBeNull();
    expect(String(dup.documentId)).toBe(String(documentId));
    expect(dup.jobId).toBe(jobId);
  });
});
