'use strict';

/**
 * Structured heap/RSS snapshots for simulation OOM diagnosis.
 * Diagnostic-only — no business logic.
 */

function logMemory(stage, extra = {}) {
  const m = process.memoryUsage();

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: 'simulation-memory-profiler',
      stage,
      rssMb: Math.round(m.rss / 1024 / 1024),
      heapUsedMb: Math.round(m.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(m.heapTotal / 1024 / 1024),
      externalMb: Math.round(m.external / 1024 / 1024),
      arrayBuffersMb: Math.round((m.arrayBuffers || 0) / 1024 / 1024),
      ...extra,
    })
  );
}

module.exports = {
  logMemory,
};
