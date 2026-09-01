/**
 * Watch for async identity exploration completion after a puzzle refresh.
 * Prefers SSE; falls back to exponential-backoff polling of /exploration/latest.
 * Does not poll forever — max wait is bounded.
 */

const DEFAULT_MAX_WAIT_MS = 60 * 1000;
const SSE_SILENCE_FALLBACK_MS = 20 * 1000;

function abortableDelay(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {object} session
 * @returns {boolean}
 */
export function isNotifiableExplorationSession(session) {
  if (!session || session.status !== 'completed') return false;
  return Array.isArray(session.explorationJobs) && session.explorationJobs.length > 0;
}

/**
 * @returns {Promise<{
 *   session: object|null,
 *   hasUnreadExploration: boolean,
 * }>}
 */
export async function fetchLatestExplorationSession() {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Not authenticated');
  const response = await fetch('/api/career-identity/exploration/latest', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to load exploration');
  }
  return {
    session: data.session || null,
    hasUnreadExploration: Boolean(data.hasUnreadExploration),
  };
}

/**
 * @param {string} sessionId
 */
export async function markExplorationSessionSeen(sessionId) {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Not authenticated');
  const response = await fetch(
    `/api/career-identity/exploration/${encodeURIComponent(sessionId)}/seen`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to mark exploration seen');
  }
  return data;
}

/**
 * @param {string} sessionId
 */
export async function fetchExplorationSessionById(sessionId) {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Not authenticated');
  const response = await fetch(
    `/api/career-identity/exploration/${encodeURIComponent(sessionId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to load exploration');
  }
  return data.session || null;
}

/**
 * Wait until a notifiable unread exploration appears, or until timeout/abort.
 *
 * @returns {Promise<
 *   | { kind: 'discovered'; session: object; sessionId: string; jobCount: number }
 *   | { kind: 'timeout' }
 *   | { kind: 'aborted' }
 *   | { kind: 'empty' }
 * >}
 */
export async function waitForIdentityExplorationDiscovery({
  signal,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  knownSessionId = null,
} = {}) {
  const deadlineMs = Date.now() + maxWaitMs;
  const token = localStorage.getItem('token');
  if (!token) return { kind: 'aborted' };

  let settled = false;
  let resolveResult;
  const resultPromise = new Promise((resolve) => {
    resolveResult = resolve;
  });

  const finish = (result) => {
    if (settled) return;
    settled = true;
    resolveResult(result);
  };

  const considerSession = (session, hasUnreadExploration) => {
    if (!hasUnreadExploration && !(session && session.seenAt == null)) return false;
    if (!isNotifiableExplorationSession(session)) return false;
    const sessionId = String(session._id || session.id || '');
    if (!sessionId) return false;
    if (knownSessionId && sessionId === String(knownSessionId) && session.seenAt != null) {
      return false;
    }
    finish({
      kind: 'discovered',
      session,
      sessionId,
      jobCount: session.explorationJobs.length,
    });
    return true;
  };

  async function pollOnce() {
    const { session, hasUnreadExploration } = await fetchLatestExplorationSession();
    return considerSession(session, hasUnreadExploration);
  }

  async function pollLoop() {
    let intervalMs = 1000;
    const maxIntervalMs = 5000;
    while (!settled && Date.now() < deadlineMs) {
      if (signal?.aborted) {
        finish({ kind: 'aborted' });
        return;
      }
      try {
        const found = await pollOnce();
        if (found) return;
      } catch {
        /* best-effort */
      }
      try {
        await abortableDelay(intervalMs, signal);
      } catch {
        finish({ kind: 'aborted' });
        return;
      }
      intervalMs = Math.min(maxIntervalMs, Math.round(intervalMs * 1.6));
    }
    if (!settled) finish({ kind: 'timeout' });
  }

  let es = null;
  let silenceTimer = null;
  let fallbackStarted = false;

  const startPollingFallback = () => {
    if (fallbackStarted || settled) return;
    fallbackStarted = true;
    if (es) {
      try {
        es.close();
      } catch {
        /* ignore */
      }
      es = null;
    }
    pollLoop();
  };

  const armSilenceFallback = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      startPollingFallback();
    }, SSE_SILENCE_FALLBACK_MS);
  };

  const onAbort = () => finish({ kind: 'aborted' });
  signal?.addEventListener('abort', onAbort, { once: true });

  if (typeof EventSource === 'undefined') {
    startPollingFallback();
  } else {
    const url = `/api/career-identity/exploration/events?access_token=${encodeURIComponent(token)}`;
    try {
      es = new EventSource(url);
      armSilenceFallback();

      es.addEventListener('open', () => {
        armSilenceFallback();
        pollOnce().catch(() => {});
      });

      es.addEventListener('heartbeat', () => {
        armSilenceFallback();
      });

      es.onmessage = (event) => {
        armSilenceFallback();
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data?.type === 'connected' || data?.type === 'heartbeat') return;
        if (data?.type === 'exploration_completed' && data.sessionId && data.jobCount > 0) {
          fetchExplorationSessionById(data.sessionId)
            .then((session) => {
              if (session) considerSession(session, true);
            })
            .catch(() => {
              // If fetch fails, still surface a minimal discovery payload.
              finish({
                kind: 'discovered',
                session: {
                  _id: data.sessionId,
                  status: 'completed',
                  explorationJobs: Array.from({ length: data.jobCount }, () => ({})),
                  seenAt: null,
                },
                sessionId: String(data.sessionId),
                jobCount: data.jobCount,
              });
            });
        }
      };

      es.onerror = () => {
        startPollingFallback();
      };
    } catch {
      startPollingFallback();
    }
  }

  const result = await resultPromise;

  if (silenceTimer) clearTimeout(silenceTimer);
  signal?.removeEventListener('abort', onAbort);
  if (es) {
    try {
      es.close();
    } catch {
      /* ignore */
    }
  }

  return result;
}
