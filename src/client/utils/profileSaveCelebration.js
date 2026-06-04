/** sessionStorage key set before navigating to /profile after review save */
const STORAGE_KEY = 'profileSaveCelebration';

/** Ignore stale markers (e.g. abandoned save, back button). */
const MAX_AGE_MS = 120_000;

function markProfileSaveCelebration() {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* private mode / quota */
  }
}

/**
 * True when navigation state or a recent session marker requests confetti.
 * Consumes the session marker so celebration runs at most once per save.
 */
function shouldCelebrateProfileSave(locationState) {
  if (locationState?.celebrateProfileSaved || locationState?.celebrateProfileCreated) {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return true;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(STORAGE_KEY);
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts <= MAX_AGE_MS;
  } catch {
    return false;
  }
}

module.exports = {
  markProfileSaveCelebration,
  shouldCelebrateProfileSave,
};
