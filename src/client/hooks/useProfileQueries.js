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
/** Chronological History timeline (GET /api/profile/history). */
export const userHistoryQueryKey = ['profile', 'history'];
/** Persisted career path plans, one per role escoId (GET /api/profile/career-path-plans). */
export const careerPathPlansQueryKey = ['profile', 'career-path-plans', 'list'];

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

export async function fetchCareerPathPlans() {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Not authenticated');
  }
  const response = await fetch('/api/profile/career-path-plans', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error('Failed to fetch career path plans');
  }
  const data = await response.json();
  return Array.isArray(data.careerPathPlans) ? data.careerPathPlans : [];
}

/** All persisted career path plans for the user (one per role escoId). */
export function useCareerPathPlansQuery(options = {}) {
  const { enabled = true } = options;
  return useQuery(careerPathPlansQueryKey, fetchCareerPathPlans, {
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false
  });
}

export async function fetchUserHistory() {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Not authenticated');
  }
  const lang = baseUILanguage();
  const response = await fetch(`/api/profile/history?lang=${encodeURIComponent(lang)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch history');
  }
  return response.json();
}

export function useUserHistoryQuery(options = {}) {
  const { enabled = true } = options;
  const lang = baseUILanguage();
  return useQuery([...userHistoryQueryKey, lang], fetchUserHistory, {
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function invalidateUserHistoryQuery() {
  return queryClient.invalidateQueries(userHistoryQueryKey);
}

/** @param {unknown} data – array or function `(prev) => next` */
export function setCareerPathPlansQueryData(data) {
  queryClient.setQueryData(careerPathPlansQueryKey, data);
}

export function invalidateCareerPathPlansQuery() {
  return queryClient.invalidateQueries(careerPathPlansQueryKey);
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

/**
 * Keep React Query in sync when ranking progress is written to the server/session.
 * Patches every language variant of the last-simulation query so gated UI (e.g. discovery
 * card) unlocks without a full page reload.
 * @param {object | null | undefined} evaluationFlow
 */
export function patchLastSimulationQueryEvaluationFlow(evaluationFlow) {
  if (!evaluationFlow || typeof evaluationFlow !== 'object') return;

  for (const lang of SUPPORTED_PROFILE_CACHE_LANGS) {
    const key = [...lastSimulationQueryKey, lang];
    queryClient.setQueryData(key, (prev) => {
      if (!prev || typeof prev !== 'object') return prev;
      const prevResults = prev.results && typeof prev.results === 'object'
        ? prev.results
        : {};
      return {
        ...prev,
        results: {
          ...prevResults,
          evaluationFlow,
        },
      };
    });
  }
}

export function invalidateSavedSimulationsListQuery() {
  return queryClient.invalidateQueries(savedSimulationsListQueryKey);
}

export function invalidateFullProfileQuery() {
  return queryClient.invalidateQueries(profileFullQueryKey);
}

export function clearAppQueryCache() {
  queryClient.clear();
}
