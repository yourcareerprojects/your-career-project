const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'cvReviewDraft:';

function draftKey(userId) {
  return `${STORAGE_PREFIX}${String(userId || 'anon')}`;
}

/**
 * @param {string|undefined|null} userId
 * @param {object} draft
 */
function saveCvReviewDraft(userId, draft) {
  if (!userId || typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(
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
function loadCvReviewDraft(userId) {
  if (!userId || typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.savedAt || Date.now() - Number(parsed.savedAt) > DRAFT_TTL_MS) {
      clearCvReviewDraft(userId);
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
function clearCvReviewDraft(userId) {
  if (!userId || typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(draftKey(userId));
  } catch {
    /* ignore */
  }
}

/** Remove every persisted CV review draft (e.g. on logout so flows do not resume unexpectedly). */
function clearAllCvReviewDrafts() {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

module.exports = {
  saveCvReviewDraft,
  loadCvReviewDraft,
  clearCvReviewDraft,
  clearAllCvReviewDrafts,
};
