const CvWorkerHeartbeat = require('../../models/CvWorkerHeartbeat');
const {
  getCvWorkerHeartbeatStaleMs,
  getCvWorkerHeartbeatIntervalMs,
  CV_WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT,
  CV_WORKER_HEARTBEAT_STALE_MS_DEFAULT,
} = require('../../../constants/cvWorkerHealth');
const {
  getCvExtractionQueueMetrics,
  getCvExtractionQueueStats,
  deriveQueueSignals,
} = require('./cvExtractionQueueMetricsService');

/**
 * @typedef {'healthy'|'stale'|'missing'} WorkerAvailabilityState
 */

/**
 * @param {Date|string|null|undefined} lastHeartbeatAt
 * @param {Date} [now]
 * @param {number} [staleMs]
 * @returns {WorkerAvailabilityState}
 */
function classifyWorkerAvailability(lastHeartbeatAt, now = new Date(), staleMs = getCvWorkerHeartbeatStaleMs()) {
  if (!lastHeartbeatAt) return 'missing';
  const ts = lastHeartbeatAt instanceof Date ? lastHeartbeatAt.getTime() : Date.parse(String(lastHeartbeatAt));
  if (!Number.isFinite(ts)) return 'missing';
  return now.getTime() - ts <= staleMs ? 'healthy' : 'stale';
}

/**
 * @param {Record<string, unknown>|null} doc
 * @param {Date} now
 * @param {number} staleMs
 */
function serializeWorkerHeartbeat(doc, now, staleMs) {
  if (!doc) {
    return {
      workerId: null,
      status: null,
      availability: /** @type {WorkerAvailabilityState} */ ('missing'),
      lastHeartbeatAt: null,
      lastHeartbeatAgeMs: null,
      startedAt: null,
      activeJobs: 0,
      host: null,
      pid: null,
      metadata: null,
    };
  }

  const lastHeartbeatAt = doc.lastHeartbeatAt ? new Date(doc.lastHeartbeatAt) : null;
  const availability = classifyWorkerAvailability(lastHeartbeatAt, now, staleMs);

  return {
    workerId: doc.workerId,
    status: doc.status,
    availability,
    lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
    lastHeartbeatAgeMs:
      lastHeartbeatAt && Number.isFinite(lastHeartbeatAt.getTime())
        ? Math.max(0, now.getTime() - lastHeartbeatAt.getTime())
        : null,
    startedAt: doc.startedAt ? new Date(doc.startedAt).toISOString() : null,
    activeJobs: doc.activeJobs ?? 0,
    host: doc.host ?? null,
    pid: doc.pid ?? null,
    metadata: doc.metadata ?? null,
  };
}

/**
 * Aggregate availability across registered workers.
 * @param {Array<{ availability: WorkerAvailabilityState }>} workers
 * @returns {WorkerAvailabilityState}
 */
function aggregateWorkerAvailability(workers) {
  if (!workers.length) return 'missing';
  if (workers.some((w) => w.availability === 'healthy')) return 'healthy';
  if (workers.some((w) => w.availability === 'stale')) return 'stale';
  return 'missing';
}

/**
 * Full health snapshot for ops / health endpoints.
 * @param {{ now?: Date, staleMs?: number, includeTerminalCounts?: boolean }} [opts]
 */
async function getCvWorkerHealthSnapshot(opts = {}) {
  const now = opts.now ?? new Date();
  const staleMs = opts.staleMs ?? getCvWorkerHeartbeatStaleMs();
  const heartbeatIntervalMs = getCvWorkerHeartbeatIntervalMs();

  const [heartbeats, queueMetrics] = await Promise.all([
    CvWorkerHeartbeat.find({}).sort({ lastHeartbeatAt: -1 }).lean(),
    getCvExtractionQueueMetrics({
      now,
      includeTerminalCounts: opts.includeTerminalCounts,
    }),
  ]);

  const workers = heartbeats.map((doc) => serializeWorkerHeartbeat(doc, now, staleMs));
  const availability = aggregateWorkerAvailability(workers);
  const queueSignals = deriveQueueSignals(queueMetrics, { workerAvailability: availability });

  const backlogRisk = queueSignals.workerUnavailableWithBacklog || queueSignals.staleQueuedJob;

  return {
    ok: availability === 'healthy' && !queueSignals.staleQueuedJob,
    timestamp: now.toISOString(),
    worker: {
      availability,
      count: workers.length,
      workers,
    },
    queue: {
      ...queueMetrics.counts,
      ages: queueMetrics.ages,
      meta: queueMetrics.meta,
    },
    thresholds: {
      heartbeatIntervalMs,
      staleMs,
      defaults: {
        heartbeatIntervalMs: CV_WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT,
        staleMs: CV_WORKER_HEARTBEAT_STALE_MS_DEFAULT,
      },
    },
    signals: {
      backlogRisk,
      backlogPresent: queueSignals.backlogPresent,
      backlogGrowing: queueSignals.backlogGrowing,
      staleQueuedJob: queueSignals.staleQueuedJob,
      longRunningProcessing: queueSignals.longRunningProcessing,
      retryPressure: queueSignals.retryPressure,
      queuedJobsWaiting: queueMetrics.counts.queued,
      workerMissing: availability === 'missing',
      workerStale: availability === 'stale',
      workerUnavailableWithBacklog: queueSignals.workerUnavailableWithBacklog,
    },
  };
}

module.exports = {
  classifyWorkerAvailability,
  getCvExtractionQueueStats,
  getCvWorkerHealthSnapshot,
  aggregateWorkerAvailability,
  serializeWorkerHeartbeat,
};
