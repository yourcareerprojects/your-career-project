import { normalizeEvaluationFlow, getFlowRoles, withFlowRoles } from './evaluationFlowModel';

/**
 * Patch Keep/Skip/Dislike on evaluationFlow.roles[] only, then rematerialize derived views.
 * Top-level results.nextSteps / outsideTheBox are not ranking SoT and are left unchanged.
 *
 * @param {object} resultsSnapshot
 * @param {'keep'|'skip'|'dislike'|null} nextEvaluation
 * @param {(role: object) => boolean} isMatchingRole
 * @returns {object}
 */
export function applyUserEvaluationToResultsSnapshot(resultsSnapshot, nextEvaluation, isMatchingRole) {
  if (!resultsSnapshot || typeof resultsSnapshot !== 'object' || typeof isMatchingRole !== 'function') {
    return resultsSnapshot;
  }

  if (!resultsSnapshot.evaluationFlow || typeof resultsSnapshot.evaluationFlow !== 'object') {
    return resultsSnapshot;
  }

  const normalized = normalizeEvaluationFlow(resultsSnapshot.evaluationFlow);
  let changed = false;
  const roles = getFlowRoles(normalized).map((role) => {
    if (!isMatchingRole(role)) return role;
    changed = true;
    return { ...role, userEvaluation: nextEvaluation };
  });

  if (!changed) return resultsSnapshot;

  return {
    ...resultsSnapshot,
    evaluationFlow: withFlowRoles(normalized, roles),
  };
}
