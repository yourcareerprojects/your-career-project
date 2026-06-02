const CvExtractionJob = require('../../models/CvExtractionJob');
const { MAX_RETRIES } = require('../documents/cvExtractionJobService');

const ACTIVE_STATUSES = ['queued', 'processing'];
const ALL_TRACKED_STATUSES = ['queued', 'processing', 'completed', 'failed'];

/**
 * @param {Date|string|null|undefined} value
 * @param {number} nowMs
 * @returns {number|null}
 */
function ageMsFromDate(value, nowMs) {
  if (value == null) return null;
  let ts;
  if (value instanceof Date) {
    ts = value.getTime();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    ts = value;
  } else {
    ts = Date.parse(String(value));
  }
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, nowMs - ts);
}

/**
 * @param {Array<{ _id: string, count: number }>} rows
 */
function countsFromStatusGroups(rows) {
  const counts = {
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };
  for (const row of rows) {
    if (row._id in counts) counts[row._id] = row.count;
  }
  return counts;
}

/**
 * Active queue depth + age metrics (indexed status filters, small working set).
 * @param {{ now?: Date }} [opts]
 */
async function getCvExtractionQueueActiveMetrics(opts = {}) {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  const [facetResult, retrying] = await Promise.all([
    CvExtractionJob.aggregate([
      { $match: { status: { $in: ACTIVE_STATUSES } } },
      {
        $facet: {
          statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          queuedAge: [
            { $match: { status: 'queued' } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                oldestCreatedAt: { $min: '$createdAt' },
                averageQueuedAgeMs: {
                  $avg: { $subtract: [now, '$createdAt'] },
                },
              },
            },
          ],
          processingAge: [
            { $match: { status: 'processing' } },
            {
              $project: {
                startedAt: { $ifNull: ['$processingStartedAt', '$updatedAt'] },
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                oldestStartedAt: { $min: '$startedAt' },
              },
            },
          ],
        },
      },
    ]),
    CvExtractionJob.countDocuments({
      status: { $in: ACTIVE_STATUSES },
      $expr: { $gte: [{ $ifNull: ['$attemptCount', 0] }, 2] },
    }),
  ]);

  const facet = facetResult[0] || {};
  const activeCounts = countsFromStatusGroups(facet.statusCounts || []);
  const queuedAgeRow = facet.queuedAge?.[0] || null;
  const processingAgeRow = facet.processingAge?.[0] || null;

  const oldestQueuedMs = ageMsFromDate(queuedAgeRow?.oldestCreatedAt, nowMs);
  const averageQueuedMs =
    queuedAgeRow?.averageQueuedAgeMs != null && Number.isFinite(queuedAgeRow.averageQueuedAgeMs)
      ? Math.max(0, Math.round(queuedAgeRow.averageQueuedAgeMs))
      : null;
  const longestProcessingMs = ageMsFromDate(processingAgeRow?.oldestStartedAt, nowMs);

  return {
    counts: {
      queued: activeCounts.queued,
      processing: activeCounts.processing,
      retrying,
    },
    ages: {
      oldestQueuedMs,
      averageQueuedMs,
      longestProcessingMs,
    },
    meta: {
      maxRetries: MAX_RETRIES,
      sampledAt: now.toISOString(),
    },
  };
}

/**
 * Full queue metrics for ops dashboards (active metrics + terminal status counts).
 * Terminal counts use indexed `status` equality — cost scales with completed/failed volume.
 * @param {{ now?: Date, includeTerminalCounts?: boolean }} [opts]
 */
async function getCvExtractionQueueMetrics(opts = {}) {
  const now = opts.now ?? new Date();
  const includeTerminalCounts = opts.includeTerminalCounts !== false;

  const active = await getCvExtractionQueueActiveMetrics({ now });

  let completed = 0;
  let failed = 0;
  if (includeTerminalCounts) {
    [completed, failed] = await Promise.all([
      CvExtractionJob.countDocuments({ status: 'completed' }),
      CvExtractionJob.countDocuments({ status: 'failed' }),
    ]);
  }

  return {
    counts: {
      queued: active.counts.queued,
      processing: active.counts.processing,
      completed,
      failed,
      retrying: active.counts.retrying,
    },
    ages: active.ages,
    meta: {
      ...active.meta,
      includeTerminalCounts,
    },
  };
}

/**
 * Flat counts for legacy callers (`getCvExtractionQueueStats`).
 * @param {{ now?: Date }} [opts]
 */
async function getCvExtractionQueueStats(opts = {}) {
  const metrics = await getCvExtractionQueueMetrics(opts);
  return {
    queued: metrics.counts.queued,
    processing: metrics.counts.processing,
    completed: metrics.counts.completed,
    failed: metrics.counts.failed,
    retrying: metrics.counts.retrying,
  };
}

/**
 * Derived backlog signals from a metrics snapshot.
 * @param {Awaited<ReturnType<typeof getCvExtractionQueueMetrics>>} metrics
 * @param {{ previousQueued?: number|null, workerAvailability?: string }} [ctx]
 */
function deriveQueueSignals(metrics, ctx = {}) {
  const { counts, ages } = metrics;
  const previousQueued =
    typeof ctx.previousQueued === 'number' && Number.isFinite(ctx.previousQueued)
      ? ctx.previousQueued
      : null;
  const queuedDelta =
    previousQueued == null ? null : counts.queued - previousQueued;

  return {
    backlogPresent: counts.queued > 0,
    backlogGrowing: queuedDelta != null ? queuedDelta > 0 : null,
    queuedDeltaSinceLastSample: queuedDelta,
    staleQueuedJob:
      ages.oldestQueuedMs != null && ages.oldestQueuedMs >= 5 * 60 * 1000,
    longRunningProcessing:
      ages.longestProcessingMs != null && ages.longestProcessingMs >= 10 * 60 * 1000,
    retryPressure: counts.retrying > 0,
    workerUnavailableWithBacklog:
      ctx.workerAvailability != null &&
      ctx.workerAvailability !== 'healthy' &&
      counts.queued > 0,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  ALL_TRACKED_STATUSES,
  getCvExtractionQueueActiveMetrics,
  getCvExtractionQueueMetrics,
  getCvExtractionQueueStats,
  deriveQueueSignals,
  ageMsFromDate,
};
