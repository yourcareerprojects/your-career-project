/**
 * Single owner for merging exploration rankings into the last simulation evaluationFlow.
 * Load → merge → session → flush PUT → invalidate (mark-seen stays with the caller).
 */

import {
  loadSimulationFromStorage,
  saveSimulationToStorage,
} from './simulationPersistence';
import {
  normalizeEvaluationFlow,
  withMaterializedEvaluationFlow,
} from './evaluationFlowModel';
import {
  schedulePersistLastSimulationProgress,
  flushPersistLastSimulationProgress,
} from './persistLastSimulationProgress';
import {
  mergeExplorationRolesIntoSimulationResults,
  resolveExplorationRolesForMerge,
} from './explorationRoleEvaluation';
import { ensureEvaluationFlow } from './simulationRoleRanking';
import { getProfileApiLangQuery } from './profileApiLangQuery';
import { invalidateLastSimulationQuery } from '../hooks/useProfileQueries';

/**
 * @param {object} results
 * @returns {object}
 */
function withEnsuredEvaluationFlow(results) {
  if (!results || typeof results !== 'object') return results;
  const withFlow = results.evaluationFlow
    ? results
    : { ...results, evaluationFlow: ensureEvaluationFlow(results) };
  return withMaterializedEvaluationFlow(withFlow);
}

/**
 * Clear wizardPaused so merged rankings are not hidden behind a paused prompt.
 * @param {object} results
 * @returns {object}
 */
export function clearWizardPausedOnResults(results) {
  if (!results?.evaluationFlow?.wizardPaused) return results;
  return {
    ...results,
    evaluationFlow: { ...results.evaluationFlow, wizardPaused: false },
  };
}

/**
 * Load last simulation results for exploration merge (session first, then server).
 * @returns {Promise<{ results: object, metadata: object, fromSession: boolean } | null>}
 */
export async function loadSimulationResultsForExplorationMerge() {
  const stored = loadSimulationFromStorage();
  if (stored?.results) {
    const results = withEnsuredEvaluationFlow(stored.results);
    if (results?.evaluationFlow) {
      return {
        results,
        metadata: stored.metadata || {},
        fromSession: true,
      };
    }
  }

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  if (!token) return null;

  try {
    const res = await fetch(`/api/profile/simulation/last?${getProfileApiLangQuery()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.results) return null;
    const results = withEnsuredEvaluationFlow(data.results);
    if (!results?.evaluationFlow) return null;
    return {
      results,
      metadata: {
        simulationDate: data.date || new Date(),
        profileCompletion: undefined,
      },
      fromSession: false,
    };
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.sessionId]
 * @param {object[]} [opts.roles]
 * @param {object[]} [opts.rankedRows]
 * @param {object} [opts.results] — live in-memory results (preferred over load)
 * @param {object} [opts.storageMetadata] — { simulationDate, profileCompletion }
 * @param {boolean} [opts.persistToServer=true]
 * @param {boolean} [opts.invalidate=true]
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   results?: object,
 *   previousResults?: object,
 *   unchanged?: boolean,
 *   metadata?: object,
 * }>}
 */
export async function applyExplorationRankingToLastSimulation(opts = {}) {
  const {
    sessionId = null,
    roles = null,
    rankedRows = null,
    results: providedResults = null,
    storageMetadata = null,
    persistToServer = true,
    invalidate = true,
  } = opts;

  const rolesForMerge = resolveExplorationRolesForMerge(roles, rankedRows);
  if (!rolesForMerge.length) {
    return { ok: false, reason: 'no-roles' };
  }

  let previousResults = providedResults;
  let metadata = storageMetadata || {};

  if (!previousResults) {
    const loaded = await loadSimulationResultsForExplorationMerge();
    if (!loaded?.results?.evaluationFlow) {
      return { ok: false, reason: 'no-evaluation-flow' };
    }
    previousResults = loaded.results;
    metadata = {
      simulationDate: loaded.metadata?.simulationDate || new Date(),
      profileCompletion: loaded.metadata?.profileCompletion,
      ...metadata,
    };
  } else {
    previousResults = withEnsuredEvaluationFlow(previousResults);
    if (!previousResults?.evaluationFlow) {
      return { ok: false, reason: 'no-evaluation-flow' };
    }
    metadata = {
      simulationDate: metadata.simulationDate || new Date(),
      profileCompletion: metadata.profileCompletion,
    };
  }

  const nextResults = mergeExplorationRolesIntoSimulationResults(
    previousResults,
    rolesForMerge,
    { sessionId }
  );

  if (nextResults === previousResults) {
    return {
      ok: true,
      unchanged: true,
      results: previousResults,
      previousResults,
      metadata,
    };
  }

  let resultsToApply = clearWizardPausedOnResults(nextResults);
  if (resultsToApply?.evaluationFlow) {
    resultsToApply = {
      ...resultsToApply,
      evaluationFlow: normalizeEvaluationFlow(resultsToApply.evaluationFlow),
    };
  }

  try {
    saveSimulationToStorage(
      {
        results: resultsToApply,
        simulationDate: metadata.simulationDate || new Date(),
        profileCompletion: metadata.profileCompletion,
      },
      'modified'
    );
  } catch (err) {
    console.warn('Session persistence failed after exploration merge:', err);
  }

  if (persistToServer) {
    schedulePersistLastSimulationProgress(resultsToApply);
    await flushPersistLastSimulationProgress();
  }

  if (invalidate) {
    invalidateLastSimulationQuery();
  }

  return {
    ok: true,
    unchanged: false,
    results: resultsToApply,
    previousResults,
    metadata,
  };
}
