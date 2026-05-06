'use strict';

const DEFAULT_JOB_EXECUTION_MS = 10 * 60 * 1000;

/**
 * Single configuration knob for simulation wall-clock budget (worker parent + subprocess kill).
 * DB job lifecycle timeouts should derive from promise rejection caused by subprocess kill —
 * avoid parallel Mongo timers that mutate the job independently.
 */
function getSimulationJobExecutionLimitMs() {
  const raw =
    process.env.SIMULATION_JOB_EXECUTION_LIMIT_MS ?? process.env.SIMULATION_CHILD_TIMEOUT_MS;
  if (raw == null || raw === '') return DEFAULT_JOB_EXECUTION_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_JOB_EXECUTION_MS;
}

module.exports = {
  getSimulationJobExecutionLimitMs,
};
