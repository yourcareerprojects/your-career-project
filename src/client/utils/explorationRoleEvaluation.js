/**
 * Map IdentityExplorationSession jobs into simulation-style evaluation roles
 * (RoleEvaluationCard / RankedGroupsView contract), with optional occupation enrichment.
 * Also merges completed exploration rankings into a simulation evaluationFlow.
 */

import {
  isEvaluationComplete,
  buildRankedRows,
  buildRankedRowsFromOrderedRoles,
} from './simulationRoleRanking';
import { getSimulationRoleKey } from './simulationRoleKey';
import {
  normalizeEvaluationFlow,
  getFlowRoles,
  withFlowRoles,
  toCanonicalRole,
  mergeInsertedRolesIntoRankedOrder,
  upsertFlowRole,
  getEvalQueue,
  getRankedBoard,
} from './evaluationFlowModel';

function pickFiniteScore(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function buildRoleId(sessionId, job, index) {
  const key = job?.careerPathId || job?.escoId || `idx-${index}`;
  return `exploration-${sessionId || 'session'}-${key}`;
}

/** @deprecated Prefer getSimulationRoleKey — kept as a stable export alias. */
export function getSimulationRoleDedupeKey(role) {
  return getSimulationRoleKey(role);
}

export function isExplorationInjectedRole(role) {
  if (!role || typeof role !== 'object') return false;
  if (role.explorationSessionId) return true;
  const id = String(role.id || role.stepId || role.instanceId || '');
  return id.startsWith('exploration-');
}

/**
 * Prefer next-role for strong identity deltas; OOTB for unexpected/wildcard/weak profile fit.
 * @param {object} role
 * @returns {'nextSteps' | 'outsideTheBox'}
 */
export function resolveExplorationTargetCategory(role) {
  const source = String(role?.source || '').trim().toLowerCase();
  if (source === 'highest_delta') return 'nextSteps';
  if (source === 'unexpected' || source === 'wildcard') return 'outsideTheBox';
  if (source === 'new_domain') {
    const profileFit = role?.profileFit;
    if (typeof profileFit === 'number' && Number.isFinite(profileFit) && profileFit >= 0.45) {
      return 'nextSteps';
    }
    return 'outsideTheBox';
  }
  const profileFit = role?.profileFit;
  if (typeof profileFit === 'number' && Number.isFinite(profileFit) && profileFit < 0.35) {
    return 'outsideTheBox';
  }
  return 'nextSteps';
}

/**
 * Choose a ranked category that the user can already see.
 * Prefer the role's natural bucket; only relocate when that board is not yet ranked
 * and the other board is already visible.
 *
 * @param {object} role
 * @param {object} flow
 * @returns {'nextSteps' | 'outsideTheBox'}
 */
export function pickExplorationMergeCategory(role, flow) {
  const preferred = resolveExplorationTargetCategory(role);
  if (flow?.phases?.[preferred] === 'ranked') return preferred;
  const other = preferred === 'nextSteps' ? 'outsideTheBox' : 'nextSteps';
  if (flow?.phases?.[other] === 'ranked') return other;
  return preferred;
}

function toFlowRoleForCategory(role, categoryKey, sessionId, simulationId) {
  const fitScore = pickFiniteScore(
    role?.matchScore,
    role?.hybridScoreNextRole,
    role?.hybridScoreOutOfTheBox,
    role?.profileFit,
    role?.newScore,
    role?.identityFit
  );
  const isNext = categoryKey === 'nextSteps';
  return {
    ...role,
    explorationSessionId: sessionId || role.explorationSessionId || null,
    simulationId: simulationId || role.simulationId || null,
    category: isNext ? 'nextSteps' : 'outsideTheBox',
    listCategory: isNext ? 'nextCareerRoles' : 'outsideTheBoxRoles',
    hybridScoreNextRole: isNext ? fitScore : role.hybridScoreNextRole,
    hybridScoreOutOfTheBox: isNext ? role.hybridScoreOutOfTheBox : fitScore,
    matchScore: fitScore,
    userEvaluation: role.userEvaluation || null,
  };
}

function findExistingRoleInFlowRoles(flow, key) {
  if (!key) return null;
  const roles = getFlowRoles(flow);
  const index = roles.findIndex((role) => role.key === key || getSimulationRoleKey(role) === key);
  if (index < 0) return null;
  return { index, role: roles[index], categoryKey: roles[index].category };
}

function rankedBoardHasRole(flow, categoryKey, role, dedupeKey) {
  const rankedRows = getRankedBoard(flow, categoryKey) || [];
  if (!rankedRows.length) return false;
  const roleId = role?.id != null ? String(role.id) : null;
  return rankedRows.some((row) => {
    if (roleId && row?.id != null && String(row.id) === roleId) return true;
    const rowKey = getSimulationRoleKey(row?.step || row);
    return Boolean(dedupeKey && rowKey && rowKey === dedupeKey);
  });
}

function explorationRolesAlreadyIntegrated(flow, explorationRoles) {
  if (!flow || !explorationRoles?.length) return false;
  const normalized = normalizeEvaluationFlow(flow);
  const anyRanked =
    normalized.phases?.nextSteps === 'ranked' || normalized.phases?.outsideTheBox === 'ranked';

  return explorationRoles.every((role) => {
    const key = getSimulationRoleKey(role);
    const existing = findExistingRoleInFlowRoles(normalized, key);
    if (!existing) return false;
    if (normalized.phases?.[existing.categoryKey] === 'ranked') {
      return rankedBoardHasRole(normalized, existing.categoryKey, existing.role, key);
    }
    if (anyRanked) {
      return (
        rankedBoardHasRole(normalized, 'nextSteps', existing.role, key)
        || rankedBoardHasRole(normalized, 'outsideTheBox', existing.role, key)
      );
    }
    return existing.role?.userEvaluation === role.userEvaluation;
  });
}

/**
 * After upserts, place inserted roles onto visible ranked boards and assign order.
 * @param {object} flow
 * @param {Set<string>} insertedIds
 * @returns {object}
 */
function finalizeExplorationRankedPlacement(flow, insertedIds) {
  let next = normalizeEvaluationFlow(flow);
  const insertSet = insertedIds instanceof Set ? insertedIds : new Set();
  if (!insertSet.size) return next;

  let roles = getFlowRoles(next).map((role) => {
    if (!insertSet.has(String(role.id))) return role;
    if (!isExplorationInjectedRole(role) || role.userEvaluation == null) return role;
    if (next.phases?.[role.category] === 'ranked') return role;
    const other = role.category === 'nextSteps' ? 'outsideTheBox' : 'nextSteps';
    if (next.phases?.[other] !== 'ranked') return role;
    return toCanonicalRole(
      {
        ...role,
        category: other,
        listCategory: other === 'nextSteps' ? 'nextCareerRoles' : 'outsideTheBoxRoles',
      },
      other,
      role.order
    );
  });
  next = withFlowRoles(next, roles);

  for (const categoryKey of ['nextSteps', 'outsideTheBox']) {
    if (next.phases?.[categoryKey] !== 'ranked') continue;
    const catRoles = mergeInsertedRolesIntoRankedOrder(
      getFlowRoles(next).filter((role) => role.category === categoryKey),
      insertSet
    );
    const others = getFlowRoles(next).filter((role) => role.category !== categoryKey);
    next = withFlowRoles(
      {
        ...next,
        hasSeenRanking: { ...next.hasSeenRanking, [categoryKey]: true },
      },
      [...others, ...catRoles]
    );
  }

  for (const categoryKey of ['nextSteps', 'outsideTheBox']) {
    if (next.phases?.[categoryKey] === 'ranked') continue;
    const queue = getEvalQueue(next, categoryKey);
    if (!isEvaluationComplete(queue)) continue;
    const catRoles = mergeInsertedRolesIntoRankedOrder(
      getFlowRoles(next).filter((role) => role.category === categoryKey),
      insertSet
    );
    const others = getFlowRoles(next).filter((role) => role.category !== categoryKey);
    next = withFlowRoles(
      {
        ...next,
        phases: { ...next.phases, [categoryKey]: 'ranked' },
        hasSeenRanking: { ...next.hasSeenRanking, [categoryKey]: true },
      },
      [...others, ...catRoles]
    );
  }

  return next;
}

/**
 * Merge completed exploration rankings into simulation evaluationFlow (roles[] source of truth).
 *
 * @param {object | null | undefined} results — full simulation results
 * @param {object[]} explorationRoles — rated roles from IdentityExplorationDiscoverDialog
 * @param {{ sessionId?: string }} [opts]
 * @returns {object | null | undefined} next results (same reference if unchanged)
 */
export function mergeExplorationRolesIntoSimulationResults(results, explorationRoles, opts = {}) {
  if (!results || typeof results !== 'object') return results;
  if (!results.evaluationFlow || typeof results.evaluationFlow !== 'object') return results;

  const explorationRated = Array.isArray(explorationRoles)
    ? explorationRoles.filter((role) => role && role.userEvaluation != null)
    : [];
  if (!explorationRated.length) return results;

  const sessionId = opts.sessionId ? String(opts.sessionId) : null;
  const flow = normalizeEvaluationFlow(results.evaluationFlow);
  const alreadyMerged = Array.isArray(flow.mergedExplorationSessionIds)
    ? flow.mergedExplorationSessionIds.map(String)
    : [];
  if (
    sessionId
    && alreadyMerged.includes(sessionId)
    && explorationRolesAlreadyIntegrated(flow, explorationRated)
  ) {
    return results;
  }

  let nextFlow = flow;
  const insertedIds = new Set();
  const touched = { nextSteps: false, outsideTheBox: false };
  let changed = false;

  for (const role of explorationRated) {
    const key = getSimulationRoleKey(role);
    const existing = findExistingRoleInFlowRoles(nextFlow, key);

    if (existing) {
      const onRankedBoard =
        nextFlow.phases?.[existing.categoryKey] === 'ranked'
          ? rankedBoardHasRole(nextFlow, existing.categoryKey, existing.role, key)
          : true;
      if (existing.role.userEvaluation === role.userEvaluation && onRankedBoard) {
        continue;
      }
      const updated = {
        ...existing.role,
        userEvaluation: role.userEvaluation,
        explorationSessionId:
          sessionId || existing.role.explorationSessionId || role.explorationSessionId || null,
        source: 'exploration',
      };
      const upserted = upsertFlowRole(nextFlow, updated, existing.categoryKey);
      nextFlow = upserted.flow;
      touched[existing.categoryKey] = true;
      if (updated.id != null) insertedIds.add(String(updated.id));
      changed = true;
      continue;
    }

    let categoryKey = pickExplorationMergeCategory(role, nextFlow);
    if (
      nextFlow.phases?.[categoryKey] !== 'ranked'
      && (nextFlow.phases?.nextSteps === 'ranked' || nextFlow.phases?.outsideTheBox === 'ranked')
    ) {
      const other = categoryKey === 'nextSteps' ? 'outsideTheBox' : 'nextSteps';
      if (nextFlow.phases?.[other] === 'ranked') categoryKey = other;
    }

    const injected = toFlowRoleForCategory(
      role,
      categoryKey,
      sessionId,
      nextFlow.simulationId || results.simulationId
    );
    const upserted = upsertFlowRole(nextFlow, injected, categoryKey);
    nextFlow = upserted.flow;
    touched[categoryKey] = true;
    if (upserted.role?.id != null) insertedIds.add(String(upserted.role.id));
    changed = true;
  }

  if (!changed) {
    if (!sessionId) return results;
    if (alreadyMerged.includes(sessionId)) return results;
    return {
      ...results,
      evaluationFlow: {
        ...flow,
        mergedExplorationSessionIds: [...alreadyMerged, sessionId],
      },
    };
  }

  nextFlow = {
    ...nextFlow,
    hasStarted: {
      ...nextFlow.hasStarted,
      ...(touched.nextSteps ? { nextSteps: true } : {}),
      ...(touched.outsideTheBox ? { outsideTheBox: true } : {}),
    },
    mergedExplorationSessionIds: sessionId
      ? (alreadyMerged.includes(sessionId) ? alreadyMerged : [...alreadyMerged, sessionId])
      : alreadyMerged,
  };

  nextFlow = finalizeExplorationRankedPlacement(nextFlow, insertedIds);

  return {
    ...results,
    evaluationFlow: nextFlow,
  };
}

/**
 * @param {object} job — lean exploration job
 * @param {object | null} occupation — /api/occupations/lookup payload
 * @param {{ sessionId?: string, index?: number }} [opts]
 */
export function mapExplorationJobToEvaluationRole(job, occupation = null, opts = {}) {
  const index = Number.isFinite(opts.index) ? opts.index : 0;
  const sessionId = opts.sessionId ? String(opts.sessionId) : 'session';
  const id = buildRoleId(sessionId, job, index);
  const fitScore = pickFiniteScore(job?.profileFit, job?.newScore, job?.identityFit);

  const careerPathId =
    occupation?.careerPathId
    || occupation?._id
    || job?.careerPathId
    || null;
  const escoId = occupation?.escoId || job?.escoId || null;

  return {
    ...(occupation && typeof occupation === 'object' ? occupation : {}),
    id,
    instanceId: id,
    stepId: id,
    title: occupation?.title ?? job?.title ?? null,
    description: occupation?.description ?? null,
    domain: job?.domain || occupation?.domain || null,
    escoId,
    careerPathId: careerPathId ? String(careerPathId) : null,
    hybridScoreNextRole: fitScore,
    matchScore: fitScore,
    identityFit: Number.isFinite(job?.identityFit) ? job.identityFit : null,
    profileFit: Number.isFinite(job?.profileFit) ? job.profileFit : null,
    oldScore: Number.isFinite(job?.oldScore) ? job.oldScore : null,
    newScore: Number.isFinite(job?.newScore) ? job.newScore : null,
    delta: Number.isFinite(job?.delta) ? job.delta : null,
    source: job?.source || null,
    explorationSessionId: sessionId,
    userEvaluation: null,
    category: 'nextSteps',
    listCategory: 'nextCareerRoles',
    simulationId: `exploration-${sessionId}`,
  };
}

/**
 * Fetch full occupation details for a lean exploration job.
 * @param {object} job
 * @param {string} lang
 * @returns {Promise<object | null>}
 */
export async function fetchOccupationForExplorationJob(job, lang = 'en') {
  if (!job || typeof job !== 'object') return null;

  const qs = new URLSearchParams({ lang: String(lang || 'en') });
  if (job.careerPathId) qs.set('careerPathId', String(job.careerPathId));
  else if (job.escoId) qs.set('escoId', String(job.escoId));
  else return null;

  try {
    const res = await fetch(`/api/occupations/lookup?${qs.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success || !data.occupation) return null;
    return data.occupation;
  } catch {
    return null;
  }
}

/**
 * @param {object[]} jobs
 * @param {{ sessionId?: string, lang?: string }} [opts]
 * @returns {Promise<object[]>}
 */
export async function buildExplorationEvaluationRoles(jobs, opts = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  const sessionId = opts.sessionId ? String(opts.sessionId) : 'session';
  const lang = opts.lang || 'en';

  return Promise.all(
    list.map(async (job, index) => {
      const occupation = await fetchOccupationForExplorationJob(job, lang);
      return mapExplorationJobToEvaluationRole(job, occupation, { sessionId, index });
    })
  );
}

/**
 * Build a lean rankingProgress payload for server persistence.
 * @param {{
 *   phase?: 'eval'|'ranked',
 *   roles?: object[],
 *   rankedRows?: object[]|null,
 *   wizardPaused?: boolean,
 * }} input
 */
export function buildExplorationRankingProgress(input = {}) {
  const roles = Array.isArray(input.roles) ? input.roles : [];
  const evaluations = {};
  let evaluatedCount = 0;
  roles.forEach((role) => {
    if (!role?.id || role.userEvaluation == null) return;
    evaluations[String(role.id)] = role.userEvaluation;
    evaluatedCount += 1;
  });

  const rankedOrder = Array.isArray(input.rankedRows)
    ? input.rankedRows
      .filter((row) => row?.id != null)
      .map((row) => ({
        id: String(row.id),
        userEvaluation: row.userEvaluation || null,
      }))
    : undefined;

  return {
    phase: input.phase === 'ranked' ? 'ranked' : 'eval',
    wizardPaused: Boolean(input.wizardPaused),
    evaluations,
    ...(rankedOrder ? { rankedOrder } : {}),
    evaluatedCount,
    totalCount: roles.length,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Apply saved rankingProgress onto freshly built evaluation roles.
 * @param {object[]} roles
 * @param {object|null|undefined} rankingProgress
 * @returns {{ roles: object[], phase: 'eval'|'ranked', rankedRows: object[]|null }}
 */
export function applyExplorationRankingProgress(roles, rankingProgress) {
  const list = Array.isArray(roles) ? roles : [];
  if (!rankingProgress || typeof rankingProgress !== 'object' || !list.length) {
    return { roles: list, phase: 'eval', rankedRows: null };
  }

  const evaluations =
    rankingProgress.evaluations && typeof rankingProgress.evaluations === 'object'
      ? rankingProgress.evaluations
      : {};

  const nextRoles = list.map((role) => {
    const id = role?.id != null ? String(role.id) : null;
    if (!id) return role;
    const saved = evaluations[id];
    if (saved == null) return role;
    return { ...role, userEvaluation: saved };
  });

  let phase = rankingProgress.phase === 'ranked' ? 'ranked' : 'eval';
  let rankedRows = null;

  // If every role is already rated, always land on the ranked board (even when the
  // last persist still said phase "eval", e.g. pause between last rating and promote).
  if (isEvaluationComplete(nextRoles)) {
    phase = 'ranked';
  }

  if (phase === 'ranked') {
    const order = Array.isArray(rankingProgress.rankedOrder)
      ? rankingProgress.rankedOrder
      : null;
    const byId = new Map(
      nextRoles.filter((role) => role?.id != null).map((role) => [String(role.id), role])
    );

    if (order?.length) {
      const ordered = [];
      const seen = new Set();
      order.forEach((row) => {
        const id = row?.id != null ? String(row.id) : null;
        if (!id || seen.has(id)) return;
        const role = byId.get(id);
        if (!role || role.userEvaluation == null) return;
        ordered.push({
          ...role,
          userEvaluation: row.userEvaluation || role.userEvaluation,
        });
        seen.add(id);
      });
      nextRoles.forEach((role) => {
        const id = role?.id != null ? String(role.id) : null;
        if (!id || seen.has(id) || role.userEvaluation == null) return;
        ordered.push(role);
        seen.add(id);
      });
      if (ordered.length) {
        rankedRows = buildRankedRowsFromOrderedRoles(ordered, 'next');
        return { roles: ordered, phase: 'ranked', rankedRows };
      }
    }

    if (isEvaluationComplete(nextRoles)) {
      rankedRows = buildRankedRows(nextRoles, 'next');
      return { roles: nextRoles, phase: 'ranked', rankedRows };
    }
    phase = 'eval';
  }

  return { roles: nextRoles, phase, rankedRows: null };
}

/**
 * Flatten RankedGroupsView rows (`{ id, userEvaluation, matchScore, step }`) into
 * merge-ready evaluation roles so `source` / escoId on `step` are not lost.
 * @param {object|null|undefined} roleOrRow
 * @returns {object|null}
 */
export function unwrapExplorationMergeRole(roleOrRow) {
  if (!roleOrRow || typeof roleOrRow !== 'object') return null;
  if (roleOrRow.step && typeof roleOrRow.step === 'object') {
    return {
      ...roleOrRow.step,
      id: roleOrRow.id ?? roleOrRow.step.id,
      userEvaluation: roleOrRow.userEvaluation ?? roleOrRow.step.userEvaluation ?? null,
      matchScore: roleOrRow.matchScore ?? roleOrRow.step.matchScore,
      title: roleOrRow.title ?? roleOrRow.step.title,
    };
  }
  return roleOrRow;
}

/**
 * Prefer evaluated roles from the dialog payload; fall back to ranked board rows.
 * Used when finishing Discover so merge still works if roles state was cleared.
 * @param {object[]|null|undefined} roles
 * @param {object[]|null|undefined} rankedRows
 * @returns {object[]}
 */
export function resolveExplorationRolesForMerge(roles, rankedRows) {
  const fromRoles = (Array.isArray(roles) ? roles : [])
    .map(unwrapExplorationMergeRole)
    .filter((role) => role && role.userEvaluation != null);
  if (fromRoles.length) return fromRoles;

  return (Array.isArray(rankedRows) ? rankedRows : [])
    .map(unwrapExplorationMergeRole)
    .filter((role) => role && role.userEvaluation != null);
}
