const CvWorkerHeartbeat = require('../../models/CvWorkerHeartbeat');
const {
  classifyWorkerAvailability,
  aggregateWorkerAvailability,
} = require('../cv/cvWorkerHealthService');
const { getCvWorkerHeartbeatStaleMs } = require('../../../constants/cvWorkerHealth');
const {
  computeZombieJobSignals,
  computeNoProgressMs,
  mapWorkerAvailabilityToSignal,
} = require('../../../constants/cvExtractionZombie');
const { isStaleRequeuedJob } = require('./cvExtractionErrorClassifier');

/** Cache worker availability briefly to avoid hammering Mongo on every status poll. */
const WORKER_SIGNAL_CACHE_MS = 10_000;
/** @type {{ expiresAt: number, signal: string|null, availability: string } | null} */
let workerSignalCache = null;

/**
 * Lightweight worker health for extraction-status (single indexed query, short TTL cache).
 * @param {Date} [now]
 * @returns {Promise<{ workerHealthSignal: string|null, workerAvailability: string }>}
 */
async function getPublicWorkerHealthForExtractionStatus(now = new Date()) {
  const nowMs = now.getTime();
  if (workerSignalCache && workerSignalCache.expiresAt > nowMs) {
    return {
      workerHealthSignal: workerSignalCache.signal,
      workerAvailability: workerSignalCache.availability,
    };
  }

  const staleMs = getCvWorkerHeartbeatStaleMs();
  const heartbeats = await CvWorkerHeartbeat.find({})
    .sort({ lastHeartbeatAt: -1 })
    .limit(5)
    .select({ lastHeartbeatAt: 1 })
    .lean();

  const workers = heartbeats.map((doc) => ({
    availability: classifyWorkerAvailability(doc.lastHeartbeatAt, now, staleMs),
  }));
  const availability = aggregateWorkerAvailability(workers);
  const signal = mapWorkerAvailabilityToSignal(availability);

  workerSignalCache = {
    expiresAt: nowMs + WORKER_SIGNAL_CACHE_MS,
    signal,
    availability,
  };

  return { workerHealthSignal: signal, workerAvailability: availability };
}

/** Test hook — reset in-memory cache between tests. */
function resetWorkerHealthSignalCache() {
  workerSignalCache = null;
}

/**
 * @param {object} params
 * @param {'queued'|'processing'|'completed'|'failed'} params.status
 * @param {number} params.elapsedMs
 * @param {object|null} [params.job]
 * @param {object|null} [params.doc]
 * @param {Date} [params.now]
 * @param {string|null} [params.workerHealthSignal]
 */
function buildZombieSignalsForJob({
  status,
  elapsedMs,
  job,
  doc,
  now = new Date(),
  workerHealthSignal = null,
}) {
  const updatedAt = job?.updatedAt || job?.createdAt || doc?.uploadDate || null;
  const noProgressMs = computeNoProgressMs(updatedAt, now);
  const isRequeued = isStaleRequeuedJob(job);

  return computeZombieJobSignals({
    status,
    elapsedMs,
    noProgressMs,
    isRequeued,
    workerHealthSignal,
  });
}

module.exports = {
  getPublicWorkerHealthForExtractionStatus,
  buildZombieSignalsForJob,
  resetWorkerHealthSignalCache,
};
