'use strict';

/**
 * Mongo filter helpers: omit career paths marked simulationExcluded.
 * Used by simulation/identity/puzzle pools and catalog occupation APIs.
 * Uses `$ne: true` so legacy documents without the field remain eligible.
 */

const SIMULATION_POOL_ELIGIBLE_FILTER = Object.freeze({
  simulationExcluded: { $ne: true },
});

/**
 * @param {object} [filter={}]
 * @returns {object}
 */
function mergeSimulationPoolFilter(filter = {}) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    return { ...SIMULATION_POOL_ELIGIBLE_FILTER };
  }
  return {
    ...filter,
    ...SIMULATION_POOL_ELIGIBLE_FILTER,
  };
}

module.exports = {
  SIMULATION_POOL_ELIGIBLE_FILTER,
  mergeSimulationPoolFilter,
};
