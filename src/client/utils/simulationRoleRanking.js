/**
 * Career simulation role evaluation + deterministic ranking.
 * @typedef {'keep' | 'skip' | 'dislike'} UserEvaluation
 * @typedef {'next' | 'out_of_the_box'} RankCategory
 */

import { generateStepId } from './stepIdUtils';
import { getHybridRawForStep } from './careerStepMatchScore';
import { getSimulationRoleKey } from './simulationRoleKey';
import {
  normalizeEvaluationFlow,
  withFlowRoles,
  getFlowRoles,
  getEvalQueue,
  getRankedBoard,
  getRankedColumns,
  groupRolesByEvaluation,
  flattenEvaluationColumns,
  assignRankedOrderByPreference,
  setFlowRoleEvaluation,
  reorderFlowCategory,
  toCanonicalRole,
  toPersistedEvaluationFlow,
  toPersistedSimulationResults,
  withMaterializedEvaluationFlow,
  stripDerivedEvaluationViews,
} from './evaluationFlowModel';

export {
  normalizeEvaluationFlow,
  getEvalQueue,
  getRankedBoard,
  getRankedColumns,
  groupRolesByEvaluation,
  flattenEvaluationColumns,
  getFlowRoles,
  setFlowRoleEvaluation,
  reorderFlowCategory,
  toPersistedEvaluationFlow,
  toPersistedSimulationResults,
  withMaterializedEvaluationFlow,
  stripDerivedEvaluationViews,
};

const FLOW_ROLE_PROTECTED_KEYS = new Set([
  'userEvaluation',
  'id',
  'instanceId',
  'stepId',
  'explorationSessionId',
  'category',
  'listCategory',
  'preferredCategory',
]);

/**
 * Index source roles for patching localized/display fields onto an existing flow list.
 * @param {object} results
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @returns {Map<string, object>}
 */
export function buildEvaluationSourceRoleIndex(results, categoryKey) {
  const map = new Map();
  const add = (role) => {
    if (!role || typeof role !== 'object') return;
    const key = getSimulationRoleKey(role);
    if (!key) return;
    map.set(key, role);
  };

  takeEvaluationSourceRoles(results, categoryKey).forEach(add);

  const efList = results?.evaluationFlow?.[categoryKey];
  if (Array.isArray(efList)) efList.forEach(add);

  const ranked = results?.evaluationFlow?.ranked?.[categoryKey];
  if (Array.isArray(ranked)) {
    ranked.forEach((row) => add(row?.step || row));
  }

  return map;
}

/**
 * Patch display/score fields from a localized source onto a flow role.
 * Membership, ratings, and exploration metadata stay on the flow role.
 * @param {object} flowRole
 * @param {object} source
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @returns {object}
 */
