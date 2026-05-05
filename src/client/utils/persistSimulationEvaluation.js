import { applyUserEvaluationToEvaluationFlow } from './simulationRoleRanking';

async function fetchSavedSimulation(simulationId, token) {
  const res = await fetch(`/api/profile/simulation/saved/${simulationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to load simulation');
  }
  return data.simulation;
}

/**
 * Writes a role’s Keep/Skip/Dislike into a saved simulation’s `results.evaluationFlow`.
 *
 * @param {string} simulationId
 * @param {object} stepPayload — same shape as detail `stepDetails` / `resultDetails`
 * @param {'keep'|'skip'|'dislike'|null} nextEval
 * @param {{ existingSimulation?: object }} [options] — skip GET when local copy is authoritative
 * @returns {Promise<object>} updated simulation document from the server
 */
export async function persistUserEvaluationToSavedSimulation(
  simulationId,
  stepPayload,
  nextEval,
  options = {}
) {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Not authenticated');
  }

  const sim =
    options.existingSimulation || (await fetchSavedSimulation(simulationId, token));
  const flow = sim.results?.evaluationFlow;
  if (!flow || typeof flow !== 'object') {
    throw new Error('This simulation has no evaluation data to update');
  }

  const { nextFlow, matched } = applyUserEvaluationToEvaluationFlow(flow, stepPayload, nextEval);
  if (!matched) {
    throw new Error('Could not find this role in the simulation evaluation');
  }

  const updatedSimulation = {
    ...sim,
    results: {
      ...sim.results,
      evaluationFlow: nextFlow,
    },
  };

  const putRes = await fetch(`/api/profile/simulation-results/${simulationId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updatedSimulation),
  });
  const putData = await putRes.json().catch(() => ({}));
  if (!putRes.ok || !putData.success) {
    throw new Error(putData.error || putData.message || 'Failed to save rating');
  }
  return putData.updatedSimulation;
}
