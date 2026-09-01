/**
 * Combined ranking accents: green = already-seen roles, red = newly appeared roles.
 * NEXT vs OOTB category colors stay on the evaluation / per-category ranking UI only.
 *
 * Visit model (mirrors identityTraitChangeHighlights):
 * - Freeze the "seen" baseline for the whole tab session so SPA navigate-away/back
 *   keeps new roles red.
 * - Persist the union of visible role ids on pagehide/beforeunload so a full reload
 *   treats them as existing (green).
 */

const STORAGE_PREFIX = 'simulation:combinedRankingSeenRoles:';

/**
 * @typedef {{
 *   storageKey: string,
 *   baseline: Set<string> | null,
 *   pendingAckIds: Set<string>,
 * }} CombinedRankingVisit
 */

/** @type {Map<string, CombinedRankingVisit>} */
const stickyVisits = new Map();

/**
 * @param {{
 *   isViewingSavedSimulation?: boolean,
 *   savedSimulationId?: string | null,
 *   simulationIdForCards?: string | null,
 * }} opts
 * @returns {string}
 */
export function buildCombinedRankingSeenRolesKey({
  isViewingSavedSimulation = false,
  savedSimulationId = null,
  simulationIdForCards = null,
} = {}) {
  const mode = isViewingSavedSimulation ? 'saved' : 'live';
  const simId = savedSimulationId || simulationIdForCards || 'local';
  return `${STORAGE_PREFIX}${mode}:${simId}`;
}

/**
 * @param {string} storageKey
 * @returns {Set<string> | null} null when no baseline has been stored yet
 */
export function loadSeenCombinedRoleIds(storageKey) {
  if (typeof localStorage === 'undefined' || !storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.map(String));
  } catch {
    return null;
  }
}

/**
 * @param {string} storageKey
 * @param {Iterable<string>} ids
 */
export function saveSeenCombinedRoleIds(storageKey, ids) {
  if (typeof localStorage === 'undefined' || !storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...ids].map(String)));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Union role ids into the persisted "seen" set (so a reload treats them as existing).
 * @param {string} storageKey
 * @param {Iterable<string | number | null | undefined>} roleIds
 * @returns {Set<string>}
 */
export function acknowledgeCombinedRankingRoleIds(storageKey, roleIds) {
  const prev = loadSeenCombinedRoleIds(storageKey) || new Set();
  const next = new Set(prev);
  for (const id of roleIds || []) {
    if (id == null || id === '') continue;
    next.add(String(id));
  }
  saveSeenCombinedRoleIds(storageKey, next);
  return next;
}

/**
 * @param {object} row — combined ranked row
 * @returns {string}
 */
export function getCombinedRankingRowId(row) {
  if (!row || typeof row !== 'object') return '';
  if (row.id != null && row.id !== '') return String(row.id);
  if (row.step?.id != null && row.step.id !== '') return String(row.step.id);
  if (row.step?.stepId != null && row.step.stepId !== '') return String(row.step.stepId);
  return '';
}

/**
 * Map a combined-ranking row to the accent used by RankedGroupsView cards:
 * - `nextSteps` → green (existing)
 * - `outsideTheBox` → red (new this open)
 *
 * @param {object} row
 * @param {Set<string> | null | undefined} seenAtOpen — ids known before this page open; null = first baseline (all existing)
 * @returns {'nextSteps' | 'outsideTheBox'}
 */
export function resolveCombinedRankingAccentCategoryKey(row, seenAtOpen) {
  const id = getCombinedRankingRowId(row);
  if (!id) return 'nextSteps';
  // First visit (no baseline yet): treat everything as existing / green.
  if (seenAtOpen == null) return 'nextSteps';
  if (!seenAtOpen.has(id)) return 'outsideTheBox';
  return 'nextSteps';
}

/**
 * Ensure a sticky visit exists for this storage key (survives SPA remounts).
 * @param {string} storageKey
 * @returns {CombinedRankingVisit | null}
 */
function ensureStickyVisit(storageKey) {
  if (!storageKey) return null;
  let visit = stickyVisits.get(storageKey);
  if (!visit) {
    visit = {
      storageKey,
      baseline: loadSeenCombinedRoleIds(storageKey),
      pendingAckIds: new Set(),
    };
    stickyVisits.set(storageKey, visit);
  }
  return visit;
}

/**
 * Frozen "seen" baseline for this tab session (do not mutate for coloring).
 * @param {string} storageKey
 * @returns {Set<string> | null}
 */
export function getCombinedRankingVisitBaseline(storageKey) {
  const visit = ensureStickyVisit(storageKey);
  return visit ? visit.baseline : null;
}

/**
 * Track ranked roles shown this visit. Bootstraps an empty baseline on first sight
 * (all current ids = existing/green). Does not write localStorage until unload.
 *
 * @param {string} storageKey
 * @param {Iterable<string | number | null | undefined>} roleIds
 * @returns {Set<string> | null} baseline used for accents this visit
 */
export function trackCombinedRankingRolesForVisit(storageKey, roleIds) {
  const visit = ensureStickyVisit(storageKey);
  if (!visit) return null;

  const ids = [];
  for (const id of roleIds || []) {
    if (id == null || id === '') continue;
    const s = String(id);
    ids.push(s);
    visit.pendingAckIds.add(s);
  }

  // First time this simulation has no persisted baseline: current board is all "existing".
  if (visit.baseline == null && ids.length) {
    visit.baseline = new Set(ids);
  }

  return visit.baseline;
}

/**
 * Persist pending role ids for every sticky visit (full reload → green).
 */
export function flushCombinedRankingVisitAcknowledgements() {
  for (const visit of stickyVisits.values()) {
    if (!visit.pendingAckIds.size) continue;
    acknowledgeCombinedRankingRoleIds(visit.storageKey, visit.pendingAckIds);
    visit.pendingAckIds = new Set();
  }
}

/**
 * Drop in-memory visit state (tests / auth hygiene). Does not clear localStorage.
 */
export function clearCombinedRankingStickyVisits() {
  stickyVisits.clear();
}

if (typeof window !== 'undefined') {
  const flush = () => {
    try {
      flushCombinedRankingVisitAcknowledgements();
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
}
