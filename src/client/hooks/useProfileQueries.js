import { useQuery } from 'react-query';
import axios from 'axios';
import { queryClient } from '../queryClient';
import i18n, { DEFAULT_UI_LANGUAGE } from '../i18n';

/**
 * Match server `normalizeLanguage` / i18n base code so query key + `?lang=` never split `de` vs `de-DE`.
 * Prefer `i18n.language` — it updates with the user's selection immediately; `resolvedLanguage` can lag
 * while namespaces load, which previously caused GET /api/profile to use the old locale.
 */
export function baseUILanguage() {
  const raw = i18n.language || i18n.resolvedLanguage || DEFAULT_UI_LANGUAGE;
  return String(raw).toLowerCase().split('-')[0] || DEFAULT_UI_LANGUAGE;
}

export const profileCompletionQueryKey = ['profile', 'completion'];
export const lastSimulationQueryKey = ['profile', 'simulation', 'last'];
export const profileFullQueryKey = ['profile', 'full'];
export const PROFILE_QUERY_STALE_TIME_MS = 10 * 60 * 1000;
export const PROFILE_QUERY_CACHE_TIME_MS = 30 * 60 * 1000;
/** List payload for Saved Simulations page + simulation hub drawer (GET /api/profile/simulation/saved). */
export const savedSimulationsListQueryKey = ['profile', 'simulation', 'saved', 'list'];
/** List payload for Saved Career Steps (GET /api/profile/saved-career-steps). */
export const savedCareerStepsListQueryKey = ['profile', 'saved-career-steps', 'list'];

/**
 * Full query key (must match `useSavedCareerStepsListQuery` — last segment is locale).
 * @param {string} [lang] – optional override; defaults to i18n current language
 */
export function getSavedCareerStepsListQueryKeyFull(lang) {
  const resolved = lang != null && String(lang).trim() !== ''
    ? String(lang).toLowerCase().split('-')[0] || DEFAULT_UI_LANGUAGE
    : baseUILanguage();
  return [...savedCareerStepsListQueryKey, resolved];
}

/**
 * Set list cache for the active language (fixes saves “not sticking” and empty saved-steps list).
 * @param {unknown} data – array or function `(prev) => next`
 * @param {string} [lang] – when updating from a callback outside i18n (rare)
 */
export function setSavedCareerStepsListQueryData(data, lang) {
  queryClient.setQueryData(getSavedCareerStepsListQueryKeyFull(lang), data);
}

/** Full profile document (GET /api/profile). Heavy on the server — keep behind React Query + staleTime. */
export function getProfileFullQueryKeyFull(lang) {
  const resolved = lang != null && String(lang).trim() !== ''
    ? String(lang).toLowerCase().split('-')[0] || DEFAULT_UI_LANGUAGE
    : baseUILanguage();
  return [...profileFullQueryKey, resolved];
}

/**
 * Cached full profile payload when present and not invalidated (e.g. review-save seed).
 * @returns {object|null}
 */
export function readFullProfileCacheEntry(lang, queryClientImpl = queryClient) {
  const key = getProfileFullQueryKeyFull(lang);
  const cached = queryClientImpl.getQueryData(key);
  if (!cached || typeof cached !== 'object') return null;
  if (queryClientImpl.getQueryState(key)?.isInvalidated) return null;
  return cached;
}

/** Local Profile page state for first paint — avoids a loading flash when cache is seeded. */
export function getProfilePageStateFromCache(lang, queryClientImpl = queryClient) {
  const cachedProfile = readFullProfileCacheEntry(lang, queryClientImpl);
  if (!cachedProfile) {
    return { profile: null, completion: null, loading: true };
  }
  const completionFromCaches = getProfileCompletionFromCaches(queryClientImpl);
  const completion = cachedProfile.completion || completionFromCaches?.completion || null;
  return { profile: cachedProfile, completion, loading: false };
}