export function patchFlowRoleFromSource(flowRole, source, categoryKey) {
  if (!flowRole || typeof flowRole !== 'object') return flowRole;
  if (!source || typeof source !== 'object') return flowRole;

  const next = { ...flowRole };
  for (const [key, value] of Object.entries(source)) {
    if (FLOW_ROLE_PROTECTED_KEYS.has(key)) continue;
    if (value !== undefined) next[key] = value;
  }

  next.userEvaluation = flowRole.userEvaluation;
  next.id = flowRole.id;
  next.instanceId = flowRole.instanceId || flowRole.id;
  next.stepId = flowRole.stepId || flowRole.id;
  if (flowRole.explorationSessionId != null) {
    next.explorationSessionId = flowRole.explorationSessionId;
  }
  if (flowRole.category != null) next.category = flowRole.category;
  if (flowRole.listCategory != null) next.listCategory = flowRole.listCategory;
  if (flowRole.preferredCategory != null) next.preferredCategory = flowRole.preferredCategory;

  next.matchScore = getNumericMatchScoreForSimulationCategory(next, categoryKey);

  return next;
}

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

  const keyFn = (item) => getSimulationRoleKey(item);

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
  const prevByKey = new Map();
  (existingEvaluatedRoles || []).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    if (r.id) prevById.set(String(r.id), r);
    const key = getSimulationRoleKey(r);
    if (key) prevByKey.set(key, r);
  });

  return raw.map((step, idx) => {
    const id =
      step.stepId ||
      step.id ||
      generateStepId(step.title, simId, categoryKey, idx);
    const key = getSimulationRoleKey({ ...step, id, stepId: step.stepId || id });
    const prev = prevById.get(String(id)) || (key ? prevByKey.get(key) : null);
    return {
      ...step,
      id,
      instanceId: id,
      stepId: step.stepId || id,
      title: step.title,
      matchScore: getNumericMatchScoreForSimulationCategory(step, categoryKey),
      userEvaluation: prev?.userEvaluation ?? null,
      listCategory: categoryKey === 'nextSteps' ? 'nextCareerRoles' : 'outsideTheBoxRoles',
      category: categoryKey === 'nextSteps' ? 'nextSteps' : 'outsideTheBox',
      ...(prev?.explorationSessionId != null
        ? { explorationSessionId: prev.explorationSessionId }
        : {}),
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
export const MOBILE_EVAL_VIEWS = {
  NEXT_ONLY: 'nextOnly',
  TRANSITION: 'transition',
  OOTB_ONLY: 'ootbOnly',
  BOTH: 'both',
};

export function isMobileOutsideTheBoxUnlocked(evaluationFlow) {
  if (!evaluationFlow) return false;
  if (evaluationFlow.hasStarted?.outsideTheBox) return true;
  return evaluationFlow.mobilePhaseGate?.outsideTheBox === 'unlocked';
}

export function isOutsideTheBoxDeferred(evaluationFlow) {
  return Boolean(evaluationFlow?.outsideTheBoxDeferred);
}

/**
 * Which evaluation sections to show in the sequential two-phase flow.
 * @param {object | null | undefined} evaluationFlow
 * @returns {typeof MOBILE_EVAL_VIEWS[keyof typeof MOBILE_EVAL_VIEWS]}
 */
export function hasSeenCategoryRanking(evaluationFlow, categoryKey) {
  if (!evaluationFlow) return false;
  if (evaluationFlow.hasSeenRanking?.[categoryKey]) return true;
  return evaluationFlow.phases?.[categoryKey] === 'ranked';
}

export function markCategoryRankingSeen(flow, categoryKey) {
  if (!flow || typeof flow !== 'object') return flow;
  return {
    ...flow,
    hasSeenRanking: { ...flow.hasSeenRanking, [categoryKey]: true },
  };
}

export function getMobileEvaluationView(evaluationFlow) {
  if (!evaluationFlow) return MOBILE_EVAL_VIEWS.NEXT_ONLY;

  const nextComplete = isEvaluationComplete(getEvalQueue(evaluationFlow, 'nextSteps'));
  const ootbComplete = isEvaluationComplete(getEvalQueue(evaluationFlow, 'outsideTheBox'));
  const nextRanked = evaluationFlow.phases?.nextSteps === 'ranked';
  const ootbRanked = evaluationFlow.phases?.outsideTheBox === 'ranked';
  const ootbUnlocked = isMobileOutsideTheBoxUnlocked(evaluationFlow);
  const ootbDeferred = isOutsideTheBoxDeferred(evaluationFlow);
  const seenNextRanking = hasSeenCategoryRanking(evaluationFlow, 'nextSteps');

  if (nextRanked && ootbRanked) return MOBILE_EVAL_VIEWS.BOTH;
  if (nextRanked && ootbDeferred) return MOBILE_EVAL_VIEWS.NEXT_ONLY;
  if (ootbUnlocked && (!ootbComplete || !ootbRanked)) return MOBILE_EVAL_VIEWS.OOTB_ONLY;
  if (!nextComplete) return MOBILE_EVAL_VIEWS.NEXT_ONLY;
  if (!ootbUnlocked && !seenNextRanking) return MOBILE_EVAL_VIEWS.TRANSITION;
  if (!ootbUnlocked) return MOBILE_EVAL_VIEWS.NEXT_ONLY;
  return MOBILE_EVAL_VIEWS.BOTH;
}

export function promoteCategoryToRanked(flow, categoryKey) {
  if (!flow) return flow;
  if (flow.phases?.[categoryKey] === 'ranked') {
    const existingBoard = getRankedBoard(flow, categoryKey);
    if (Array.isArray(existingBoard) && existingBoard.length) {
      // Already ranked — keep the same reference so callers can skip no-op state updates.
      return flow;
    }
  }

  const normalized = normalizeEvaluationFlow(flow);
  const roles = getEvalQueue(normalized, categoryKey);
  if (!isEvaluationComplete(roles)) return flow;
  if (normalized.phases?.[categoryKey] === 'ranked') {
    const board = getRankedBoard(normalized, categoryKey);
    if (Array.isArray(board) && board.length) return normalized;
  }

  const catRoles = assignRankedOrderByPreference(
    getFlowRoles(normalized).filter((role) => role.category === categoryKey)
  );
  const others = getFlowRoles(normalized).filter((role) => role.category !== categoryKey);
  let nextFlow = withFlowRoles(
    {
      ...normalized,
      phases: { ...normalized.phases, [categoryKey]: 'ranked' },
    },
    [...others, ...catRoles]
  );
  nextFlow = markCategoryRankingSeen(nextFlow, categoryKey);
  if (categoryKey === 'outsideTheBox' && nextFlow.outsideTheBoxDeferred) {
    nextFlow = { ...nextFlow, outsideTheBoxDeferred: false };
  }
  return nextFlow;
}

/**
 * When both categories are fully rated, open ranked views for each without a manual reveal step.
 * @param {object | null | undefined} flow
 */
export function applyAutoRankingRevealWhenBothComplete(flow) {
  if (!flow) return flow;
  if (!isEvaluationComplete(flow.nextSteps) || !isEvaluationComplete(flow.outsideTheBox)) {
    return flow;
  }
  if (flow.phases?.nextSteps === 'ranked' && flow.phases?.outsideTheBox === 'ranked') {
    return flow;
  }
  let next = flow;
  next = promoteCategoryToRanked(next, 'nextSteps');
  next = promoteCategoryToRanked(next, 'outsideTheBox');
  return next;
}

export function unlockMobileOutsideTheBox(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  return {
    ...flow,
    outsideTheBoxDeferred: false,
    mobilePhaseGate: { ...flow.mobilePhaseGate, outsideTheBox: 'unlocked' },
  };
}

/**
 * Skip outside-the-box evaluation for now and reveal the next-role ranking immediately.
 * @param {object} flow
 */
export function skipOutsideTheBoxForNow(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  let next = { ...flow, outsideTheBoxDeferred: true };
  if (isEvaluationComplete(next.nextSteps)) {
    next = promoteCategoryToRanked(next, 'nextSteps');
  }
  return next;
}

/**
 * Resume deferred outside-the-box evaluation.
 * @param {object} flow
 */
export function resumeOutsideTheBoxEvaluation(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  return unlockMobileOutsideTheBox({ ...flow, outsideTheBoxDeferred: false });
}

export function createInitialEvaluationFlow(results) {
  const simulationId = results.simulationId || 'local';
  const nextSteps = buildEvaluationRolesList(results, 'nextSteps');
  const outsideTheBox = buildEvaluationRolesList(results, 'outsideTheBox');
  return normalizeEvaluationFlow({
    simulationId,
    nextSteps,
    outsideTheBox,
    hasStarted: { nextSteps: false, outsideTheBox: false },
    phases: { nextSteps: 'eval', outsideTheBox: 'eval' },
    ranked: { nextSteps: null, outsideTheBox: null },
    mobilePhaseGate: { outsideTheBox: 'locked' },
    hasSeenRanking: { nextSteps: false, outsideTheBox: false },
    outsideTheBoxDeferred: false,
    wizardPaused: false,
  });
}

/** Mark the step wizard as paused so the user can return later (session-persisted). */
export function pauseSimulationWizard(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  return { ...flow, wizardPaused: true };
}

/** Re-open the step wizard after a paused exit. */
export function resumeSimulationWizard(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  return { ...flow, wizardPaused: false };
}

/**
 * Merge / refresh flow display fields from `results` while preserving membership,
 * ratings, ranked order, and exploration inserts. Does not rebuild role lists from pools
 * after the flow has been materialized.
 *
 * @param {object} results
 * @param {object | null | undefined} currentFlow
 */
export function mergeEvaluationFlowFromResults(results, currentFlow) {
  if (!results || typeof results !== 'object') return null;
  const resultsKey = results.simulationId ?? 'local';
  const flowKey = currentFlow?.simulationId ?? 'local';
  // Keep an existing membership when ids disagree only because the envelope
  // omitted simulationId (or still says "local") — never rebuild from pools and
  // drop exploration / later inserts. A real id change (sim-1 → sim-2) still rebuilds.
  const sameSimulationRun =
    Boolean(currentFlow)
    && (
      flowKey === resultsKey
      || (flowKey === 'local' && resultsKey && resultsKey !== 'local')
      || (resultsKey === 'local' && flowKey && flowKey !== 'local')
    );
  if (sameSimulationRun) {
    const resolvedSimId =
      (resultsKey && resultsKey !== 'local' ? resultsKey : null)
      || (flowKey && flowKey !== 'local' ? flowKey : null)
      || resultsKey
      || 'local';
    const ootbAlreadyStarted = Boolean(currentFlow.hasStarted?.outsideTheBox);
    const normalized = normalizeEvaluationFlow({
      ...currentFlow,
      simulationId: resolvedSimId,
      mobilePhaseGate: currentFlow.mobilePhaseGate ?? {
        outsideTheBox: ootbAlreadyStarted ? 'unlocked' : 'locked',
      },
      hasSeenRanking: currentFlow.hasSeenRanking ?? {
        nextSteps: currentFlow.phases?.nextSteps === 'ranked',
        outsideTheBox: currentFlow.phases?.outsideTheBox === 'ranked',
      },
      outsideTheBoxDeferred: currentFlow.outsideTheBoxDeferred ?? false,
      wizardPaused: currentFlow.wizardPaused ?? false,
    });

    let roles = getFlowRoles(normalized);
    if (!roles.length) {
      const nextSteps = buildEvaluationRolesList(results, 'nextSteps');
      const outsideTheBox = buildEvaluationRolesList(results, 'outsideTheBox');
      let merged = normalizeEvaluationFlow({
        ...normalized,
        nextSteps,
        outsideTheBox,
        roles: undefined,
      });
      if (merged.suppressAutoRankingReveal || merged.reEditPhase) {
        const { suppressAutoRankingReveal, reEditPhase, ...rest } = merged;
        merged = applyAutoRankingRevealWhenBothComplete(rest);
      }
      return merged;
    }

    const sourceNext = buildEvaluationSourceRoleIndex(results, 'nextSteps');
    const sourceOotb = buildEvaluationSourceRoleIndex(results, 'outsideTheBox');
    roles = roles.map((role) => {
      const source =
        role.category === 'outsideTheBox'
          ? sourceOotb.get(role.key)
          : sourceNext.get(role.key);
      if (!source) return role;
      return toCanonicalRole(
        patchFlowRoleFromSource(role, source, role.category),
        role.category,
        role.order
      );
    });

    let merged = withFlowRoles(normalized, roles);
    if (Array.isArray(currentFlow.mergedExplorationSessionIds)) {
      merged = {
        ...merged,
        mergedExplorationSessionIds: currentFlow.mergedExplorationSessionIds,
      };
    }

    if (merged.suppressAutoRankingReveal || merged.reEditPhase) {
      const { suppressAutoRankingReveal, reEditPhase, ...rest } = merged;
      merged = applyAutoRankingRevealWhenBothComplete(rest);
    }
    return merged;
  }
  return createInitialEvaluationFlow({ ...results, simulationId: resultsKey });
}

/**
 * Attach or refresh `evaluationFlow` from the latest `results` payload.
 *
 * @param {object} results
 */
export function ensureEvaluationFlow(results) {
  const merged = mergeEvaluationFlowFromResults(results, results?.evaluationFlow);
  return applyAutoRankingRevealWhenBothComplete(normalizeEvaluationFlow(merged));
}

export function flowItemMatchesStep(step, flowItem) {
  if (!step || !flowItem || typeof flowItem !== 'object') return false;
  const stepKey = getSimulationRoleKey(step);
  const flowKey = getSimulationRoleKey(flowItem);
  if (stepKey && flowKey && stepKey === flowKey) return true;
  const sid = step.stepId || step.id || step.instanceId;
  const fid = flowItem.stepId || flowItem.id || flowItem.instanceId;
  if (sid && fid && sid === fid) return true;
  if (step.stepId && (flowItem.id === step.stepId || flowItem.stepId === step.stepId)) return true;
  if (step.id && (flowItem.id === step.id || flowItem.stepId === step.id)) return true;
  // Title fallback only for legacy rows that lack a strong identity key.
  const isWeakKey = (key) => !key || key.startsWith('title:');
  if (!isWeakKey(stepKey) || !isWeakKey(flowKey)) return false;
  const nt = (t) => String(t || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const t1 = step.title;
  const t2 = flowItem.title;
  if (t1 && t2 && nt(t1) === nt(t2)) return true;
  return false;
}

/**
 * Ratings (Keep / Skip / Dislike) live on `results.evaluationFlow.roles[]`.
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

  const roles = getFlowRoles(normalizeEvaluationFlow(flow));
  for (const role of roles) {
    if (flowItemMatchesStep(step, role)) {
      return [true, role.userEvaluation ?? null];
    }
  }

  // Legacy dual-list / ranked fallback when roles[] could not be built.
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
  const normalized = normalizeEvaluationFlow(flow);
  const stepId = step.stepId || step.id || step.instanceId;
  if (!stepId) return { nextFlow: normalized, matched: false };

  let matched = false;
  let matchedCategory = null;
  const roles = getFlowRoles(normalized).map((role) => {
    if (!flowItemMatchesStep(step, role)) return role;
    matched = true;
    matchedCategory = role.category;
    return { ...role, userEvaluation: nextEval };
  });
  if (!matched) return { nextFlow: normalized, matched: false };

  let nextFlow = withFlowRoles(normalized, roles);
  if (matchedCategory && nextFlow.phases?.[matchedCategory] === 'ranked') {
    const catRoles = assignRankedOrderByPreference(
      getFlowRoles(nextFlow).filter((role) => role.category === matchedCategory)
    );
    const others = getFlowRoles(nextFlow).filter((role) => role.category !== matchedCategory);
    nextFlow = withFlowRoles(nextFlow, [...others, ...catRoles]);
  }
  return { nextFlow, matched: true };
}

/**
 * True when the user has opened ranked views for both Next Roles and Outside-the-Box.
 * @param {object | null | undefined} evaluationFlow
 */
export function areBothSimulationRankingsComplete(evaluationFlow) {
  if (!evaluationFlow) return false;
  if (
    evaluationFlow.phases?.nextSteps !== 'ranked'
    || evaluationFlow.phases?.outsideTheBox !== 'ranked'
  ) {
    return false;
  }
  const next = getRankedBoard(evaluationFlow, 'nextSteps');
  const ootb = getRankedBoard(evaluationFlow, 'outsideTheBox');
  return Array.isArray(next) && next.length > 0 && Array.isArray(ootb) && ootb.length > 0;
}

/**
 * True when the user has started, paused, or completed role ranking on the latest run.
 * Used to restore session state after logout/login or server reload.
 */
export function hasSimulationEvaluationProgress(evaluationFlow) {
  if (!evaluationFlow) return false;
  if (evaluationFlow.wizardPaused) return true;
  if (evaluationFlow.hasStarted?.nextSteps || evaluationFlow.hasStarted?.outsideTheBox) return true;
  if (evaluationFlow.phases?.nextSteps === 'ranked' || evaluationFlow.phases?.outsideTheBox === 'ranked') {
    return true;
  }
  if (evaluationFlow.outsideTheBoxDeferred) return true;
  if (isMobileOutsideTheBoxUnlocked(evaluationFlow)) return true;
  return areBothSimulationRankingsComplete(evaluationFlow);
}

function hasNextStepsRankedOverview(evaluationFlow) {
  if (evaluationFlow.phases?.nextSteps !== 'ranked') return false;
  const board = getRankedBoard(evaluationFlow, 'nextSteps');
  return Array.isArray(board) && board.length > 0;
}

/**
 * True when the next-role ranking overview is shown after skipping outside-the-box for now.
 * @param {object | null | undefined} evaluationFlow
 */
export function isNextStepsRankingOverviewWithDeferredOotb(evaluationFlow) {
  if (!evaluationFlow || !isOutsideTheBoxDeferred(evaluationFlow)) return false;
  return hasNextStepsRankedOverview(evaluationFlow);
}

/**
 * True when the user has reached a ranking overview worth celebrating (full or deferred OOTB skip).
 * @param {object | null | undefined} evaluationFlow
 */
export function isSimulationRankingOverviewCelebrationEligible(evaluationFlow) {
  if (!evaluationFlow) return false;
  if (areBothSimulationRankingsComplete(evaluationFlow)) return true;
  return isNextStepsRankingOverviewWithDeferredOotb(evaluationFlow);
}

/**
 * @param {object} row
 * @returns {'nextSteps' | 'outsideTheBox'}
 */
export function resolveRankedRowSourceCategoryKey(row) {
  if (row?.sourceCategoryKey === 'nextSteps' || row?.sourceCategoryKey === 'outsideTheBox') {
    return row.sourceCategoryKey;
  }
  const step = row?.step || row;
  if (step?.category === 'outsideTheBox' || step?.listCategory === 'outsideTheBoxRoles') {
    return 'outsideTheBox';
  }
  if (row?.category === 'out_of_the_box') return 'outsideTheBox';
  return 'nextSteps';
}

/**
 * @param {object | null | undefined} flow
 * @returns {object[]}
 */
export function buildCombinedRankedRows(flow) {
  if (!flow) return [];
  const next = getRankedBoard(flow, 'nextSteps') || [];
  const ootb = getRankedBoard(flow, 'outsideTheBox') || [];
  const tag = (row, sourceCategoryKey) => ({
    ...row,
    sourceCategoryKey,
    step: {
      ...row.step,
      category: sourceCategoryKey === 'outsideTheBox' ? 'outsideTheBox' : 'nextSteps',
    },
  });
  return [
    ...next.map((row) => tag(row, 'nextSteps')),
    ...ootb.map((row) => tag(row, 'outsideTheBox')),
  ];
}

/**
 * @param {object} flow
 * @param {object[]} flattenedRows
 * @returns {object}
 */
export function applyCombinedRankedReorder(flow, flattenedRows) {
  if (!flow || !Array.isArray(flattenedRows) || !flattenedRows.length) return flow;
  const normalized = normalizeEvaluationFlow(flow);

  const applyForCategory = (categoryKey) => {
    const categoryIds = new Set(
      getFlowRoles(normalized)
        .filter((role) => role.category === categoryKey)
        .map((role) => String(role.id))
    );
    const relevant = flattenedRows.filter((row) => categoryIds.has(String(row.id)));
    if (!relevant.length) return null;
    return relevant.map((row) => String(row.id));
  };

  let nextFlow = normalized;
  let changed = false;
  const nextIds = applyForCategory('nextSteps');
  const ootbIds = applyForCategory('outsideTheBox');
  if (nextIds) {
    nextFlow = reorderFlowCategory(nextFlow, 'nextSteps', nextIds);
    // Preserve evaluations from the combined board rows.
    const evalById = new Map(
      flattenedRows.map((row) => [String(row.id), row.userEvaluation])
    );
    nextFlow = withFlowRoles(
      nextFlow,
      getFlowRoles(nextFlow).map((role) => {
        if (role.category !== 'nextSteps' || !evalById.has(String(role.id))) return role;
        return { ...role, userEvaluation: evalById.get(String(role.id)) };
      })
    );
    changed = true;
  }
  if (ootbIds) {
    nextFlow = reorderFlowCategory(nextFlow, 'outsideTheBox', ootbIds);
    const evalById = new Map(
      flattenedRows.map((row) => [String(row.id), row.userEvaluation])
    );
    nextFlow = withFlowRoles(
      nextFlow,
      getFlowRoles(nextFlow).map((role) => {
        if (role.category !== 'outsideTheBox' || !evalById.has(String(role.id))) return role;
        return { ...role, userEvaluation: evalById.get(String(role.id)) };
      })
    );
    changed = true;
  }
  return changed ? nextFlow : flow;
}
