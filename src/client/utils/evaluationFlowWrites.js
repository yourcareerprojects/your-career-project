/**
 * Shared evaluationFlow mutations for Simulation page handlers.
 * Pages apply these via useEvaluationFlowWrites; keep side effects (persist, dirty) there.
 */

import {
  setFlowRoleEvaluation,
  reorderFlowCategory,
  normalizeEvaluationFlow,
  promoteCategoryToRanked,
  unlockMobileOutsideTheBox,
  skipOutsideTheBoxForNow,
  resumeOutsideTheBoxEvaluation,
  applyAutoRankingRevealWhenBothComplete,
  applyCombinedRankedReorder,
  resumeSimulationWizard,
} from './simulationRoleRanking';

/**
 * @param {object | null | undefined} flow
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @param {string} stepId
 * @param {'keep'|'skip'|'dislike'|null} evaluation
 * @returns {object | null | undefined}
 */
export function commitEvaluationFlowRole(flow, categoryKey, stepId, evaluation) {
  if (!flow) return flow;
  let next = setFlowRoleEvaluation(flow, stepId, evaluation, categoryKey);
  next = {
    ...next,
    hasStarted: { ...next.hasStarted, [categoryKey]: true },
  };
  return applyAutoRankingRevealWhenBothComplete(next);
}

/**
 * @param {object | null | undefined} flow
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @returns {object | null | undefined}
 */
export function promoteEvaluationFlowCategory(flow, categoryKey) {
  if (!flow) return flow;
  return promoteCategoryToRanked(flow, categoryKey);
}

/**
 * @param {object | null | undefined} flow
 * @returns {object | null | undefined}
 */
export function unlockEvaluationFlowOutsideTheBox(flow) {
  if (!flow) return flow;
  return unlockMobileOutsideTheBox(flow);
}

/**
 * @param {object | null | undefined} flow
 * @returns {object | null | undefined}
 */
export function skipEvaluationFlowOutsideTheBox(flow) {
  if (!flow) return flow;
  if (flow.outsideTheBoxDeferred) return flow;
  return skipOutsideTheBoxForNow(flow);
}

/**
 * @param {object | null | undefined} flow
 * @returns {object | null | undefined}
 */
export function resumeEvaluationFlowOutsideTheBox(flow) {
  if (!flow) return flow;
  return resumeOutsideTheBoxEvaluation(flow);
}

/**
 * @param {object | null | undefined} flow
 * @returns {object | null | undefined}
 */
export function resumeEvaluationFlowWizard(flow) {
  if (!flow) return flow;
  return resumeSimulationWizard(flow);
}

/**
 * @param {object | null | undefined} flow
 * @param {object[]} reorderedRows
 * @returns {object | null | undefined}
 */
export function reorderEvaluationFlowCombined(flow, reorderedRows) {
  if (!flow || !Array.isArray(reorderedRows) || !reorderedRows.length) return flow;
  return applyCombinedRankedReorder(flow, reorderedRows);
}

/**
 * Reorder a ranked category and optionally overlay userEvaluation from DnD rows.
 * @param {object | null | undefined} flow
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @param {object[]} reorderedRows
 * @returns {object | null | undefined}
 */
export function reorderEvaluationFlowRanked(flow, categoryKey, reorderedRows) {
  if (!flow || !Array.isArray(reorderedRows) || !reorderedRows.length) return flow;
  const orderedIds = reorderedRows.map((row) => String(row.id));
  let nextFlow = reorderFlowCategory(flow, categoryKey, orderedIds);
  const evalById = new Map(
    reorderedRows.map((row) => [String(row.id), row.userEvaluation])
  );
  return normalizeEvaluationFlow({
    ...nextFlow,
    roles: (nextFlow.roles || []).map((role) => {
      if (role.category !== categoryKey || !evalById.has(String(role.id))) return role;
      return { ...role, userEvaluation: evalById.get(String(role.id)) };
    }),
  });
}