/** Completion embedded in GET /api/profile — reuse before hitting GET /api/profile/completion. */
export function getProfileCompletionFromCaches(queryClientImpl = queryClient) {
  const completionData = queryClientImpl.getQueryData(profileCompletionQueryKey);
  const completionState = queryClientImpl.getQueryState(profileCompletionQueryKey);
  if (completionData?.completion && !completionState?.isInvalidated) {
    return completionData;
  }

  for (const lang of SUPPORTED_PROFILE_CACHE_LANGS) {
    const fullKey = getProfileFullQueryKeyFull(lang);
    const profile = queryClientImpl.getQueryData(fullKey);
    const profileState = queryClientImpl.getQueryState(fullKey);
    if (profile?.completion && !profileState?.isInvalidated) {
      return { success: true, completion: profile.completion };
    }
  }

  return null;
}

const SUPPORTED_PROFILE_CACHE_LANGS = ['en', 'de'];

/** Full profile document (GET /api/profile). Heavy on the server — keep behind React Query + staleTime. */
export async function fetchFullProfile(lang) {
  const resolvedLang = lang != null && String(lang).trim() !== ''
    ? String(lang).toLowerCase().split('-')[0] || DEFAULT_UI_LANGUAGE
    : baseUILanguage();
  const res = await axios.get(`/api/profile?lang=${encodeURIComponent(resolvedLang)}`);
  const data = res.data;
  if (data?.completion) {
    seedProfileCompletionQueryData({ success: true, completion: data.completion });
  }
  return data;
}

/**
 * Always hits GET /api/profile and writes the result into the React Query cache.
 * Use after review-save seeding: fetchQuery would return the fresh partial seed while staleTime is active.
 */
export async function refetchFullProfileIntoCache(lang, queryClientImpl = queryClient) {
  const profileData = await fetchFullProfile(lang);
  queryClientImpl.setQueryData(getProfileFullQueryKeyFull(lang), profileData);
  return profileData;
}

/** @type {Map<string, Promise<object>>} */
const seededFullProfileRefetchInflight = new Map();

export function isReviewSaveProfileSeed(profileData) {
  return Boolean(profileData && typeof profileData === 'object' && profileData._seededFromReviewSave);
}

/**
 * One background GET /api/profile after review-save seeding — deduped per locale.
 * Replaces the partial seed in React Query with the full profile document.
 *
 * @param {string} [lang]
 * @param {{ queryClientImpl?: import('react-query').QueryClient, onUpdated?: (data: object) => void }} [options]
 */
export function refreshSeededFullProfileInBackground(lang, options = {}) {
  const queryClientImpl = options.queryClientImpl || queryClient;
  const resolvedLang = lang != null && String(lang).trim() !== ''
    ? String(lang).toLowerCase().split('-')[0] || DEFAULT_UI_LANGUAGE
    : baseUILanguage();
  const cacheKey = JSON.stringify(getProfileFullQueryKeyFull(resolvedLang));
  const cached = readFullProfileCacheEntry(resolvedLang, queryClientImpl);
  if (!isReviewSaveProfileSeed(cached)) {
    return Promise.resolve(cached);
  }

  const inflight = seededFullProfileRefetchInflight.get(cacheKey);
  if (inflight) {
    if (typeof options.onUpdated === 'function') {
      inflight.then(options.onUpdated).catch(() => {});
    }
    return inflight;
  }

  const promise = refetchFullProfileIntoCache(resolvedLang, queryClientImpl)
    .then((profileData) => {
      if (typeof options.onUpdated === 'function') {
        options.onUpdated(profileData);
      }
      return profileData;
    })
    .finally(() => {
      if (seededFullProfileRefetchInflight.get(cacheKey) === promise) {
        seededFullProfileRefetchInflight.delete(cacheKey);
      }
    });

  seededFullProfileRefetchInflight.set(cacheKey, promise);
  return promise;
}

export function useFullProfileQuery(options = {}) {
  const { enabled = true } = options;
  const lang = baseUILanguage();
  const key = getProfileFullQueryKeyFull(lang);
  return useQuery(key, () => fetchFullProfile(lang), {
    enabled,
    staleTime: PROFILE_QUERY_STALE_TIME_MS,
    cacheTime: PROFILE_QUERY_CACHE_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false
  });
}

