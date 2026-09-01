/**
 * Server persistence for ranking progress on the user's latest (unsaved) simulation.
 * Complements sessionStorage so logout/login and new tabs restore evaluation state.
 */

import { toPersistedEvaluationFlow } from './evaluationFlowModel';
import { patchLastSimulationQueryEvaluationFlow } from '../hooks/useProfileQueries';

const DEBOUNCE_MS = 450;

let debounceTimer = null;
let pendingEvaluationFlow = null;
let inFlightPromise = null;

export async function persistLastSimulationEvaluationFlow(evaluationFlow) {
  const token = localStorage.getItem('token');
  const persisted = toPersistedEvaluationFlow(evaluationFlow);
  if (!token || !persisted || typeof persisted !== 'object') {
    return null;
  }

  const res = await fetch('/api/profile/simulation/last', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ evaluationFlow: persisted }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.message || data.error || 'Failed to persist ranking progress');
  }
  patchLastSimulationQueryEvaluationFlow(persisted);
  return data;
}

function flushPendingEvaluationFlow() {
  const flow = pendingEvaluationFlow;
  pendingEvaluationFlow = null;
  if (!flow) return Promise.resolve(null);

  if (inFlightPromise) {
    inFlightPromise = inFlightPromise
      .catch(() => null)
      .then(() => persistLastSimulationEvaluationFlow(flow));
  } else {
    inFlightPromise = persistLastSimulationEvaluationFlow(flow);
  }

  const current = inFlightPromise;
  inFlightPromise = current.finally(() => {
    if (inFlightPromise === current) {
      inFlightPromise = null;
    }
  });
  return inFlightPromise.catch((error) => {
    console.warn('Failed to persist last simulation ranking progress:', error);
    return null;
  });
}

/**
 * Debounced PUT of `results.evaluationFlow` to the user's last simulation.
 * Also patches the React Query cache immediately so discovery / unlock UI updates
 * without waiting for a refetch or full page reload.
 * @param {{ evaluationFlow?: object } | null | undefined} results
 */
export function schedulePersistLastSimulationProgress(results) {
  if (!results?.evaluationFlow || typeof results.evaluationFlow !== 'object') return;
  pendingEvaluationFlow = toPersistedEvaluationFlow(results.evaluationFlow);
  patchLastSimulationQueryEvaluationFlow(pendingEvaluationFlow);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flushPendingEvaluationFlow();
  }, DEBOUNCE_MS);
}

/** Flush any debounced ranking progress (e.g. before tab close). */
export function flushPersistLastSimulationProgress() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
  return flushPendingEvaluationFlow();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (!pendingEvaluationFlow) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const body = JSON.stringify({
        evaluationFlow: toPersistedEvaluationFlow(pendingEvaluationFlow),
      });
      fetch('/api/profile/simulation/last', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        keepalive: true,
      });
      pendingEvaluationFlow = null;
    } catch {
      /* ignore */
    }
  });
}
