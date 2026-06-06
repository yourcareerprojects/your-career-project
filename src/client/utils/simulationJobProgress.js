/**
 * Wait for an async simulation job with Server-Sent Events when available,
 * plus exponential-backoff polling as fallback (and when SSE disconnects).
 */

const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;
/** If no SSE heartbeat / message arrives in this window, fall back to polling (proxy buffering). */
const SSE_SILENCE_FALLBACK_MS = 20 * 1000;
/** Poll Mongo-backed status in parallel with SSE so terminal `completed` is never missed. */
const SSE_PARALLEL_POLL_MS = 3000;

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

export async function fetchSimulationJobStatus(jobId, token, lang) {
  const statusRes = await fetch(
    `/api/profile/simulation/jobs/${encodeURIComponent(jobId)}/status?lang=${encodeURIComponent(
      lang
    )}&_ts=${Date.now()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  );
  const statusData = await statusRes.json().catch(() => ({}));
  return { statusRes, statusData };
}

function applySnapshotToUi(onJobPhase, partial) {
  const jobStatus = partial?.status;
  if (jobStatus === 'queued' || jobStatus === 'pending') {
    onJobPhase?.('queued');
  } else if (jobStatus === 'running') {
    onJobPhase?.('running');
  }
}

/**
 * @returns {Promise<
 *   | { kind: 'completed' }
 *   | { kind: 'failed'; error: string }
 *   | { kind: 'poll_http_error'; message: string }
 *   | { kind: 'timeout' }
 *   | { kind: 'aborted' }
 * >}
 */
export async function waitForSimulationJobCompletion({
  jobId,
  token,
  lang,
  signal,
  onJobPhase,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
}) {
  const deadlineMs = Date.now() + maxWaitMs;

  async function smartPollLoop() {
    let intervalMs = 1000;
    const maxIntervalMs = 5000;
    let lastFp = null;

    while (Date.now() < deadlineMs) {
      if (signal?.aborted) return { kind: 'aborted' };

      const { statusRes, statusData } = await fetchSimulationJobStatus(jobId, token, lang);
      if (!statusRes.ok) {
        return {
          kind: 'poll_http_error',
          message:
            statusData?.message ||
            statusData?.error ||
            (Array.isArray(statusData?.errors) && statusData.errors[0]?.msg) ||
            'Request failed',
        };
      }

      const job = statusData?.job;
      const jobStatus = job?.status;
      const progress = Number(job?.progress ?? 0);

      applySnapshotToUi(onJobPhase, { status: jobStatus, progress });

      if (jobStatus === 'completed') return { kind: 'completed' };
      if (jobStatus === 'failed') {
        return { kind: 'failed', error: job?.error || '' };
      }

      const fp = `${jobStatus}:${progress}`;
      if (fp === lastFp) {
        intervalMs = Math.min(Math.round(intervalMs * 1.5), maxIntervalMs);
      } else {
        intervalMs = 1000;
        lastFp = fp;
      }

      try {
        await abortableDelay(intervalMs, signal);
      } catch (e) {
        if (e?.name === 'AbortError') return { kind: 'aborted' };
        throw e;
      }
    }

    return { kind: 'timeout' };
  }

  if (typeof EventSource === 'undefined') {
    return smartPollLoop();
  }

  return new Promise((resolve) => {
    let done = false;
    let es = null;
    let silenceTimer = null;
    let parallelPollTimer = null;
    let fallbackRunning = false;

    const detachAbort = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const stopSseOnly = () => {
      if (silenceTimer != null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (parallelPollTimer != null) {
        clearInterval(parallelPollTimer);
        parallelPollTimer = null;
      }
      if (es) {
        try {
          es.close();
        } catch {
          /* ignore */
        }
        es = null;
      }
    };

    const finalize = (value) => {
      if (done) return;
      done = true;
      stopSseOnly();
      detachAbort();
      resolve(value);
    };

    const onAbort = () => {
      finalize({ kind: 'aborted' });
    };

    if (signal) {
      if (signal.aborted) {
        finalize({ kind: 'aborted' });
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const startPollingFallback = () => {
      if (done || fallbackRunning) return;
      fallbackRunning = true;
      stopSseOnly();
      smartPollLoop()
        .then((r) => finalize(r))
        .catch((err) =>
          finalize(
            err?.name === 'AbortError'
              ? { kind: 'aborted' }
              : { kind: 'failed', error: err?.message || String(err) }
          )
        );
    };

    const armSilenceFallback = () => {
      if (done || fallbackRunning) return;
      if (silenceTimer != null) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        startPollingFallback();
      }, SSE_SILENCE_FALLBACK_MS);
    };

    const url =
      `/api/profile/simulation/jobs/${encodeURIComponent(jobId)}/events` +
      `?lang=${encodeURIComponent(lang)}&access_token=${encodeURIComponent(token)}`;

    const pollTerminalStatusOnce = async () => {
      if (done || fallbackRunning) return;
      try {
        const { statusRes, statusData } = await fetchSimulationJobStatus(jobId, token, lang);
        if (!statusRes.ok || done) return;
        const jobStatus = statusData?.job?.status;
        applySnapshotToUi(onJobPhase, {
          status: jobStatus,
          progress: Number(statusData?.job?.progress ?? 0),
        });
        if (jobStatus === 'completed') {
          finalize({ kind: 'completed' });
        } else if (jobStatus === 'failed') {
          finalize({ kind: 'failed', error: statusData?.job?.error || '' });
        }
      } catch {
        /* polling is best-effort while SSE is primary */
      }
    };

    es = new EventSource(url);
    armSilenceFallback();
    parallelPollTimer = setInterval(() => {
      pollTerminalStatusOnce();
    }, SSE_PARALLEL_POLL_MS);

    es.addEventListener('open', () => {
      armSilenceFallback();
      pollTerminalStatusOnce();
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

      applySnapshotToUi(onJobPhase, data);

      if (data.status === 'completed') {
        finalize({ kind: 'completed' });
        return;
      }
      if (data.status === 'failed') {
        finalize({ kind: 'failed', error: data.error || '' });
      }
    };

    es.onerror = () => {
      startPollingFallback();
    };
  });
}