export async function fetchProfileCompletion() {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Not authenticated');
  }

  const cachedCompletion = getProfileCompletionFromCaches();
  if (cachedCompletion) {
    return cachedCompletion;
  }

  const lang = baseUILanguage();
  const fullKey = getProfileFullQueryKeyFull(lang);
  const profileState = queryClient.getQueryState(fullKey);
  if (profileState?.fetchStatus === 'fetching') {
    try {
      await queryClient.fetchQuery(fullKey, () => fetchFullProfile(lang), {
        staleTime: PROFILE_QUERY_STALE_TIME_MS,
        cacheTime: PROFILE_QUERY_CACHE_TIME_MS,
      });
      const completionAfterProfile = getProfileCompletionFromCaches();
      if (completionAfterProfile) {
        return completionAfterProfile;
      }
    } catch {
      // Fall through to the lightweight completion endpoint.
    }
  }

  const response = await fetch('/api/profile/completion', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error('Failed to fetch profile completion');
  }
  return response.json();
}

export async function fetchLastSimulation() {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Not authenticated');
  }
  const lang = baseUILanguage();
  const response = await fetch(`/api/profile/simulation/last?lang=${encodeURIComponent(lang)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error('Failed to fetch last simulation');
  }
  return response.json();
}

export async function fetchSavedSimulationsList() {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Not authenticated');
  }
  const lang = baseUILanguage();
  const response = await fetch(`/api/profile/simulation/saved?lang=${encodeURIComponent(lang)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error('Failed to fetch saved simulations');
  }
  const data = await response.json();
  const serverSimulations = Array.isArray(data?.savedSimulations)
    ? data.savedSimulations
    : Array.isArray(data?.simulations)
      ? data.simulations
      : [];
  if (data.success) {
    return serverSimulations;
  }
  return [];
}

export function useProfileCompletionQuery(options = {}) {
  const { enabled = true } = options;
  return useQuery(profileCompletionQueryKey, fetchProfileCompletion, {
    enabled,
    staleTime: PROFILE_QUERY_STALE_TIME_MS,
    cacheTime: PROFILE_QUERY_CACHE_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false
  });
}

export function useLastSimulationQuery(options = {}) {
  const { enabled = true } = options;
  const lang = baseUILanguage();
  return useQuery([...lastSimulationQueryKey, lang], fetchLastSimulation, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });
}

export function useSavedSimulationsListQuery(options = {}) {
  const { enabled = true } = options;
  const lang = baseUILanguage();
  return useQuery([...savedSimulationsListQueryKey, lang], fetchSavedSimulationsList, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });
}

export async function fetchSavedCareerStepsList() {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Not authenticated');
  }
  const lang = baseUILanguage();
  const response = await fetch(`/api/profile/saved-career-steps?lang=${encodeURIComponent(lang)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error('Failed to fetch saved career steps');
  }
  const data = await response.json();
  if (data.success) {
    return Array.isArray(data.savedCareerSteps) ? data.savedCareerSteps : [];
  }
  return [];
}

export function useSavedCareerStepsListQuery(options = {}) {
  const { enabled = true } = options;
  const lang = baseUILanguage();
  return useQuery([...savedCareerStepsListQueryKey, lang], fetchSavedCareerStepsList, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });
}

/** After Profile page loads completion via axios, keep React Query cache in sync. */
export function seedProfileCompletionQueryData(data) {
  if (!data) return;
  queryClient.setQueryData(profileCompletionQueryKey, data);
}

export function invalidateProfileCompletionQuery() {
  return queryClient.invalidateQueries(profileCompletionQueryKey);
}

export function invalidateLastSimulationQuery() {
  return queryClient.invalidateQueries(lastSimulationQueryKey);
}

export function invalidateSavedSimulationsListQuery() {
  return queryClient.invalidateQueries(savedSimulationsListQueryKey);
}

export function invalidateSavedCareerStepsListQuery() {
  return queryClient.invalidateQueries(savedCareerStepsListQueryKey);
}

export function invalidateFullProfileQuery() {
  return queryClient.invalidateQueries(profileFullQueryKey);
}

export function clearAppQueryCache() {
  queryClient.clear();
}
