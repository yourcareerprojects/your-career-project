import { generateStepId } from './stepIdUtils';
import { getRoleTitleEnglishForMatch } from './roleTitleDisplay';
import { flowItemMatchesStep } from './simulationRoleRanking';

const MONGO_SUBDOC_HEX_ID = /^[a-f0-9]{24}$/i;

function decodeRouteStepId(routeStepId) {
  if (routeStepId == null || routeStepId === '') return '';
  try {
    return decodeURIComponent(String(routeStepId).trim());
  } catch {
    return String(routeStepId).trim();
  }
}

/**
 * @param {object} [role]
 * @returns {'nextSteps'|'outsideTheBox'}
 */
function resolveCategoryKeyForStepId(role) {
  const raw = String(role?.category || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  if (
    raw === 'outsidethebox' ||
    raw === 'outsidesimulationbox' ||
    raw === 'outsidecomfortzone' ||
    raw === 'outsidetheboxroles'
  ) {
    return 'outsideTheBox';
  }
  return 'nextSteps';
}

/**
 * Ordered lists to scan for index (evaluation flow first, then flat results).
 * @param {object} results
 * @param {'nextSteps'|'outsideTheBox'} catKey
 * @returns {object[][]}
 */
function listsForCategory(results, catKey) {
  const lists = [];
  const flow = results?.evaluationFlow;
  if (flow && typeof flow === 'object') {
    const arr = flow[catKey];
    if (Array.isArray(arr)) lists.push(arr);
  }
  if (catKey === 'outsideTheBox') {
    for (const k of ['outsideTheBox', 'outsideSimulationBox', 'outsideComfortZone']) {
      const arr = results[k];
      if (Array.isArray(arr)) lists.push(arr);
    }
  } else if (Array.isArray(results?.nextSteps)) {
    lists.push(results.nextSteps);
  }
  return lists;
}

/**
 * Resolves a stable `stepId` for POST /api/profile/saved-career-steps from a role shown
 * on the saved-simulation detail page. Mongoose array subdocuments expose `id` as the
 * subdocument `_id` hex when no explicit `stepId` was stored, which must not be used as
 * the career-step key — we fall back to the same deterministic format as `buildEvaluationRolesList`.
 *
 * @param {object} role – simulation result row / evaluation-flow role
 * @param {object|null|undefined} simulation – loaded saved simulation `{ id, results }`
 * @param {string} simulationResultId – saved simulation id (same as `simulation.id`)
 * @param {{ routeStepId?: string }} [options] – URL `:stepId` from saved-simulation career-step detail (canonical when it embeds `simulationResultId`)
 * @returns {string}
 */
export function resolveSimulationRoleStepIdForSave(role, simulation, simulationResultId, options = {}) {
  const simId = simulationResultId || simulation?.id || 'local';
  const decodedRoute = decodeRouteStepId(options.routeStepId);
  if (
    decodedRoute &&
    !MONGO_SUBDOC_HEX_ID.test(decodedRoute) &&
    simId &&
    decodedRoute.includes(simId)
  ) {
    return decodedRoute;
  }

  const explicit =
    role?.stepId != null && String(role.stepId).trim() !== ''
      ? String(role.stepId).trim()
      : role?.instanceId != null && String(role.instanceId).trim() !== ''
        ? String(role.instanceId).trim()
        : '';
  if (explicit && !MONGO_SUBDOC_HEX_ID.test(explicit)) return explicit;

  const fromId = role?.id != null && String(role.id).trim() !== '' ? String(role.id).trim() : '';
  if (fromId && !MONGO_SUBDOC_HEX_ID.test(fromId)) return fromId;

  const cat = resolveCategoryKeyForStepId(role);
  const results = simulation?.results;
  const slugInput = getRoleTitleEnglishForMatch(role?.title) || role?.title;

  if (results && typeof results === 'object') {
    const lists = listsForCategory(results, cat);
    for (const list of lists) {
      const idx = list.findIndex((r) => r === role || flowItemMatchesStep(role, r));
      if (idx >= 0) {
        return generateStepId(slugInput, simId, cat, idx);
      }
    }
  }

  const fallbackIndex = Number.isFinite(role?.sourceIndex) ? role.sourceIndex : 0;
  return generateStepId(slugInput, simId, cat, fallbackIndex);
}
