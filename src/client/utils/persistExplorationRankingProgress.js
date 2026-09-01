/**
 * Server persistence for mid-flow Discover ranking (pause/resume).
 * Mirrors persistLastSimulationProgress for identity exploration sessions.
 */

import { queryClient } from '../queryClient';

const DEBOUNCE_MS = 450;
const EXPLORATION_LATEST_KEY = ['career-identity', 'exploration', 'latest'];

let debounceTimer = null;
let pending = null; // { sessionId, rankingProgress }
let inFlightPromise = null;

export async function persistExplorationRankingProgress(sessionId, rankingProgress) {
  const token = localStorage.getItem('token');
  if (!token || !sessionId || !rankingProgress || typeof rankingProgress !== 'object') {
    return null;
  }

  const res = await fetch(
    `/api/career-identity/exploration/${encodeURIComponent(sessionId)}/ranking`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rankingProgress }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.message || data.error || 'Failed to persist exploration ranking progress');
  }

  const session = data.session || null;
  if (session) {
    queryClient.setQueryData(['career-identity', 'exploration', sessionId], session);
    queryClient.setQueryData(EXPLORATION_LATEST_KEY, (prev) => {
      if (!prev || typeof prev !== 'object') {
        return {
          session,
          hasUnreadExploration: Boolean(data.hasUnreadExploration),
        };
      }
      const prevId = String(prev.session?._id || prev.session?.id || '');
      if (prevId && prevId !== String(sessionId)) return prev;
      return {
        ...prev,
        session: {
          ...(prev.session || {}),
          ...session,
        },
        hasUnreadExploration:
          data.hasUnreadExploration != null
            ? Boolean(data.hasUnreadExploration)
            : prev.hasUnreadExploration,
      };
    });
  }

  return data;
}

function flushPending() {
  const next = pending;
  pending = null;
  if (!next?.sessionId || !next.rankingProgress) return Promise.resolve(null);

  const run = () =>
    persistExplorationRankingProgress(next.sessionId, next.rankingProgress);

  if (inFlightPromise) {
    inFlightPromise = inFlightPromise.catch(() => null).then(run);
  } else {
    inFlightPromise = run();
  }

  const current = inFlightPromise;
  inFlightPromise = current.finally(() => {
    if (inFlightPromise === current) {
      inFlightPromise = null;
    }
  });
  return inFlightPromise.catch((error) => {
    console.warn('Failed to persist exploration ranking progress:', error);
    return null;
  });
}

/**
 * Debounced PUT of Discover ranking progress for a session.
 * @param {string} sessionId
 * @param {object} rankingProgress
 */
export function schedulePersistExplorationRankingProgress(sessionId, rankingProgress) {
  if (!sessionId || !rankingProgress || typeof rankingProgress !== 'object') return;
  pending = { sessionId: String(sessionId), rankingProgress };
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flushPending();
  }, DEBOUNCE_MS);
}

/** Flush any debounced exploration ranking progress (e.g. before close / tab unload). */
export function flushPersistExplorationRankingProgress() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
  return flushPending();
}

/** Drop pending drafts (e.g. after Done / mark-seen — server clears rankingProgress). */
export function cancelPersistExplorationRankingProgress() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
  pending = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (!pending?.sessionId || !pending.rankingProgress) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const body = JSON.stringify({ rankingProgress: pending.rankingProgress });
      fetch(
        `/api/career-identity/exploration/${encodeURIComponent(pending.sessionId)}/ranking`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body,
          keepalive: true,
        }
      );
      pending = null;
    } catch {
      /* ignore */
    }
  });
}
