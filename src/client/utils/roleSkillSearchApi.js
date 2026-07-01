import { getProfileApiLangQuery } from './profileApiLangQuery';

const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const searchResultCache = new Map();
const inflightSearches = new Map();

function buildSearchCacheKey({ query, contextTexts, langQuery }) {
  return JSON.stringify({
    query: String(query || ''),
    contextTexts: (Array.isArray(contextTexts) ? contextTexts : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
    langQuery: String(langQuery || ''),
  });
}

function readSearchCache(cacheKey) {
  const entry = searchResultCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.at > SEARCH_CACHE_TTL_MS) {
    searchResultCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function writeSearchCache(cacheKey, data) {
  searchResultCache.set(cacheKey, { at: Date.now(), data });
  if (searchResultCache.size > 40) {
    const oldestKey = searchResultCache.keys().next().value;
    if (oldestKey) searchResultCache.delete(oldestKey);
  }
}

/**
 * Search or recommend role skills for the profile picker.
 * Results are cached briefly to avoid duplicate requests across steps/dialog opens.
 */
export async function postRoleSkillSearch({
  token,
  query,
  contextTexts,
  selectedLabels,
  cache = true,
}) {
  const langQuery = getProfileApiLangQuery();
  const cacheKey = buildSearchCacheKey({
    query,
    contextTexts,
    langQuery,
  });
  if (cache) {
    const cached = readSearchCache(cacheKey);
    if (cached) return cached;
  }

  const inflight = inflightSearches.get(cacheKey);
  if (inflight) return inflight;

  const requestPromise = (async () => {
    const res = await fetch(`/api/profile/role-skills/search?${langQuery}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        query: query || '',
        contextTexts: Array.isArray(contextTexts) ? contextTexts : [],
        selectedLabels: Array.isArray(selectedLabels) ? selectedLabels : [],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.details || 'Failed to load skills');
      err.status = res.status;
      throw err;
    }
    const result = {
      mode: data.mode === 'search' ? 'search' : 'recommendations',
      requiredSkills: Array.isArray(data.requiredSkills) ? data.requiredSkills : [],
      optionalSkills: Array.isArray(data.optionalSkills) ? data.optionalSkills : [],
    };
    if (cache) writeSearchCache(cacheKey, result);
    return result;
  })().finally(() => {
    inflightSearches.delete(cacheKey);
  });

  inflightSearches.set(cacheKey, requestPromise);
  return requestPromise;
}

export function peekRoleSkillSearchCache({ query, contextTexts }) {
  const langQuery = getProfileApiLangQuery();
  const cacheKey = buildSearchCacheKey({ query, contextTexts, langQuery });
  return readSearchCache(cacheKey);
}

export function peekRoleSkillSearchInflight({ query, contextTexts }) {
  const langQuery = getProfileApiLangQuery();
  const cacheKey = buildSearchCacheKey({ query, contextTexts, langQuery });
  return inflightSearches.get(cacheKey) || null;
}

/** Warm recommendations cache before the user reaches the skills steps. */
export function prefetchRoleSkillRecommendations({
  contextTexts = [],
} = {}) {
  const token = localStorage.getItem('token');
  return postRoleSkillSearch({
    token,
    query: '',
    contextTexts,
    selectedLabels: [],
    cache: true,
  }).catch(() => undefined);
}

export function __clearRoleSkillSearchCacheForTests() {
  searchResultCache.clear();
  inflightSearches.clear();
}

/** Best cached recommendations for display while a contextual fetch is in flight. */
export function peekBestRoleSkillRecommendationsCache(contextTexts = []) {
  const exact = peekRoleSkillSearchCache({ query: '', contextTexts });
  if (exact) return exact;
  if (contextTexts.length > 0) {
    return peekRoleSkillSearchCache({ query: '', contextTexts: [] });
  }
  return null;
}
