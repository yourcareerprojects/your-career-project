const mongoose = require('mongoose');

const CvExtractionJob = require('../models/CvExtractionJob');
const {
  getCvExtractionQueueActiveMetrics,
  getCvExtractionQueueMetrics,
  deriveQueueSignals,
  ageMsFromDate,
} = require('../services/cv/cvExtractionQueueMetricsService');
const { createCvQueueMetricsLogLoop } = require('../services/cv/cvQueueMetricsLogger');

describe('cvExtractionQueueMetrics', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');

  describe('ageMsFromDate', () => {
    test('returns age in milliseconds', () => {
      expect(ageMsFromDate(new Date('2026-05-31T11:59:30.000Z'), now.getTime())).toBe(30_000);
    });

    test('returns null for invalid input', () => {
      expect(ageMsFromDate(null, now.getTime())).toBeNull();
    });
  });

  describe('getCvExtractionQueueActiveMetrics', () => {
    test('returns active counts, retrying count, and queue ages', async () => {
      const userId = new mongoose.Types.ObjectId();
      const docId = new mongoose.Types.ObjectId();

      await CvExtractionJob.create([
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'queued',
          createdAt: new Date('2026-05-31T11:58:00.000Z'),
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'queued',
          createdAt: new Date('2026-05-31T11:59:00.000Z'),
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'processing',
          attemptCount: 2,
          processingStartedAt: new Date('2026-05-31T11:55:00.000Z'),
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'queued',
          attemptCount: 2,
          createdAt: new Date('2026-05-31T11:57:00.000Z'),
        },
      ]);

      const active = await getCvExtractionQueueActiveMetrics({ now });

      expect(active.counts).toEqual({
        queued: 3,
        processing: 1,
        retrying: 2,
      });
      expect(active.ages.oldestQueuedMs).toBe(3 * 60 * 1000);
      expect(active.ages.averageQueuedMs).toBe(2 * 60 * 1000);
      expect(active.ages.longestProcessingMs).toBe(5 * 60 * 1000);
    });
  });

  describe('getCvExtractionQueueMetrics', () => {
    test('includes terminal status counts', async () => {
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
          status: 'processing',
          processingStartedAt: now,
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'completed',
          result: { profile: {} },
        },
        {
          jobId: new mongoose.Types.ObjectId().toString(),
          userId,
          documentId: docId,
          language: 'en',
          status: 'failed',
          errorKey: 'EXTRACTION_FAILED',
        },
      ]);

      await expect(getCvExtractionQueueMetrics({ now })).resolves.toMatchObject({
        counts: {
          queued: 1,
          processing: 1,
          completed: 1,
          failed: 1,
          retrying: 0,
        },
      });
    });
  });

  describe('deriveQueueSignals', () => {
    test('detects backlog growth between samples', () => {
      const metrics = {
        counts: { queued: 5, processing: 1, completed: 0, failed: 0, retrying: 0 },
        ages: { oldestQueuedMs: 60_000, averageQueuedMs: 30_000, longestProcessingMs: 120_000 },
        meta: {},
      };

      const signals = deriveQueueSignals(metrics, { previousQueued: 3, workerAvailability: 'healthy' });

      expect(signals.backlogPresent).toBe(true);
      expect(signals.backlogGrowing).toBe(true);
      expect(signals.queuedDeltaSinceLastSample).toBe(2);
      expect(signals.workerUnavailableWithBacklog).toBe(false);
    });
  });

  describe('createCvQueueMetricsLogLoop', () => {
    test('logs structured queue metrics without throwing', async () => {
      const loop = createCvQueueMetricsLogLoop({ intervalMs: 60_000, source: 'test' });
      await expect(loop.tick()).resolves.toBeUndefined();
    });
  });
});
