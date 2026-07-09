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

  const nextComplete = isEvaluationComplete(evaluationFlow.nextSteps);
  const ootbComplete = isEvaluationComplete(evaluationFlow.outsideTheBox);
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
  if (!flow || !Array.isArray(flow[categoryKey])) return flow;
  const roles = flow[categoryKey];
  if (!isEvaluationComplete(roles)) return flow;
  if (
    flow.phases?.[categoryKey] === 'ranked'
    && Array.isArray(flow.ranked?.[categoryKey])
    && flow.ranked[categoryKey].length
  ) {
    return flow;
  }
  const rankSlug = categoryKey === 'nextSteps' ? 'next' : 'out_of_the_box';
  const ranked = buildRankedRows(roles, rankSlug);
  const nextFlow = markCategoryRankingSeen(
    {
      ...flow,
      phases: { ...flow.phases, [categoryKey]: 'ranked' },
      ranked: { ...flow.ranked, [categoryKey]: ranked },
    },
    categoryKey
  );
  if (categoryKey === 'outsideTheBox' && nextFlow.outsideTheBoxDeferred) {
    return { ...nextFlow, outsideTheBoxDeferred: false };
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
  return {
    simulationId,
    nextSteps: buildEvaluationRolesList(results, 'nextSteps'),
    outsideTheBox: buildEvaluationRolesList(results, 'outsideTheBox'),
    hasStarted: { nextSteps: false, outsideTheBox: false },
    phases: { nextSteps: 'eval', outsideTheBox: 'eval' },
    ranked: { nextSteps: null, outsideTheBox: null },
    mobilePhaseGate: { outsideTheBox: 'locked' },
    hasSeenRanking: { nextSteps: false, outsideTheBox: false },
    outsideTheBoxDeferred: false,
    wizardPaused: false,
  };
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
    const ootbAlreadyStarted = Boolean(currentFlow.hasStarted?.outsideTheBox);
    let merged = {
      ...currentFlow,
      simulationId: resultsKey,
      nextSteps: buildEvaluationRolesList(results, 'nextSteps', currentFlow.nextSteps),
      outsideTheBox: buildEvaluationRolesList(results, 'outsideTheBox', currentFlow.outsideTheBox),
      mobilePhaseGate: currentFlow.mobilePhaseGate ?? {
        outsideTheBox: ootbAlreadyStarted ? 'unlocked' : 'locked',
      },
      hasSeenRanking: currentFlow.hasSeenRanking ?? {
        nextSteps: currentFlow.phases?.nextSteps === 'ranked',
        outsideTheBox: currentFlow.phases?.outsideTheBox === 'ranked',
      },
      outsideTheBoxDeferred: currentFlow.outsideTheBoxDeferred ?? false,
      wizardPaused: currentFlow.wizardPaused ?? false,
    };
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
  return applyAutoRankingRevealWhenBothComplete(merged);
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

function hasNextStepsRankedOverview(evaluationFlow) {
  return (
    evaluationFlow.phases?.nextSteps === 'ranked'
    && Array.isArray(evaluationFlow.ranked?.nextSteps)
    && evaluationFlow.ranked.nextSteps.length > 0
  );
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
  const next = Array.isArray(flow.ranked?.nextSteps) ? flow.ranked.nextSteps : [];
  const ootb = Array.isArray(flow.ranked?.outsideTheBox) ? flow.ranked.outsideTheBox : [];
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

  const applyForCategory = (categoryKey, rankSlug) => {
    const categoryIds = new Set((flow[categoryKey] || []).map((role) => role.id));
    const relevant = flattenedRows.filter((row) => categoryIds.has(row.id));
    if (!relevant.length) return null;
    const byId = new Map((flow[categoryKey] || []).map((role) => [role.id, role]));
    const nextRoles = relevant
      .map((row) => {
        const existing = byId.get(row.id);
        if (!existing) return null;
        return { ...existing, userEvaluation: row.userEvaluation };
      })
      .filter(Boolean);
    if (!nextRoles.length) return null;
    return {
      roles: nextRoles,
      ranked: buildRankedRowsFromOrderedRoles(nextRoles, rankSlug),
    };
  };

  let nextFlow = { ...flow, ranked: { ...flow.ranked } };
  let changed = false;
  const nextUpdate = applyForCategory('nextSteps', 'next');
  const ootbUpdate = applyForCategory('outsideTheBox', 'out_of_the_box');
  if (nextUpdate) {
    nextFlow.nextSteps = nextUpdate.roles;
    nextFlow.ranked.nextSteps = nextUpdate.ranked;
    changed = true;
  }
  if (ootbUpdate) {
    nextFlow.outsideTheBox = ootbUpdate.roles;
    nextFlow.ranked.outsideTheBox = ootbUpdate.ranked;
    changed = true;
  }
  return changed ? nextFlow : flow;
}
