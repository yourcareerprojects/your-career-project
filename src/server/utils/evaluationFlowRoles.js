/**
 * Shared evaluationFlow role reading for server pipelines.
 * Prefers canonical `roles[]`; falls back to legacy ranked boards then dual lists.
 */

/**
 * @param {object|null|undefined} simulationOrLast
 * @returns {object|null}
 */
function getEvaluationFlow(simulationOrLast) {
  if (!simulationOrLast || typeof simulationOrLast !== 'object') return null;
  const nested = simulationOrLast.results?.evaluationFlow;
  if (nested && typeof nested === 'object') return nested;
  const top = simulationOrLast.evaluationFlow;
  if (top && typeof top === 'object') return top;
  return null;
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareRolesForRead(a, b) {
  const catA = a?.category === 'outsideTheBox' ? 1 : 0;
  const catB = b?.category === 'outsideTheBox' ? 1 : 0;
  if (catA !== catB) return catA - catB;
  const oa = typeof a?.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
  const ob = typeof b?.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
  if (oa !== ob) return oa - ob;
  const fa = typeof a?.finalRank === 'number' ? a.finalRank : Number.MAX_SAFE_INTEGER;
  const fb = typeof b?.finalRank === 'number' ? b.finalRank : Number.MAX_SAFE_INTEGER;
  return fa - fb;
}

/**
 * @param {object|null|undefined} roleOrRow
 * @returns {object|null}
 */
function unwrapEvaluationRole(roleOrRow) {
  if (!roleOrRow || typeof roleOrRow !== 'object') return null;
  if (roleOrRow.step && typeof roleOrRow.step === 'object') {
    return {
      ...roleOrRow.step,
      userEvaluation: roleOrRow.userEvaluation ?? roleOrRow.step.userEvaluation,
      finalRank: roleOrRow.finalRank,
      category: roleOrRow.step.category || roleOrRow.category,
      order: roleOrRow.step.order ?? roleOrRow.order,
    };
  }
  return roleOrRow;
}

/**
 * Flat list of role payloads from an evaluationFlow (roles[] preferred).
 * @param {object|null|undefined} flow
 * @returns {object[]}
 */
function listEvaluationFlowRoles(flow) {
  if (!flow || typeof flow !== 'object') return [];

  if (Array.isArray(flow.roles) && flow.roles.length) {
    return flow.roles
      .filter((role) => role && typeof role === 'object')
      .slice()
      .sort(compareRolesForRead);
  }

  const fromRanked = [];
  for (const category of ['nextSteps', 'outsideTheBox']) {
    const rows = Array.isArray(flow.ranked?.[category]) ? flow.ranked[category] : [];
    for (const row of rows) {
      const role = unwrapEvaluationRole(row);
      if (role) {
        fromRanked.push({
          ...role,
          category: role.category || category,
        });
      }
    }
  }
  if (fromRanked.length) return fromRanked;

  const fromLists = [];
  for (const category of ['nextSteps', 'outsideTheBox']) {
    const list = Array.isArray(flow[category]) ? flow[category] : [];
    for (const role of list) {
      if (role && typeof role === 'object') {
        fromLists.push({
          ...role,
          category: role.category || category,
        });
      }
    }
  }
  return fromLists;
}

/**
 * Roles to persist/localize: existing roles[] or legacy dual-list/ranked flattened.
 * @param {object|null|undefined} flow
 * @returns {object[]}
 */
function resolveEvaluationFlowRoles(flow) {
  if (!flow || typeof flow !== 'object') return [];
  if (Array.isArray(flow.roles) && flow.roles.length) {
    return flow.roles.filter((role) => role && typeof role === 'object');
  }
  return listEvaluationFlowRoles(flow);
}

/**
 * True when both Next Roles and Outside-the-Box rankings are complete.
 * Mirrors client `areBothSimulationRankingsComplete`: phases must be `ranked`
 * and each category must have at least one evaluated role in canonical `roles[]`
 * (or legacy ranked boards / dual lists).
 *
 * @param {object|null|undefined} evaluationFlow
 * @returns {boolean}
 */
function areBothSimulationRankingsComplete(evaluationFlow) {
  if (!evaluationFlow || typeof evaluationFlow !== 'object') return false;
  if (
    evaluationFlow.phases?.nextSteps !== 'ranked'
    || evaluationFlow.phases?.outsideTheBox !== 'ranked'
  ) {
    return false;
  }

  const roles = listEvaluationFlowRoles(evaluationFlow);
  const hasEvaluated = (category) =>
    roles.some(
      (role) =>
        role
        && (role.category || 'nextSteps') === category
        && role.userEvaluation != null
    );

  if (hasEvaluated('nextSteps') && hasEvaluated('outsideTheBox')) {
    return true;
  }

  // Legacy ranked boards (pre-roles[] flows).
  const next = Array.isArray(evaluationFlow.ranked?.nextSteps)
    ? evaluationFlow.ranked.nextSteps
    : [];
  const ootb = Array.isArray(evaluationFlow.ranked?.outsideTheBox)
    ? evaluationFlow.ranked.outsideTheBox
    : [];
  return next.length > 0 && ootb.length > 0;
}

module.exports = {
  getEvaluationFlow,
  listEvaluationFlowRoles,
  resolveEvaluationFlowRoles,
  unwrapEvaluationRole,
  compareRolesForRead,
  areBothSimulationRankingsComplete,
};
