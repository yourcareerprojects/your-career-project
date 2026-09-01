/**
 * Canonical evaluationFlow role document + legacy dual-list compat.
 *
 * Source of truth: `evaluationFlow.roles[]`
 * Keep / Skip / Dislike columns MUST equal:
 *   normalizeEvaluationFlow(flow).roles → group by userEvaluation → order by order
 * (see `groupRolesByEvaluation`). Do not overlay localStorage or dual session copies
 * as a second membership source.
 *
 * Derived views (`nextSteps`, `outsideTheBox`, `ranked`) are materialized on read only —
 * do not persist them (see `toPersistedEvaluationFlow`).
 */

import { getSimulationRoleKey } from './simulationRoleKey';
import { getHybridRawForStep } from './careerStepMatchScore';

export const evaluationPriority = {
  keep: 0,
  skip: 1,
  dislike: 2,
};

/** Keep / Skip / Dislike column keys for ranked boards. */
export const EVALUATION_GROUP_KEYS = ['keep', 'skip', 'dislike'];

function getNumericMatchScore(step, categoryKey) {
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

function rankRolesByPreference(roles) {
  return [...roles].sort((a, b) => {
    const evalDiff =
      evaluationPriority[a.userEvaluation] - evaluationPriority[b.userEvaluation];
    if (evalDiff !== 0) return evalDiff;
    return (b.matchScore || 0) - (a.matchScore || 0);
  });
}

function buildRankedRowsFromOrderedRoles(orderedRoles, rankCategory) {
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
 * @param {object | null | undefined} role
 * @returns {boolean}
 */
export function isExplorationSourceRole(role) {
  if (!role || typeof role !== 'object') return false;
  if (role.source === 'exploration') return true;
  if (role.explorationSessionId) return true;
  const id = String(role.id || role.stepId || role.instanceId || '');
  return id.startsWith('exploration-');
}

/**
 * @param {object} role
 * @param {'nextSteps' | 'outsideTheBox'} category
 * @param {number | null} [order]
 * @returns {object}
 */
export function toCanonicalRole(role, category, order = null) {
  if (!role || typeof role !== 'object') return role;
  const id =
    role.id
    || role.stepId
    || role.instanceId
    || `role-${category}-${Math.random().toString(36).slice(2, 9)}`;
  const key = getSimulationRoleKey({ ...role, id, stepId: role.stepId || id }) || `id:${id}`;
  const resolvedOrder =
    order != null && Number.isFinite(order)
      ? order
      : (typeof role.order === 'number' && Number.isFinite(role.order) ? role.order : null);

  return {
    ...role,
    key,
    id,
    instanceId: role.instanceId || id,
    stepId: role.stepId || id,
    category,
    listCategory:
      role.listCategory
      || (category === 'nextSteps' ? 'nextCareerRoles' : 'outsideTheBoxRoles'),
    userEvaluation: role.userEvaluation ?? null,
    order: resolvedOrder,
    matchScore:
      typeof role.matchScore === 'number' && Number.isFinite(role.matchScore)
        ? role.matchScore
        : getNumericMatchScore(role, category),
    source: isExplorationSourceRole(role) ? 'exploration' : (role.source || 'simulation'),
  };
}

/**
 * Flatten legacy nextSteps/outsideTheBox/ranked into canonical roles[].
 * @param {object} flow
 * @returns {object[]}
 */
export function flattenLegacyFlowToRoles(flow) {
  if (!flow || typeof flow !== 'object') return [];
  const roles = [];
  const seenKeys = new Set();

  for (const category of ['nextSteps', 'outsideTheBox']) {
    const phase = flow.phases?.[category];
    const rankedRows = flow.ranked?.[category];
    const list = Array.isArray(flow[category]) ? flow[category] : [];

    if (phase === 'ranked' && Array.isArray(rankedRows) && rankedRows.length) {
      rankedRows.forEach((row, index) => {
        if (!row || typeof row !== 'object') return;
        const step = row.step && typeof row.step === 'object' ? row.step : row;
        const canonical = toCanonicalRole(
          {
            ...step,
            userEvaluation: row.userEvaluation ?? step.userEvaluation ?? null,
            matchScore: row.matchScore ?? step.matchScore,
          },
          category,
          index
        );
        if (seenKeys.has(canonical.key)) return;
        seenKeys.add(canonical.key);
        roles.push(canonical);
      });

      list.forEach((role) => {
        const canonical = toCanonicalRole(role, category, null);
        if (seenKeys.has(canonical.key)) return;
        seenKeys.add(canonical.key);
        roles.push(canonical);
      });
      continue;
    }

    list.forEach((role, index) => {
      const canonical = toCanonicalRole(role, category, index);
      if (seenKeys.has(canonical.key)) return;
      seenKeys.add(canonical.key);
      roles.push(canonical);
    });
  }

  return roles;
}

/**
 * @param {object | null | undefined} flow
 * @returns {object[]}
 */
export function getFlowRoles(flow) {
  if (!flow || typeof flow !== 'object') return [];
  if (Array.isArray(flow.roles) && flow.roles.length) {
    return flow.roles.map((role) =>
      toCanonicalRole(role, role.category === 'outsideTheBox' ? 'outsideTheBox' : 'nextSteps', role.order)
    );
  }
  return flattenLegacyFlowToRoles(flow);
}

function sortByOrder(roles) {
  return [...roles].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Eval queue for a category (derived from roles[]).
 * @param {object | null | undefined} flow
 * @param {'nextSteps' | 'outsideTheBox'} category
 * @returns {object[]}
 */
export function getEvalQueue(flow, category) {
  return sortByOrder(getFlowRoles(flow).filter((role) => role.category === category));
}

/**
 * Group evaluated roles into Keep / Skip / Dislike columns (canonical column SoT).
 * Within each column, order follows `roles[].order` (global rank order), then preference+score.
 *
 * @param {object[] | null | undefined} roles
 * @param {{ category?: 'nextSteps' | 'outsideTheBox' | null }} [opts]
 * @returns {{ keep: object[], skip: object[], dislike: object[] }}
 */
export function groupRolesByEvaluation(roles, opts = {}) {
  const grouped = { keep: [], skip: [], dislike: [] };
  const list = Array.isArray(roles) ? roles : [];
  const category = opts.category ?? null;
  const filtered = list.filter((role) => {
    if (!role || role.userEvaluation == null) return false;
    if (!grouped[role.userEvaluation]) return false;
    if (category && role.category !== category) return false;
    return true;
  });
  const hasExplicitOrder = filtered.every((role) => typeof role.order === 'number');
  const ordered = hasExplicitOrder
    ? [...filtered].sort((a, b) => a.order - b.order)
    : rankRolesByPreference(filtered);
  ordered.forEach((role) => {
    grouped[role.userEvaluation].push(role);
  });
  return grouped;
}

/**
 * Flatten Keep → Skip → Dislike columns back into a single ordered list
 * (DnD persist shape). Prefer `getRankedBoard` for display order when orders are explicit.
 * @param {{ keep?: object[], skip?: object[], dislike?: object[] }} columns
 * @returns {object[]}
 */
export function flattenEvaluationColumns(columns) {
  if (!columns || typeof columns !== 'object') return [];
  return EVALUATION_GROUP_KEYS.flatMap((key) =>
    Array.isArray(columns[key]) ? columns[key] : []
  );
}

/**
 * Ranked board rows for a category, or null when not in ranked phase.
 * Built only from `roles[]` ordered by `order` (no layout overlay).
 *
 * @param {object | null | undefined} flow
 * @param {'nextSteps' | 'outsideTheBox'} category
 * @returns {object[] | null}
 */
export function getRankedBoard(flow, category) {
  if (!flow || flow.phases?.[category] !== 'ranked') return null;
  const evaluated = getEvalQueue(flow, category).filter((role) => role.userEvaluation != null);
  if (!evaluated.length) return [];
  const rankSlug = category === 'nextSteps' ? 'next' : 'out_of_the_box';
  const hasExplicitOrder = evaluated.every((role) => typeof role.order === 'number');
  const ordered = hasExplicitOrder
    ? [...evaluated].sort((a, b) => a.order - b.order)
    : rankRolesByPreference(evaluated);
  return buildRankedRowsFromOrderedRoles(ordered, rankSlug);
}

/**
 * Keep / Skip / Dislike columns for a ranked category (null when not ranked).
 * Column membership === roles[] grouped by userEvaluation.
 * @param {object | null | undefined} flow
 * @param {'nextSteps' | 'outsideTheBox'} category
 * @returns {{ keep: object[], skip: object[], dislike: object[] } | null}
 */
export function getRankedColumns(flow, category) {
  if (!flow || flow.phases?.[category] !== 'ranked') return null;
  return groupRolesByEvaluation(getFlowRoles(flow), { category });
}

/**
 * Assign deterministic order from preference + score (used on promote / re-rate while ranked).
 * @param {object[]} categoryRoles
 * @returns {object[]}
 */
export function assignRankedOrderByPreference(categoryRoles) {
  const list = Array.isArray(categoryRoles) ? categoryRoles : [];
  const evaluated = list.filter((role) => role && role.userEvaluation != null);
  const sorted = rankRolesByPreference(evaluated);
  const orderById = new Map(sorted.map((role, index) => [String(role.id), index]));
  return list.map((role) => {
    if (!role || role.userEvaluation == null) {
      return { ...role, order: role.order ?? null };
    }
    const nextOrder = orderById.has(String(role.id))
      ? orderById.get(String(role.id))
      : role.order;
    return { ...role, order: nextOrder };
  });
}

/**
 * Insert newly rated roles into an existing ranked order by preference band + score.
 * @param {object[]} existingCategoryRoles
 * @param {Set<string>} insertedIds
 * @returns {object[]}
 */
export function mergeInsertedRolesIntoRankedOrder(existingCategoryRoles, insertedIds) {
  const roles = Array.isArray(existingCategoryRoles) ? existingCategoryRoles : [];
  const insertSet = insertedIds instanceof Set ? insertedIds : new Set();
  const evaluated = roles.filter((role) => role && role.userEvaluation != null);
  const existingOrdered = evaluated
    .filter((role) => !insertSet.has(String(role.id)))
    .sort((a, b) => {
      const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
      const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return 0;
    });
  const inserted = evaluated.filter((role) => insertSet.has(String(role.id)));

  const byPref = { keep: [], skip: [], dislike: [] };
  existingOrdered.forEach((role) => {
    const pref = role.userEvaluation;
    if (byPref[pref]) byPref[pref].push(role);
  });

  inserted.forEach((role) => {
    const pref = role.userEvaluation;
    const band = byPref[pref] || byPref.skip;
    const score = typeof role.matchScore === 'number' ? role.matchScore : 0;
    let insertAt = band.length;
    for (let i = 0; i < band.length; i += 1) {
      const otherScore = typeof band[i].matchScore === 'number' ? band[i].matchScore : 0;
      if (score > otherScore) {
        insertAt = i;
        break;
      }
    }
    band.splice(insertAt, 0, role);
  });

  const ordered = [...byPref.keep, ...byPref.skip, ...byPref.dislike];
  const orderById = new Map(ordered.map((role, index) => [String(role.id), index]));
  const unevaluated = roles.filter((role) => !role || role.userEvaluation == null);

  return [
    ...ordered.map((role) => ({ ...role, order: orderById.get(String(role.id)) })),
    ...unevaluated.map((role) => ({ ...role, order: role?.order ?? null })),
  ];
}

/**
 * Rebuild legacy dual lists + ranked boards from roles[] (read-only rematerialize bridge).
 * Callers must not treat derived lists as writable SoT — mutate roles[] then sync.
 * @param {object} flow
 * @returns {object}
 */
export function syncDerivedViewsFromRoles(flow) {
  if (!flow || typeof flow !== 'object') return flow;

  const roles = getFlowRoles(flow).map((role) =>
    toCanonicalRole(role, role.category === 'outsideTheBox' ? 'outsideTheBox' : 'nextSteps', role.order)
  );

  const nextSteps = sortByOrder(roles.filter((role) => role.category === 'nextSteps'));
  const outsideTheBox = sortByOrder(roles.filter((role) => role.category === 'outsideTheBox'));

  const withRoles = { ...flow, roles, nextSteps, outsideTheBox };
  const ranked = { ...(flow.ranked || {}) };

  if (flow.phases?.nextSteps === 'ranked') {
    ranked.nextSteps = getRankedBoard(withRoles, 'nextSteps');
  } else if (flow.phases?.nextSteps === 'eval') {
    ranked.nextSteps = null;
  }

  if (flow.phases?.outsideTheBox === 'ranked') {
    ranked.outsideTheBox = getRankedBoard(withRoles, 'outsideTheBox');
  } else if (flow.phases?.outsideTheBox === 'eval') {
    ranked.outsideTheBox = null;
  }

  return {
    ...withRoles,
    ranked,
  };
}

/**
 * Ensure roles[] exists and derived views are aligned (read normalizer).
 * @param {object | null | undefined} flow
 * @returns {object | null | undefined}
 */
export function normalizeEvaluationFlow(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  if (Array.isArray(flow.roles) && flow.roles.length) {
    return syncDerivedViewsFromRoles(flow);
  }
  const flattened = flattenLegacyFlowToRoles(flow);
  return syncDerivedViewsFromRoles({ ...flow, roles: flattened });
}

/**
 * Drop derived dual-list / ranked boards; keep roles[] + UI flags.
 * @param {object | null | undefined} flow
 * @returns {object | null | undefined}
 */
export function stripDerivedEvaluationViews(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  const {
    nextSteps: _nextSteps,
    outsideTheBox: _outsideTheBox,
    ranked: _ranked,
    ...rest
  } = flow;
  return rest;
}

/**
 * Canonical persist shape: ensure roles[] then omit derived views.
 * @param {object | null | undefined} flow
 * @returns {object | null | undefined}
 */
export function toPersistedEvaluationFlow(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  const normalized = normalizeEvaluationFlow(flow);
  if (!normalized) return normalized;
  return stripDerivedEvaluationViews(normalized);
}

/**
 * Strip evaluationFlow derived views on a results payload before storage/PUT.
 * @param {object | null | undefined} results
 * @returns {object | null | undefined}
 */
export function toPersistedSimulationResults(results) {
  if (!results || typeof results !== 'object') return results;
  if (!results.evaluationFlow || typeof results.evaluationFlow !== 'object') {
    return results;
  }
  return {
    ...results,
    evaluationFlow: toPersistedEvaluationFlow(results.evaluationFlow),
  };
}

/**
 * Materialize evaluationFlow derived views on a results payload after load.
 * Also aligns top-level simulationId with evaluationFlow.simulationId when the
 * envelope omitted it (otherwise ensure-flow remount logic can rebuild and drop inserts).
 * @param {object | null | undefined} results
 * @returns {object | null | undefined}
 */
export function withMaterializedEvaluationFlow(results) {
  if (!results || typeof results !== 'object') return results;
  if (!results.evaluationFlow || typeof results.evaluationFlow !== 'object') {
    return results;
  }
  const evaluationFlow = normalizeEvaluationFlow(results.evaluationFlow);
  const envelopeId = results.simulationId;
  const flowId = evaluationFlow?.simulationId;
  const resolvedId =
    (envelopeId && envelopeId !== 'local' ? envelopeId : null)
    || (flowId && flowId !== 'local' ? flowId : null)
    || envelopeId
    || flowId
    || null;

  if (!resolvedId) {
    return { ...results, evaluationFlow };
  }

  return {
    ...results,
    simulationId: resolvedId,
    evaluationFlow: {
      ...evaluationFlow,
      simulationId: resolvedId,
    },
  };
}

/**
 * Replace roles[] and sync derived views.
 * @param {object} flow
 * @param {object[]} roles
 * @returns {object}
 */
export function withFlowRoles(flow, roles) {
  return syncDerivedViewsFromRoles({
    ...flow,
    roles: Array.isArray(roles) ? roles : [],
  });
}

/**
 * Upsert a role into roles[] by canonical key.
 * @param {object} flow
 * @param {object} role
 * @param {'nextSteps' | 'outsideTheBox'} category
 * @returns {{ flow: object, inserted: boolean, role: object }}
 */
export function upsertFlowRole(flow, role, category) {
  const normalized = normalizeEvaluationFlow(flow);
  const canonical = toCanonicalRole(role, category, role?.order ?? null);
  const roles = [...getFlowRoles(normalized)];
  const index = roles.findIndex(
    (item) => item.key === canonical.key || String(item.id) === String(canonical.id)
  );
  let inserted = false;
  let roleIndex = index;
  if (index >= 0) {
    const prev = roles[index];
    roles[index] = toCanonicalRole(
      {
        ...prev,
        ...canonical,
        id: prev.id,
        instanceId: prev.instanceId || prev.id,
        stepId: prev.stepId || prev.id,
        userEvaluation: canonical.userEvaluation ?? prev.userEvaluation,
        explorationSessionId:
          canonical.explorationSessionId ?? prev.explorationSessionId ?? null,
        order: canonical.order != null ? canonical.order : prev.order,
      },
      category,
      canonical.order != null ? canonical.order : prev.order
    );
  } else {
    const catRoles = roles.filter((item) => item.category === category);
    const nextOrder =
      canonical.order != null
        ? canonical.order
        : catRoles.reduce(
          (max, item) => Math.max(max, typeof item.order === 'number' ? item.order : -1),
          -1
        ) + 1;
    roles.push(toCanonicalRole(canonical, category, nextOrder));
    inserted = true;
    roleIndex = roles.length - 1;
  }
  return {
    flow: withFlowRoles(normalized, roles),
    inserted,
    role: roles[roleIndex],
  };
}

/**
 * Set userEvaluation on a role by id.
 * @param {object} flow
 * @param {string} stepId
 * @param {'keep'|'skip'|'dislike'|null} evaluation
 * @param {'nextSteps' | 'outsideTheBox' | null} [categoryKey]
 * @returns {object}
 */
export function setFlowRoleEvaluation(flow, stepId, evaluation, categoryKey = null) {
  const normalized = normalizeEvaluationFlow(flow);
  let matched = false;
  let roles = getFlowRoles(normalized).map((role) => {
    if (categoryKey && role.category !== categoryKey) return role;
    if (String(role.id) !== String(stepId) && String(role.stepId) !== String(stepId)) {
      return role;
    }
    matched = true;
    return { ...role, userEvaluation: evaluation };
  });

  let next = withFlowRoles(normalized, roles);
  const categories = categoryKey ? [categoryKey] : ['nextSteps', 'outsideTheBox'];
  for (const cat of categories) {
    if (next.phases?.[cat] !== 'ranked') continue;
    const catRoles = assignRankedOrderByPreference(
      getFlowRoles(next).filter((role) => role.category === cat)
    );
    const others = getFlowRoles(next).filter((role) => role.category !== cat);
    next = withFlowRoles(next, [...others, ...catRoles]);
  }
  return matched ? next : normalized;
}

/**
 * Apply an explicit ordered id list to a ranked category.
 * @param {object} flow
 * @param {'nextSteps' | 'outsideTheBox'} categoryKey
 * @param {string[]} orderedIds
 * @returns {object}
 */
export function reorderFlowCategory(flow, categoryKey, orderedIds) {
  const normalized = normalizeEvaluationFlow(flow);
  const ids = Array.isArray(orderedIds) ? orderedIds.map(String) : [];
  const orderById = new Map(ids.map((id, index) => [id, index]));
  const roles = getFlowRoles(normalized).map((role) => {
    if (role.category !== categoryKey) return role;
    if (!orderById.has(String(role.id))) return role;
    return { ...role, order: orderById.get(String(role.id)) };
  });
  return withFlowRoles(
    {
      ...normalized,
      phases: { ...normalized.phases, [categoryKey]: 'ranked' },
    },
    roles
  );
}
