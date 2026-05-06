'use strict';

/** Default: preserve existing single-job-at-a-time behavior on one worker dyno */
const DEFAULT_MAX = 1;

function parseMaxConcurrent() {
  const raw = process.env.SIMULATION_MAX_CONCURRENT_JOBS;
  if (raw == null || raw === '') return DEFAULT_MAX;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX;
}

function createConcurrencyGate() {
  const maxConcurrent = parseMaxConcurrent();
  let active = 0;
  /** @type {Array<() => void>} */
  const waitQueue = [];

  function releaseSlot() {
    active = Math.max(0, active - 1);
    const next = waitQueue.shift();
    if (next) next();
  }

  /** @template T */
  async function runWithConcurrencyLimit(fn) {
    if (active >= maxConcurrent) {
      await new Promise((resolve) => waitQueue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      releaseSlot();
    }
  }

  return { maxConcurrent, runWithConcurrencyLimit };
}

module.exports = {
  parseMaxConcurrent,
  createConcurrencyGate,
};
