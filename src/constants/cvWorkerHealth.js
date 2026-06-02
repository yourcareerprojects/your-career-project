/**
 * CV extraction worker heartbeat & health thresholds.
 * Override via env on server and worker processes.
 */

/** How often a running worker upserts its heartbeat document. */
const CV_WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT = 15_000;

/**
 * Heartbeat older than this is treated as stale (worker crashed, hung, or network partition).
 * Default: 3× heartbeat interval — tolerates one slow tick + one missed write.
 */
const CV_WORKER_HEARTBEAT_STALE_MS_DEFAULT = 45_000;

const WORKER_HEARTBEAT_STATUSES = ['starting', 'idle', 'processing', 'shutting_down'];
const WORKER_AVAILABILITY_STATES = ['healthy', 'stale', 'missing'];

function readPositiveIntEnv(name, fallback) {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getCvWorkerHeartbeatIntervalMs() {
  return readPositiveIntEnv('CV_WORKER_HEARTBEAT_INTERVAL_MS', CV_WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT);
}

function getCvWorkerHeartbeatStaleMs() {
  return readPositiveIntEnv('CV_WORKER_HEARTBEAT_STALE_MS', CV_WORKER_HEARTBEAT_STALE_MS_DEFAULT);
}

module.exports = {
  CV_WORKER_HEARTBEAT_INTERVAL_MS_DEFAULT,
  CV_WORKER_HEARTBEAT_STALE_MS_DEFAULT,
  WORKER_HEARTBEAT_STATUSES,
  WORKER_AVAILABILITY_STATES,
  getCvWorkerHeartbeatIntervalMs,
  getCvWorkerHeartbeatStaleMs,
};
