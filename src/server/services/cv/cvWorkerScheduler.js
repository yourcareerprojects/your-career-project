/**
 * Adaptive delay between CV worker poll ticks (idle backoff, immediate pickup under load).
 */

function readIntEnv(name, def, min, max) {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  if (raw == null || raw === '') return def;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

const DEFAULT_IDLE_BACKOFF_INITIAL_MS = 500;
const DEFAULT_IDLE_BACKOFF_MAX_MS = 5000;
/** Small pause when work was found but batch/concurrency not saturated (optional load shedding). */
const DEFAULT_BUSY_POLL_DELAY_MS = 0;

/**
 * @param {object} [config]
 */
function createCvWorkerScheduler(config = {}) {
  const idleBackoffInitialMs =
    config.idleBackoffInitialMs ??
    readIntEnv('CV_WORKER_IDLE_BACKOFF_MS', DEFAULT_IDLE_BACKOFF_INITIAL_MS, 100, 30_000);
  const idleBackoffMaxMs =
    config.idleBackoffMaxMs ??
    readIntEnv('CV_WORKER_IDLE_BACKOFF_MAX_MS', DEFAULT_IDLE_BACKOFF_MAX_MS, 1000, 120_000);
  const busyPollDelayMs =
    config.busyPollDelayMs ??
    readIntEnv('CV_WORKER_BUSY_POLL_MS', DEFAULT_BUSY_POLL_DELAY_MS, 0, 10_000);

  let idleBackoffMs = idleBackoffInitialMs;

  /**
   * @param {object} tick
   * @param {number} tick.claimedCount jobs claimed this tick
   * @param {number} tick.requeuedCount stale jobs requeued this tick
   * @param {number} tick.batchSize max claim batch size
   * @param {number} tick.concurrency worker concurrency
   * @returns {{ delayMs: number, reason: string, idleBackoffMs: number }}
   */
  function nextDelayAfterTick(tick) {
    const claimedCount = Math.max(0, Number(tick.claimedCount) || 0);
    const requeuedCount = Math.max(0, Number(tick.requeuedCount) || 0);
    const batchSize = Math.max(1, Number(tick.batchSize) || 1);
    const concurrency = Math.max(1, Number(tick.concurrency) || 1);

    const jobsFound = claimedCount > 0 || requeuedCount > 0;
    const saturated = claimedCount >= batchSize || claimedCount >= concurrency;

    if (jobsFound) {
      idleBackoffMs = idleBackoffInitialMs;
      if (saturated || busyPollDelayMs <= 0) {
        return { delayMs: 0, reason: 'jobs_found_immediate', idleBackoffMs };
      }
      return {
        delayMs: busyPollDelayMs,
        reason: 'jobs_found_busy',
        idleBackoffMs,
      };
    }

    const delayMs = idleBackoffMs;
    const nextIdle = Math.min(idleBackoffMs * 2, idleBackoffMaxMs);
    idleBackoffMs = nextIdle;
    return { delayMs, reason: 'idle_backoff', idleBackoffMs: nextIdle };
  }

  function reset() {
    idleBackoffMs = idleBackoffInitialMs;
  }

  return {
    nextDelayAfterTick,
    reset,
    getState: () => ({ idleBackoffMs, idleBackoffInitialMs, idleBackoffMaxMs, busyPollDelayMs }),
  };
}

module.exports = {
  createCvWorkerScheduler,
  DEFAULT_IDLE_BACKOFF_INITIAL_MS,
  DEFAULT_IDLE_BACKOFF_MAX_MS,
  DEFAULT_BUSY_POLL_DELAY_MS,
};
