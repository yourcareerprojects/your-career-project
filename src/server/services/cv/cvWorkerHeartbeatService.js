const os = require('os');

const CvWorkerHeartbeat = require('../../models/CvWorkerHeartbeat');
const {
  getCvWorkerHeartbeatIntervalMs,
} = require('../../../constants/cvWorkerHealth');

let cachedWorkerId = null;

/**
 * Stable worker identifier for heartbeat documents.
 * Override with CV_WORKER_ID in multi-instance deployments.
 * @returns {string}
 */
function resolveCvWorkerId() {
  if (cachedWorkerId) return cachedWorkerId;
  const envId = String(process.env.CV_WORKER_ID || '').trim();
  if (envId) {
    cachedWorkerId = envId.slice(0, 128);
    return cachedWorkerId;
  }
  const host = String(os.hostname() || 'unknown').slice(0, 64);
  cachedWorkerId = `${host}-${process.pid}`;
  return cachedWorkerId;
}

/** @param {string} [workerId] */
function resetCachedCvWorkerIdForTests(workerId = null) {
  cachedWorkerId = workerId;
}

/**
 * Upsert heartbeat for this worker process.
 * @param {{
 *   status: 'starting'|'idle'|'processing'|'shutting_down',
 *   activeJobs?: number,
 *   metadata?: { batchSize?: number|null, concurrency?: number|null },
 *   workerId?: string,
 * }} opts
 */
async function recordWorkerHeartbeat(opts) {
  const workerId = opts.workerId || resolveCvWorkerId();
  const now = new Date();
  const activeJobs = Math.max(0, Number(opts.activeJobs) || 0);
  const metadata = opts.metadata || {};

  await CvWorkerHeartbeat.findOneAndUpdate(
    { workerId },
    {
      $set: {
        status: opts.status,
        lastHeartbeatAt: now,
        host: String(os.hostname() || '').slice(0, 256),
        pid: process.pid,
        activeJobs,
        metadata: {
          batchSize: metadata.batchSize ?? null,
          concurrency: metadata.concurrency ?? null,
        },
      },
      $setOnInsert: {
        workerId,
        startedAt: now,
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * Periodic heartbeat loop (independent of poll tick so long OCR jobs stay visible).
 * @param {() => {
 *   status: 'starting'|'idle'|'processing'|'shutting_down',
 *   activeJobs?: number,
 *   metadata?: { batchSize?: number|null, concurrency?: number|null },
 * }} getRuntimeState
 * @param {{ intervalMs?: number, workerId?: string }} [config]
 * @returns {{ stop: () => void, tick: () => Promise<void> }}
 */
function createWorkerHeartbeatLoop(getRuntimeState, config = {}) {
  const intervalMs = config.intervalMs ?? getCvWorkerHeartbeatIntervalMs();
  const workerId = config.workerId || resolveCvWorkerId();
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    const state = getRuntimeState();
    await recordWorkerHeartbeat({
      workerId,
      status: state.status,
      activeJobs: state.activeJobs,
      metadata: state.metadata,
    });
  }

  function start() {
    if (timer) return;
    void tick().catch(() => {});
    timer = setInterval(() => {
      void tick().catch(() => {});
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tick };
}

module.exports = {
  resolveCvWorkerId,
  resetCachedCvWorkerIdForTests,
  recordWorkerHeartbeat,
  createWorkerHeartbeatLoop,
};
