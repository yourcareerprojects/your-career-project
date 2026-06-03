const {
  inputQualityDiagnosisSessionCacheKey,
} = require('../../utils/inputQualityDiagnosisFingerprint');

/** Session TTL for in-memory diagnosis cache (per user + content fingerprint). */
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 150;

/** @type {Map<string, { followUps: object[], expiresAt: number }>} */
const cache = new Map();

function pruneExpiredAndCapSize() {
  const now = Date.now();
  for (const [key, row] of cache) {
    if (!row || row.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/**
 * @param {string|undefined|null} userId
 * @param {{ userIdentity?: object, structuredUserInfo?: object }} snapshot
 * @param {string} lang
 * @returns {{ followUps: object[] } | null}
 */
function getCachedProfileReviewDiagnosis(userId, snapshot, lang) {
  pruneExpiredAndCapSize();
  const key = inputQualityDiagnosisSessionCacheKey(userId, snapshot, lang);
  const row = cache.get(key);
  if (!row || row.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  if (!Array.isArray(row.followUps) || row.followUps.length === 0) return null;
  return { followUps: row.followUps };
}

/**
 * @param {string|undefined|null} userId
 * @param {{ userIdentity?: object, structuredUserInfo?: object }} snapshot
 * @param {string} lang
 * @param {{ followUps: object[] }} result
 */
function setCachedProfileReviewDiagnosis(userId, snapshot, lang, result) {
  if (!result || !Array.isArray(result.followUps) || result.followUps.length === 0) return;
  pruneExpiredAndCapSize();
  const key = inputQualityDiagnosisSessionCacheKey(userId, snapshot, lang);
  cache.set(key, {
    followUps: result.followUps,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

/** Test-only: clear in-memory cache. */
function clearInputQualityDiagnosisSessionCache() {
  cache.clear();
}

module.exports = {
  SESSION_TTL_MS,
  getCachedProfileReviewDiagnosis,
  setCachedProfileReviewDiagnosis,
  clearInputQualityDiagnosisSessionCache,
};
