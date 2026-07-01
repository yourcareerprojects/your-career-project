/**
 * In-process cache for GET /api/profile JSON responses.
 * Keyed by user id + User.updatedAt so any profile write invalidates automatically (Mongoose timestamps).
 */

const cache = new Map();

function normalizeProfileCacheLang(lang) {
  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  return code === 'de' ? 'de' : 'en';
}

function toUpdatedAtMs(updatedAt) {
  return updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt || 0).getTime();
}

function cacheKey(userId, updatedAt, lang) {
  const id = String(userId);
  const ms = toUpdatedAtMs(updatedAt);
  return `${id}:${ms}:${normalizeProfileCacheLang(lang)}`;
}

/** Drop cached profile JSON for other `updatedAt` snapshots so old versions do not pile up. */
function evictStaleProfileVersionsForUser(userId, currentUpdatedAtMs) {
  const prefix = `${String(userId)}:`;
  const keepPrefix = `${String(userId)}:${currentUpdatedAtMs}:`;
  for (const k of [...cache.keys()]) {
    if (!k.startsWith(prefix)) continue;
    if (!k.startsWith(keepPrefix)) cache.delete(k);
  }
}

/**
 * @param {import('mongoose').Types.ObjectId|string} userId
 * @param {Date|undefined} updatedAt
 * @returns {object|undefined} Cached body for res.json(...)
 */
function getCachedProfileResponse(userId, updatedAt, lang = 'en') {
  if (process.env.DISABLE_PROFILE_GET_CACHE === '1') return undefined;
  return cache.get(cacheKey(userId, updatedAt, lang));
}

/**
 * @param {import('mongoose').Types.ObjectId|string} userId
 * @param {Date|undefined} updatedAt
 * @param {object} body Same object passed to res.json (will be structuredClone'd upstream)
 * @param {string} [lang='en'] Request locale (responses include localized flattened fields).
 */
function setCachedProfileResponse(userId, updatedAt, body, lang = 'en') {
  if (process.env.DISABLE_PROFILE_GET_CACHE === '1') return;
  evictStaleProfileVersionsForUser(userId, toUpdatedAtMs(updatedAt));
  cache.set(cacheKey(userId, updatedAt, lang), body);
}

function evictProfileResponseCacheForUser(userId) {
  const prefix = `${String(userId)}:`;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

/** For tests or admin tooling */
function clearProfileResponseCache() {
  cache.clear();
}

module.exports = {
  getCachedProfileResponse,
  setCachedProfileResponse,
  clearProfileResponseCache,
  evictProfileResponseCacheForUser,
};
