/** Manual profile fill (no CV): persisted in localStorage so users can resume after leaving. */
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'manualFillDraft:';

function draftKey(userId) {
  return `${STORAGE_PREFIX}${String(userId || 'anon')}`;
}

function getStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage || null;
}

/**
 * @param {string|undefined|null} userId
 * @param {object} draft
 */
function saveManualFillDraft(userId, draft) {
  const storage = getStorage();
  if (!userId || !storage) return;
  try {
    storage.setItem(
      draftKey(userId),
      JSON.stringify({
        ...draft,
        savedAt: Date.now(),
      })
    );
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/**
 * @param {string|undefined|null} userId
 * @returns {object|null}
 */
function loadManualFillDraft(userId) {
  const storage = getStorage();
  if (!userId || !storage) return null;
  try {
    const raw = storage.getItem(draftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.savedAt || Date.now() - Number(parsed.savedAt) > DRAFT_TTL_MS) {
      clearManualFillDraft(userId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {string|undefined|null} userId
 */
function clearManualFillDraft(userId) {
  const storage = getStorage();
  if (!userId || !storage) return;
  try {
    storage.removeItem(draftKey(userId));
  } catch {
    /* ignore */
  }
}

/** Remove every persisted manual-fill draft (bulk cleanup; drafts survive logout). */
function clearAllManualFillDrafts() {
  const storage = getStorage();
  if (!storage) return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch {
    /* ignore */
  }
}

module.exports = {
  DRAFT_TTL_MS,
  saveManualFillDraft,
  loadManualFillDraft,
  clearManualFillDraft,
  clearAllManualFillDrafts,
};
