'use strict';

const SimulationJob = require('../../models/SimulationJob');

/**
 * Best-effort progress write for in-flight simulation jobs (UI polling / SSE).
 * Never throws; does not block the simulation hot path.
 */
function reportSimulationJobProgress(jobId, progress) {
  if (!jobId) return;
  const p = Math.min(100, Math.max(0, Math.round(Number(progress) || 0)));
  SimulationJob.updateOne({ _id: jobId, status: 'running' }, { $set: { progress: p } }).catch(() => {});
}

module.exports = {
  reportSimulationJobProgress,
};
