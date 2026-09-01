import { useMutation, useQuery } from 'react-query';
import { queryClient } from '../queryClient';
import { baseUILanguage } from './useProfileQueries';
import {
  fetchExplorationSessionById,
  fetchLatestExplorationSession,
  markExplorationSessionSeen,
} from '../utils/identityExplorationWatcher';

export const careerIdentityQueryKey = ['career-identity'];
export const careerIdentityExplorationLatestKey = ['career-identity', 'exploration', 'latest'];

/** How long to aggressively poll after an identity-affecting profile/activity write. */
export const EXPLORATION_ACTIVITY_WATCH_MS = 120_000;

/** @type {number} */
let explorationActivityWatchUntil = 0;

export function getCareerIdentityQueryKeyFull(lang) {
  const resolved =
    lang != null && String(lang).trim() !== ''
      ? String(lang).toLowerCase().split('-')[0]
      : baseUILanguage();
  return [...careerIdentityQueryKey, resolved];
}

export function isWatchingExplorationAfterActivity() {
  return Date.now() < explorationActivityWatchUntil;
}

export function clearExplorationActivityWatch() {
  explorationActivityWatchUntil = 0;
}

/**
 * After profile (or similar) writes that schedule exploration, keep polling.
 * Only show the indeterminate "Updating…" state when the user was already
 * close to unlock — otherwise a brief pipeline run looks like "loading new
 * roles" and then snaps back to a low/0% bar.
 */
export function watchExplorationAfterIdentityActivity() {
  explorationActivityWatchUntil = Date.now() + EXPLORATION_ACTIVITY_WATCH_MS;
  queryClient.setQueryData(getCareerIdentityQueryKeyFull(), (prev) => {
    if (!prev?.explorationProgress?.hasBaseline) return prev;
    if (prev.explorationNotification?.hasUnreadExploration) return prev;
    const phase = prev.explorationProgress.phase;
    const percent = Math.max(0, Number(prev.explorationProgress.progressPercent) || 0);
    const nearUnlock =
      phase === 'ready'
      || phase === 'preparing'
      || phase === 'delivered'
      || percent >= 80;
    if (!nearUnlock) return prev;
    return {
      ...prev,
      explorationProgress: {
        ...prev.explorationProgress,
        activityPending: true,
      },
    };
  });
}

/** Flip the progress card to 100% / preparing as soon as the unlock threshold is crossed. */
export function applyExplorationPreparingHint(payload = {}) {
  clearExplorationActivityWatch();
  queryClient.setQueryData(getCareerIdentityQueryKeyFull(), (prev) => {
    if (!prev?.explorationProgress?.hasBaseline) return prev;
    if (prev.explorationNotification?.hasUnreadExploration) return prev;
    const threshold = Number(prev.explorationProgress.threshold) || 5;
    const changeScore = Number(payload.changeScore);
    const nextScore = Number.isFinite(changeScore) && changeScore > 0
      ? changeScore
      : Math.max(Number(prev.explorationProgress.changeScore) || 0, threshold);
    return {
      ...prev,
      explorationProgress: {
        ...prev.explorationProgress,
        phase: 'ready',
        changeScore: nextScore,
        cappedChangeScore: threshold,
        progressPercent: 100,
        remainingScore: 0,
        isReady: true,
        activityPending: false,
      },
    };
  });
  queryClient.invalidateQueries(careerIdentityExplorationLatestKey);
}

export function invalidateCareerIdentityQueries(options = {}) {
  if (options.watchExploration) {
    watchExplorationAfterIdentityActivity();
  }
  queryClient.invalidateQueries(careerIdentityQueryKey);
  queryClient.invalidateQueries(careerIdentityExplorationLatestKey);
}

function authHeaders() {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Request failed');
  }
  return data;
}

export async function fetchCareerIdentity() {
  const lang = baseUILanguage();
  const response = await fetch(`/api/career-identity?lang=${encodeURIComponent(lang)}`, {
    headers: authHeaders(),
  });
  const data = await parseJson(response);
  return data.identity;
}

export async function fetchIdentityTraitDetail(traitId) {
  const lang = baseUILanguage();
  const response = await fetch(
    `/api/career-identity/traits/${encodeURIComponent(traitId)}?lang=${encodeURIComponent(lang)}`,
    { headers: authHeaders() }
  );
  const data = await parseJson(response);
  return data.trait;
}

export async function voteOnIdentityTrait({ traitId, vote }) {
  const lang = baseUILanguage();
  const response = await fetch(
    `/api/career-identity/traits/${encodeURIComponent(traitId)}/vote?lang=${encodeURIComponent(lang)}`,
    {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ vote }),
    }
  );
  const data = await parseJson(response);
  return data.identity;
}

