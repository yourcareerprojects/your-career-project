/**
 * In-memory prefetch cache for career context enrichment.
 * Started when the questionnaire loads; consumed when the user submits answers.
 */

const { buildCareerContext } = require('./careerContextBuilder');
const { enrichCareerContext } = require('./careerKnowledgeEnrichmentService');

const PREFETCH_TTL_MS = 30 * 60 * 1000;

/** @type {Map<string, { enrichedContext: object, expiresAt: number }>} */
const cacheByKey = new Map();

/** @type {Map<string, Promise<object>>} */
const inflightByKey = new Map();

function normalizeLang(lang) {
  return String(lang || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
}

/**
 * @param {object} role
 * @returns {string}
 */
function normalizeRoleKey(role) {
  const esco = String(role?.escoId || '').trim().toLowerCase();
  if (esco) return `esco:${esco}`;
  const careerPathId = String(role?.careerPathId || role?._id || '').trim();
  if (careerPathId) return `cp:${careerPathId}`;
  const title = String(role?.title || role?.name || '').trim().toLowerCase();
  return title ? `title:${title.slice(0, 200)}` : 'unknown';
}

/**
 * @param {string|number|null|undefined} userId
 * @param {object} role
 * @param {string} lang
 * @returns {string|null}
 */
function buildPrefetchKey(userId, role, lang) {
  if (userId == null || userId === '') return null;
  return `${String(userId)}:${normalizeRoleKey(role)}:${normalizeLang(lang)}`;
}

/**
 * @param {string} key
 * @returns {object|null}
 */
function readCachedEnrichedContext(key) {
  const entry = cacheByKey.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cacheByKey.delete(key);
    return null;
  }
  return entry.enrichedContext;
}

/**
 * @param {string} key
 * @param {object} enrichedContext
 */
function storeCachedEnrichedContext(key, enrichedContext) {
  cacheByKey.set(key, {
    enrichedContext,
    expiresAt: Date.now() + PREFETCH_TTL_MS,
  });
}

/**
 * @param {{
 *   userId: string|number,
 *   role: object,
 *   lang?: string,
 *   buildContext?: Function,
 *   enrichContext?: Function,
 * }} params
 * @returns {Promise<object>}
 */
async function runPrefetch({
  userId,
  role,
  lang,
  buildContext = buildCareerContext,
  enrichContext = enrichCareerContext,
}) {
  const key = buildPrefetchKey(userId, role, lang);
  if (!key) {
    throw new Error('userId is required for career path enrichment prefetch');
  }

  const cached = readCachedEnrichedContext(key);
  if (cached) return cached;

  const baseContext = await buildContext({ role, lang });
  const enrichedContext = await enrichContext({
    careerContext: baseContext,
    lang,
  });
  storeCachedEnrichedContext(key, enrichedContext);
  return enrichedContext;
}

/**
 * Start enrichment prefetch without blocking the HTTP response.
 * @returns {'cached' | 'inflight' | 'started'}
 */
function scheduleCareerPathEnrichmentPrefetch(params) {
  const key = buildPrefetchKey(params.userId, params.role, params.lang);
  if (!key) return 'started';

  if (readCachedEnrichedContext(key)) return 'cached';
  if (inflightByKey.has(key)) return 'inflight';

  const pending = runPrefetch(params)
    .catch((err) => {
      console.warn('[careerPathEnrichmentPrefetch] prefetch failed:', err?.message || err);
      return null;
    })
    .finally(() => {
      if (inflightByKey.get(key) === pending) {
        inflightByKey.delete(key);
      }
    });

  inflightByKey.set(key, pending);
  return 'started';
}

/**
 * Resolve enriched career context for plan generation, reusing prefetch when available.
 * @param {{
 *   userId?: string|number|null,
 *   role: object,
 *   lang?: string,
 *   buildContext?: Function,
 *   enrichContext?: Function,
 *   skipEnrichment?: boolean,
 * }} params
 * @returns {Promise<object>}
 */
async function resolveCareerContextWithPrefetch({
  userId,
  role,
  lang,
  buildContext = buildCareerContext,
  enrichContext = enrichCareerContext,
  skipEnrichment = false,
}) {
  if (skipEnrichment) {
    return buildContext({ role, lang });
  }

  const key = userId != null ? buildPrefetchKey(userId, role, lang) : null;

  if (key) {
    const cached = readCachedEnrichedContext(key);
    if (cached) return cached;

    const inflight = inflightByKey.get(key);
    if (inflight) {
      const resolved = await inflight;
      if (resolved) return resolved;
    }
  }

  const baseContext = await buildContext({ role, lang });
  const enrichedContext = await enrichContext({
    careerContext: baseContext,
    lang,
  });

  if (key) {
    storeCachedEnrichedContext(key, enrichedContext);
  }

  return enrichedContext;
}

/** Test helper — clear module state between tests. */
function _resetPrefetchCacheForTests() {
  cacheByKey.clear();
  inflightByKey.clear();
}

module.exports = {
  PREFETCH_TTL_MS,
  buildPrefetchKey,
  scheduleCareerPathEnrichmentPrefetch,
  resolveCareerContextWithPrefetch,
  _resetPrefetchCacheForTests,
  _cacheByKey: cacheByKey,
  _inflightByKey: inflightByKey,
};
