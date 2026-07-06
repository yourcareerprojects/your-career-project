/**
 * Career simulation role evaluation + deterministic ranking.
 * @typedef {'keep' | 'skip' | 'dislike'} UserEvaluation
 * @typedef {'next' | 'out_of_the_box'} RankCategory
 */

import { generateStepId } from './stepIdUtils';
import { getHybridRawForStep } from './careerStepMatchScore';
import { getRoleTitleEnglishForMatch } from './roleTitleDisplay';

export const EVALUATION_ROLES_TARGET = 10;
export const EVALUATION_VISIBLE_SLOTS_DESKTOP = 3;
export const EVALUATION_VISIBLE_SLOTS_MOBILE = 1;

export function getEvaluationVisibleSlotCount(isMobileViewport) {
  return isMobileViewport ? EVALUATION_VISIBLE_SLOTS_MOBILE : EVALUATION_VISIBLE_SLOTS_DESKTOP;
}

export const evaluationPriority = {
  keep: 0,
  skip: 1,
  dislike: 2,
};

/**
 * @param {object} step
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @returns {number}
 */
export function getNumericMatchScoreForSimulationCategory(step, categoryKey) {
  if (!step || typeof step !== 'object') return 0;
  if (categoryKey === 'nextSteps') {
    const v = step.hybridScoreNextRole;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  } else {
    const v = step.hybridScoreOutOfTheBox;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  const hybrid = getHybridRawForStep(step);
  if (hybrid != null && Number.isFinite(hybrid)) return hybrid;
  if (typeof step.score === 'number' && Number.isFinite(step.score)) return step.score / 10;
  return 0;
}

/**
 * @param {object[]} roles
 * @param {(r: object) => string} [keyFn]
 * @returns {object[]}
 */
function takeUniqueRolesInOrder(roles, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of roles) {
    if (!item || typeof item !== 'object') continue;
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Build up to 10 unique roles for a category without re-fetching.
 *
 * @param {object} results — simulation `results` payload
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @returns {object[]}
 */
export function takeEvaluationSourceRoles(results, categoryKey) {
  if (!results || typeof results !== 'object') return [];
  const listKey = categoryKey === 'nextSteps' ? 'nextCareerRoles' : 'outsideTheBoxRoles';
  const primary =
    categoryKey === 'nextSteps'
      ? Array.isArray(results.nextSteps)
        ? results.nextSteps
        : []
      : Array.isArray(results.outsideTheBox)
        ? results.outsideTheBox
        : Array.isArray(results.outsideComfortZone)
          ? results.outsideComfortZone
          : [];
  const pool = Array.isArray(results.prioritizedLists?.[listKey]) ? results.prioritizedLists[listKey] : [];

  const keyFn = (item) => {
    const byId = item?.stepId || item?.id;
    if (byId) return String(byId).trim() || null;
    const t = getRoleTitleEnglishForMatch(item?.title);
    return t ? t.trim() : null;
  };

  const merged = takeUniqueRolesInOrder(
    [...primary, ...pool],
    keyFn
  );
  return merged.slice(0, EVALUATION_ROLES_TARGET);
}

/**
 * @param {object} results
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @param {object[] | null | undefined} [existingEvaluatedRoles]
 * @returns {object[]}
 */
export function buildEvaluationRolesList(results, categoryKey, existingEvaluatedRoles) {
  const simId = results?.simulationId || 'local';
  const raw = takeEvaluationSourceRoles(results, categoryKey);
  const prevById = new Map();
  (existingEvaluatedRoles || []).forEach((r) => {
    if (r && r.id) prevById.set(r.id, r.userEvaluation);
  });

  return raw.map((step, idx) => {
    const id =
      step.stepId ||
      step.id ||
      generateStepId(step.title, simId, categoryKey, idx);
    return {
      ...step,
      id,
      instanceId: id,
      stepId: step.stepId || id,
      title: step.title,
      matchScore: getNumericMatchScoreForSimulationCategory(step, categoryKey),
      userEvaluation: prevById.has(id) ? prevById.get(id) : null,
      listCategory: categoryKey === 'nextSteps' ? 'nextCareerRoles' : 'outsideTheBoxRoles',
      category: categoryKey === 'nextSteps' ? 'nextSteps' : 'outsideTheBox',
    };
  });
}

/**
 * @param {object[]} roles
 */
export function isEvaluationComplete(roles) {
  return Array.isArray(roles) && roles.length > 0 && roles.every((r) => r && r.userEvaluation != null);
}

/**
 * @param {object[]} roles
 */
export function countEvaluatedRoles(roles) {
  if (!Array.isArray(roles)) return 0;
  return roles.filter((r) => r && r.userEvaluation != null).length;
}

/**
 * Deterministic ranking: preference first, then match score (desc).
 * Does not mutate the input array.
 *
 * @param {Array<{ userEvaluation: UserEvaluation, matchScore: number }>} roles
 * @returns {typeof roles}
 */
export function rankRoles(roles) {
  return [...roles].sort((a, b) => {
    const evalDiff =
      evaluationPriority[a.userEvaluation] - evaluationPriority[b.userEvaluation];
    if (evalDiff !== 0) return evalDiff;
    return b.matchScore - a.matchScore;
  });
}

/**
 * @param {object[]} roles — evaluated flow roles for one category
 * @param {RankCategory} rankCategory
 * @returns {Array<{ id: string, title: string, matchScore: number, category: RankCategory, userEvaluation: UserEvaluation, finalRank: number, step: object }>}
 */
export function buildRankedRows(roles, rankCategory) {
  const sorted = rankRoles(roles);
  return sorted.map((row, i) => ({
    id: row.id,
    title: row.title,
    matchScore: row.matchScore,
    category: rankCategory,
    userEvaluation: row.userEvaluation,
    finalRank: i + 1,
    step: row,
  }));
}

/**
 * Build ranked rows using the provided role order as-is.
 *
 * @param {object[]} orderedRoles
 * @param {RankCategory} rankCategory
 * @returns {Array<{ id: string, title: string, matchScore: number, category: RankCategory, userEvaluation: UserEvaluation, finalRank: number, step: object }>}
 */
export function buildRankedRowsFromOrderedRoles(orderedRoles, rankCategory) {
  const rows = Array.isArray(orderedRoles) ? orderedRoles : [];
  return rows.map((row, i) => ({
    id: row.id,
    title: row.title,
    matchScore: row.matchScore,
    category: rankCategory,
    userEvaluation: row.userEvaluation,
    finalRank: i + 1,
    step: row,
  }));
}

/**
 * @param {object} results — full simulation results
 * @returns {object}
 */
export function createInitialEvaluationFlow(results) {
  const simulationId = results.simulationId || 'local';
  return {
    simulationId,
    nextSteps: buildEvaluationRolesList(results, 'nextSteps'),
    outsideTheBox: buildEvaluationRolesList(results, 'outsideTheBox'),
    hasStarted: { nextSteps: false, outsideTheBox: false },
    phases: { nextSteps: 'eval', outsideTheBox: 'eval' },
    ranked: { nextSteps: null, outsideTheBox: null },
  };
}

/**
 * Merge / refresh lists from `results` while preserving completed evaluations when step ids match.
 *
 * @param {object} results
 * @param {object | null | undefined} currentFlow
 */
export function mergeEvaluationFlowFromResults(results, currentFlow) {
  if (!results || typeof results !== 'object') return null;
  const resultsKey = results.simulationId ?? 'local';
  const flowKey = currentFlow?.simulationId ?? 'local';
  // Flow may have been created with simulationId "local" before results.simulationId existed; treat as same run.
  const sameSimulationRun =
    currentFlow &&
    (flowKey === resultsKey ||
      (flowKey === 'local' && resultsKey && resultsKey !== 'local'));
  if (sameSimulationRun) {
    return {
      ...currentFlow,
      simulationId: resultsKey,
      nextSteps: buildEvaluationRolesList(results, 'nextSteps', currentFlow.nextSteps),
      outsideTheBox: buildEvaluationRolesList(results, 'outsideTheBox', currentFlow.outsideTheBox),
    };
  }
  return createInitialEvaluationFlow({ ...results, simulationId: resultsKey });
}

/**
 * Attach or refresh `evaluationFlow` from the latest `results` payload.
 *
 * @param {object} results
 */
export function ensureEvaluationFlow(results) {
  return mergeEvaluationFlowFromResults(results, results?.evaluationFlow);
}

export function flowItemMatchesStep(step, flowItem) {
  if (!step || !flowItem || typeof flowItem !== 'object') return false;
  const sid = step.stepId || step.id || step.instanceId;
  const fid = flowItem.stepId || flowItem.id || flowItem.instanceId;
  if (sid && fid && sid === fid) return true;
  if (step.stepId && (flowItem.id === step.stepId || flowItem.stepId === step.stepId)) return true;
  if (step.id && (flowItem.id === step.id || flowItem.stepId === step.id)) return true;
  const nt = (t) => String(t || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const t1 = step.title;
  const t2 = flowItem.title;
  if (t1 && t2 && nt(t1) === nt(t2)) return true;
  return false;
}

/**
 * Ratings (Keep / Skip / Dislike) live on `results.evaluationFlow`, not on raw `nextSteps` rows.
 * Resolve the evaluation for a result step when opening a detail view from a saved simulation.
 *
 * @param {object} results — simulation `results` payload
 * @param {object} step — raw step from findCareerStepInSimulation
 * @returns {[boolean, import('.').UserEvaluation | null]} `[matched, userEvaluation]` — matched false if not in flow
 */
export function resolveUserEvaluationFromEvaluationFlow(results, step) {
  if (!results || !step || typeof results !== 'object') return [false, undefined];
  const flow = results.evaluationFlow;
  if (!flow || typeof flow !== 'object') return [false, undefined];

  const tryList = (list) => {
    if (!Array.isArray(list)) return undefined;
    for (const item of list) {
      if (flowItemMatchesStep(step, item)) {
        return [true, item.userEvaluation ?? null];
      }
    }
    return undefined;
  };

  for (const key of ['nextSteps', 'outsideTheBox']) {
    const hit = tryList(flow[key]);
    if (hit) return hit;
  }

  const ranked = flow.ranked;
  if (ranked && typeof ranked === 'object') {
    for (const key of ['nextSteps', 'outsideTheBox']) {
      const rows = ranked[key];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (flowItemMatchesStep(step, row)) {
          return [true, row.userEvaluation ?? null];
        }
        const inner = row.step;
        if (inner && flowItemMatchesStep(step, inner)) {
          return [true, row.userEvaluation ?? inner.userEvaluation ?? null];
        }
      }
    }
  }

  return [false, undefined];
}

/**
 * Update Keep/Skip/Dislike on matching roles in a persisted evaluationFlow clone.
 * Rebuilds ranked tables when that phase is active so order stays consistent.
 *
 * @param {object} flow — results.evaluationFlow
 * @param {object} step — detail payload (stepId, id, title, …)
 * @param {'keep'|'skip'|'dislike'|null} nextEval
 * @returns {{ nextFlow: object, matched: boolean }}
 */
export function applyUserEvaluationToEvaluationFlow(flow, step, nextEval) {
  if (!flow || typeof flow !== 'object' || !step) {
    return { nextFlow: flow, matched: false };
  }
  const next = JSON.parse(JSON.stringify(flow));
  let matched = false;

  const patchList = (list) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      if (flowItemMatchesStep(step, list[i])) {
        list[i] = { ...list[i], userEvaluation: nextEval };
        matched = true;
      }
    }
  };

  patchList(next.nextSteps);
  patchList(next.outsideTheBox);

  if (next.phases?.nextSteps === 'ranked' && Array.isArray(next.nextSteps)) {
    next.ranked = { ...next.ranked, nextSteps: buildRankedRows(next.nextSteps, 'next') };
  }
  if (next.phases?.outsideTheBox === 'ranked' && Array.isArray(next.outsideTheBox)) {
    next.ranked = {
      ...next.ranked,
      outsideTheBox: buildRankedRows(next.outsideTheBox, 'out_of_the_box'),
    };
  }

  return { nextFlow: next, matched };
}

/**
 * True when the user has opened ranked views for both Next Roles and Outside-the-Box.
 * @param {object | null | undefined} evaluationFlow
 */
export function areBothSimulationRankingsComplete(evaluationFlow) {
  if (!evaluationFlow) return false;
  return (
    evaluationFlow.phases?.nextSteps === 'ranked'
    && evaluationFlow.phases?.outsideTheBox === 'ranked'
    && Array.isArray(evaluationFlow.ranked?.nextSteps)
    && evaluationFlow.ranked.nextSteps.length > 0
    && Array.isArray(evaluationFlow.ranked?.outsideTheBox)
    && evaluationFlow.ranked.outsideTheBox.length > 0
  );
}