export function useCareerIdentityQuery(options = {}) {
  const { enabled = true } = options;
  const lang = baseUILanguage();
  return useQuery(getCareerIdentityQueryKeyFull(lang), fetchCareerIdentity, {
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useIdentityTraitDetailQuery(traitId, options = {}) {
  const { enabled = true } = options;
  return useQuery(
    ['career-identity', 'trait', traitId, baseUILanguage()],
    () => fetchIdentityTraitDetail(traitId),
    {
      enabled: Boolean(traitId) && enabled,
      staleTime: 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );
}

export function useLatestExplorationQuery(options = {}) {
  const { enabled = true } = options;
  return useQuery(careerIdentityExplorationLatestKey, fetchLatestExplorationSession, {
    enabled,
    staleTime: 30 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useExplorationSessionQuery(sessionId, options = {}) {
  const { enabled = true } = options;
  return useQuery(
    ['career-identity', 'exploration', sessionId],
    () => fetchExplorationSessionById(sessionId),
    {
      enabled: Boolean(sessionId) && enabled,
      staleTime: 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );
}

function applyExplorationConsumedToIdentityCache(prev) {
  if (!prev) return prev;
  const threshold = Number(prev.explorationProgress?.threshold) || 5;
  return {
    ...prev,
    explorationNotification: {
      hasUnreadExploration: false,
      sessionId: null,
      jobCount: 0,
      status: prev.explorationNotification?.status || null,
    },
    explorationProgress: prev.explorationProgress
      ? {
          ...prev.explorationProgress,
          phase: 'accumulating',
          changeScore: 0,
          cappedChangeScore: 0,
          progressPercent: 0,
          remainingScore: threshold,
          isReady: false,
          reasons: [],
          activityPending: false,
          latestSessionStatus: prev.explorationProgress.latestSessionStatus,
        }
      : prev.explorationProgress,
  };
}

function applyExplorationConsumedToLatestCache(prev) {
  if (!prev || typeof prev !== 'object') return prev;
  return {
    ...prev,
    hasUnreadExploration: false,
  };
}

/** Instantly leave Discover / 100% in the React Query cache (before /seen returns). */
export function optimisticallyConsumeExplorationProgress() {
  queryClient.setQueryData(
    getCareerIdentityQueryKeyFull(),
    applyExplorationConsumedToIdentityCache
  );
  queryClient.setQueryData(
    careerIdentityExplorationLatestKey,
    applyExplorationConsumedToLatestCache
  );
}

export function useMarkExplorationSeenMutation() {
  return useMutation(markExplorationSessionSeen, {
    onMutate: async (sessionId) => {
      const identityKey = getCareerIdentityQueryKeyFull();
      const previousIdentity = queryClient.getQueryData(identityKey);
      const previousLatest = queryClient.getQueryData(careerIdentityExplorationLatestKey);

      // Apply optimistic reset immediately so the progress card snaps back.
      optimisticallyConsumeExplorationProgress();

      return { previousIdentity, previousLatest, identityKey, sessionId };
    },
    onError: (_err, _sessionId, context) => {
      if (!context) return;
      if (context.previousIdentity !== undefined) {
        queryClient.setQueryData(context.identityKey, context.previousIdentity);
      }
      if (context.previousLatest !== undefined) {
        queryClient.setQueryData(careerIdentityExplorationLatestKey, context.previousLatest);
      }
    },
    onSuccess: (_data, sessionId) => {
      optimisticallyConsumeExplorationProgress();
      invalidateCareerIdentityQueries();
      if (sessionId) {
        queryClient.invalidateQueries(['career-identity', 'exploration', sessionId]);
      }
    },
  });
}

export function useVoteIdentityTraitMutation() {
  return useMutation(voteOnIdentityTrait, {
    onMutate: async ({ traitId, vote }) => {
      const key = getCareerIdentityQueryKeyFull();
      await queryClient.cancelQueries(key);
      const previous = queryClient.getQueryData(key);
      if (previous?.nodes) {
        const normalizedVote = vote == null || vote === '' ? null : vote;
        queryClient.setQueryData(key, {
          ...previous,
          nodes: previous.nodes.map((node) =>
            node.id === traitId
              ? { ...node, userVote: normalizedVote }
              : node
          ),
        });
      }
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && context?.key) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSuccess: (identity) => {
      queryClient.setQueryData(getCareerIdentityQueryKeyFull(), identity);
      queryClient.invalidateQueries(['career-identity', 'trait']);
      // Puzzle recompute kicks off an async exploration pipeline — keep UI fresh.
      invalidateCareerIdentityQueries({ watchExploration: true });
    },
  });
}
