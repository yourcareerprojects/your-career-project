/**
 * One-glance "this trait changed" highlights for Career Identity.
 *
 * Flow:
 * 1. Opening /puzzle-you freezes the last-seen baseline for the whole visit.
 * 2. As identity data arrives/refreshes (e.g. after a profile edit), re-diff vs that
 *    frozen baseline so the glow appears as soon as updated traits load — not only
 *    after a manual reload.
 * 3. Acknowledge (write baseline) when leaving the page / reloading, so the next
 *    open has no glow.
 */

const STORAGE_PREFIX = 'careerIdentity:seenPieces:';
/** Same noise floor as identity evolution scoring (0–1 confidence). */
const MIN_CONFIDENCE_DELTA = 0.05;

/**
 * @typedef {{ userId: string, baseline: Record<string, { confidence: number, layer: string }> | null, latestNodes: object[], changedIds: string[] }} TraitHighlightVisit
 */

/** @type {TraitHighlightVisit | null} */
let stickyVisit = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let stickyEndTimer = null;

function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function storageKey(userId) {
  return `${STORAGE_PREFIX}${String(userId || 'anon')}`;
}

/**
 * @param {object} node
 * @returns {{ id: string, confidence: number, layer: string } | null}
 */
function normalizePiece(node) {
  if (!node || typeof node !== 'object') return null;
  const id = String(node.id || node.traitId || '').trim();
  if (!id) return null;
  let confidence = Number(node.confidence);
  if (!Number.isFinite(confidence)) {
    const percent = Number(node.confidencePercent);
    confidence = Number.isFinite(percent) ? percent / 100 : 0;
  }
  confidence = Math.max(0, Math.min(1, confidence));
  const layer = node.layer === 'emerging' ? 'emerging' : 'confirmed';
  return { id, confidence, layer };
}

/**
 * @param {object[]} nodes
 * @returns {Record<string, { confidence: number, layer: string }>}
 */
export function serializeSeenPieces(nodes) {
  /** @type {Record<string, { confidence: number, layer: string }>} */
  const map = {};
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const piece = normalizePiece(node);
    if (!piece) continue;
    map[piece.id] = { confidence: piece.confidence, layer: piece.layer };
  }
  return map;
}

/**
 * @param {string|undefined|null} userId
 * @returns {Record<string, { confidence: number, layer: string }> | null}
 */
export function loadSeenIdentityPieces(userId) {
  const storage = getStorage();
  if (!userId || !storage) return null;
  try {
    const raw = storage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    /** @type {Record<string, { confidence: number, layer: string }>} */
    const map = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const confidence = Number(value.confidence);
      if (!Number.isFinite(confidence)) continue;
      const layer = value.layer === 'emerging' ? 'emerging' : 'confirmed';
      map[String(id)] = {
        confidence: Math.max(0, Math.min(1, confidence)),
        layer,
      };
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * @param {string|undefined|null} userId
 * @param {object[]} nodes
 */
export function saveSeenIdentityPieces(userId, nodes) {
  const storage = getStorage();
  if (!userId || !storage) return;
  try {
    storage.setItem(storageKey(userId), JSON.stringify(serializeSeenPieces(nodes)));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/**
 * @param {object[]} nodes
 * @param {Record<string, { confidence: number, layer: string }> | null} baseline
 * @returns {string[]}
 */
export function diffChangedTraitIds(nodes, baseline) {
  if (!baseline || typeof baseline !== 'object') return [];
  const current = serializeSeenPieces(nodes);
  /** @type {string[]} */
  const changed = [];
  for (const [id, piece] of Object.entries(current)) {
    const prev = baseline[id];
    if (!prev) {
      changed.push(id);
      continue;
    }
    if (prev.layer !== piece.layer) {
      changed.push(id);
      continue;
    }
    if (Math.abs(piece.confidence - prev.confidence) >= MIN_CONFIDENCE_DELTA) {
      changed.push(id);
    }
  }
  return changed;
}

function cancelScheduledVisitEnd() {
  if (stickyEndTimer != null) {
    clearTimeout(stickyEndTimer);
    stickyEndTimer = null;
  }
}

/**
 * Sync glow ids for the current page visit without writing the seen baseline yet.
 * Re-diffs whenever nodes refresh so post-navigation identity updates light up immediately.
 *
 * @param {string|undefined|null} userId
 * @param {object[]} nodes
 * @returns {string[]}
 */
export function syncTraitChangeHighlights(userId, nodes) {
  const id = String(userId || '').trim();
  if (!id || !Array.isArray(nodes) || nodes.length === 0) return [];

  cancelScheduledVisitEnd();

  if (!stickyVisit || stickyVisit.userId !== id) {
    stickyVisit = {
      userId: id,
      baseline: loadSeenIdentityPieces(id),
      latestNodes: nodes,
      changedIds: [],
    };
  } else {
    stickyVisit.latestNodes = nodes;
  }

  stickyVisit.changedIds = diffChangedTraitIds(nodes, stickyVisit.baseline);
  return stickyVisit.changedIds;
}

/**
 * Persist the latest nodes seen this visit as the new baseline (next open = no glow).
 *
 * @param {string|undefined|null} userId
 */
export function acknowledgeTraitHighlightsVisit(userId) {
  cancelScheduledVisitEnd();
  const id = String(userId || '').trim();
  if (!id || !stickyVisit || stickyVisit.userId !== id) return;
  if (Array.isArray(stickyVisit.latestNodes) && stickyVisit.latestNodes.length > 0) {
    saveSeenIdentityPieces(id, stickyVisit.latestNodes);
  }
  stickyVisit = null;
}

/** Clear in-memory visit state without writing baseline. */
export function clearStickyTraitHighlights() {
  cancelScheduledVisitEnd();
  stickyVisit = null;
}

/**
 * End the visit after a tick (Strict Mode remount can cancel via syncTraitChangeHighlights).
 * Writes the seen baseline so the next navigation/reload starts clean.
 *
 * @param {string|undefined|null} userId
 */
export function scheduleEndTraitHighlightsVisit(userId) {
  const id = String(userId || '').trim();
  if (!id) return;
  cancelScheduledVisitEnd();
  stickyEndTimer = setTimeout(() => {
    stickyEndTimer = null;
    acknowledgeTraitHighlightsVisit(id);
  }, 0);
}

/** Remove all seen-piece baselines (login/logout hygiene). */
export function clearAllSeenIdentityPieces() {
  clearStickyTraitHighlights();
  const storage = getStorage();
  if (!storage) return;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    /* ignore */
  }
}

export const IDENTITY_TRAIT_HIGHLIGHT_MIN_CONFIDENCE_DELTA = MIN_CONFIDENCE_DELTA;
