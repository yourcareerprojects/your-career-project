const mongoose = require('mongoose');

const CvExtractionJob = require('../models/CvExtractionJob');
const CvWorkerHeartbeat = require('../models/CvWorkerHeartbeat');
const {
  classifyWorkerAvailability,
  getCvExtractionQueueStats,
  getCvWorkerHealthSnapshot,
  aggregateWorkerAvailability,
} = require('../services/cv/cvWorkerHealthService');
const {
  recordWorkerHeartbeat,
  resetCachedCvWorkerIdForTests,
} = require('../services/cv/cvWorkerHeartbeatService');
const {
  CV_WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT,
  CV_WORKER_HEARTBEAT_STALE_MS_DEFAULT,
} = require('../../constants/cvWorkerHealth');

describe('cvWorkerHealth', () => {
  beforeEach(() => {
    resetCachedCvWorkerIdForTests(null);
  });

  describe('classifyWorkerAvailability', () => {
    test('returns missing when heartbeat timestamp is absent', () => {
      expect(classifyWorkerAvailability(null, new Date('2026-01-01T00:00:30.000Z'), 45_000)).toBe('missing');
    });

    test('returns healthy when heartbeat is within stale threshold', () => {
      const now = new Date('2026-01-01T00:01:00.000Z');
      const last = new Date('2026-01-01T00:00:30.000Z');
      expect(classifyWorkerAvailability(last, now, 45_000)).toBe('healthy');
    });

    test('returns stale when heartbeat exceeds stale threshold', () => {
      const now = new Date('2026-01-01T00:02:00.000Z');
      const last = new Date('2026-01-01T00:00:00.000Z');
      expect(classifyWorkerAvailability(last, now, 45_000)).toBe('stale');
    });
  });

  describe('aggregateWorkerAvailability', () => {
    test('returns missing when no workers registered', () => {
      expect(aggregateWorkerAvailability([])).toBe('missing');
    });

    test('returns healthy when any worker is healthy', () => {
      expect(
        aggregateWorkerAvailability([
          { availability: 'stale' },
          { availability: 'healthy' },
        ])
      ).toBe('healthy');
    });

    test('returns stale when workers exist but none are healthy', () => {
      expect(
        aggregateWorkerAvailability([
          { availability: 'stale' },
          { availability: 'missing' },
        ])
      ).toBe('stale');
    });
  });

  describe('getCvExtractionQueueStats', () => {
    test('counts queued, processing, and failed jobs', async () => {
      const userId = new mongoose.Types.ObjectId();
      const docId = new mongoose.Types.ObjectId();

      await CvExtractionJob.create([
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'queued',
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'queued',
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'processing',
          processingStartedAt: new Date(),
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'failed',
          errorKey: 'EXTRACTION_FAILED',
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'completed',
          result: { profile: {} },
        },
      ]);

      await expect(getCvExtractionQueueStats()).resolves.toEqual({
        queued: 2,
        processing: 1,
        completed: 1,
        failed: 1,
        retrying: 0,
      });
    });
  });

  describe('getCvWorkerHealthSnapshot', () => {
    test('reports missing worker when no heartbeat documents exist', async () => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      const snapshot = await getCvWorkerHealthSnapshot({ now, staleMs: 45_000 });

      expect(snapshot.ok).toBe(false);
      expect(snapshot.worker.availability).toBe('missing');
      expect(snapshot.worker.count).toBe(0);
      expect(snapshot.queue).toMatchObject({
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        retrying: 0,
        ages: {
          oldestQueuedMs: null,
          averageQueuedMs: null,
          longestProcessingMs: null,
        },
      });
      expect(snapshot.thresholds.defaults).toEqual({
        heartbeatIntervalMs: CV_WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT,
        staleMs: CV_WORKER_HEARTBEAT_STALE_MS_DEFAULT,
      });
      expect(snapshot.signals.workerMissing).toBe(true);
      expect(snapshot.signals.backlogRisk).toBe(false);
    });

    test('reports healthy worker with queue visibility', async () => {
      const now = new Date('2026-01-01T00:01:00.000Z');
      resetCachedCvWorkerIdForTests('test-worker-1');

      await recordWorkerHeartbeat({
        workerId: 'test-worker-1',
        status: 'idle',
        activeJobs: 0,
        metadata: { batchSize: 2, concurrency: 1 },
      });

      const userId = new mongoose.Types.ObjectId();
      const docId = new mongoose.Types.ObjectId();
      await CvExtractionJob.create({
        jobId: new mongoose.Types.ObjectId().toString(),
        userId,
        documentId: docId,
        language: 'en',
        status: 'queued',
      });

      const heartbeat = await CvWorkerHeartbeat.findOne({ workerId: 'test-worker-1' }).lean();
      await CvWorkerHeartbeat.updateOne(
        { workerId: 'test-worker-1' },
        { $set: { lastHeartbeatAt: new Date('2026-01-01T00:00:50.000Z') } }
      );

      const snapshot = await getCvWorkerHealthSnapshot({ now, staleMs: 45_000 });

      expect(snapshot.ok).toBe(true);
      expect(snapshot.worker.availability).toBe('healthy');
      expect(snapshot.worker.workers).toHaveLength(1);
      expect(snapshot.worker.workers[0].workerId).toBe('test-worker-1');
      expect(snapshot.worker.workers[0].availability).toBe('healthy');
      expect(snapshot.worker.workers[0].status).toBe('idle');
      expect(snapshot.queue.queued).toBe(1);
      expect(snapshot.signals.backlogRisk).toBe(false);
      expect(heartbeat).toBeTruthy();
    });

    test('flags backlog risk when worker is stale and jobs are queued', async () => {
      const now = new Date('2026-01-01T00:05:00.000Z');
      resetCachedCvWorkerIdForTests('stale-worker');

      await CvWorkerHeartbeat.create({
        workerId: 'stale-worker',
        status: 'idle',
        lastHeartbeatAt: new Date('2026-01-01T00:00:00.000Z'),
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        activeJobs: 0,
      });

      const userId = new mongoose.Types.ObjectId();
      const docId = new mongoose.Types.ObjectId();
      await CvExtractionJob.create({
        jobId: new mongoose.Types.ObjectId().toString(),
        userId,
        documentId: docId,
        language: 'en',
        status: 'queued',
      });

      const snapshot = await getCvWorkerHealthSnapshot({ now, staleMs: 45_000 });

      expect(snapshot.ok).toBe(false);
      expect(snapshot.worker.availability).toBe('stale');
      expect(snapshot.signals.workerStale).toBe(true);
      expect(snapshot.signals.backlogRisk).toBe(true);
      expect(snapshot.queue.queued).toBe(1);
    });
  });
});
