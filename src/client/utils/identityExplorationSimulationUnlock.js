import { loadPreferredSimulationSnapshot } from './simulationPersistence';
import { areBothSimulationRankingsComplete } from './simulationRoleRanking';

/**
 * Identity Discover unlocks only after Next and Outside-the-Box rankings are both complete.
 * Session snapshot covers in-progress PuzzleJOB ranking that has not yet been refetched.
 *
 * @param {object | null | undefined} lastSimData — GET /simulation/last payload
 * @param {{ loadSessionSnapshot?: () => ({ results?: { evaluationFlow?: object } } | null) }} [options]
 * @returns {boolean}
 */
export function isIdentityExplorationUnlockedBySimulation(lastSimData, options = {}) {
  const queryFlow = lastSimData?.results?.evaluationFlow;
  if (areBothSimulationRankingsComplete(queryFlow)) return true;
  const loadSession = options.loadSessionSnapshot || loadPreferredSimulationSnapshot;
  try {
    const sessionFlow = loadSession()?.results?.evaluationFlow;
    return areBothSimulationRankingsComplete(sessionFlow);
  } catch {
    return false;
  }
}
