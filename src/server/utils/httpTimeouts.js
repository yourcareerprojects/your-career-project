/**
 * Centralized timeouts and error normalization for outbound HTTP (fetch / axios) from the Node server.
 * Does not log request bodies (may contain CV / PII).
 */

/** OpenAI chat / semantic CV / compatible gateways */
const TIMEOUT_MS_LLM =
  Number.parseInt(process.env.OPENAI_TIMEOUT_MS || '', 10) || 45000;

/** Translation and locale bridging via chat completions */
const TIMEOUT_MS_TRANSLATION =
  Number.parseInt(process.env.TRANSLATION_TIMEOUT_MS || '', 10) || 20000;

/** Third-party REST APIs (ESCO, webhooks, etc.) */
const TIMEOUT_MS_EXTERNAL_DEFAULT =
  Number.parseInt(process.env.EXTERNAL_HTTP_TIMEOUT_MS || '', 10) || 15000;

function isAbortError(err) {
  return Boolean(
    err &&
      (err.name === 'AbortError' ||
        err.code === 'ABORT_ERR' ||
        String(err.message || '').toLowerCase().includes('aborted'))
  );
}

/**
 * True for client timeouts, AbortSignal.timeout, network timeouts, common reset errors.
 * @param {unknown} err
 */
function isTimeoutLikeError(err) {
  if (!err) return false;
  if (isAbortError(err)) return true;
  const code = String(err.code || err.errno || '').toUpperCase();
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ENOTFOUND')
    return true;
  const msg = String(err.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return true;
  return false;
}

/**
 * Upstream HTTP failure suitable for logs (no bodies).
 * @param {unknown} err
 * @param {Record<string, unknown>} [extra]
 */
function normalizeExternalApiError(err, extra = {}) {
  const e = err && typeof err === 'object' ? err : new Error(String(err));
  const message = String(e.message || err || 'unknown error').slice(0, 500);
  const code = e.code != null ? String(e.code) : '';
  const httpStatus =
    typeof e.response?.status === 'number'
      ? e.response.status
      : typeof e.status === 'number'
        ? e.status
        : null;

  return {
    ...extra,
    name: e.name || 'Error',
    message,
    code,
    isTimeout: isTimeoutLikeError(e),
    isAbort: isAbortError(e),
    isNetwork: httpStatus == null && isTimeoutLikeError(e),
    httpStatus,
  };
}

/**
 * Node 20+: combine an optional caller signal with a wall-clock timeout.
 * Falls back to timeout-only when `AbortSignal.any` is unavailable.
 * @param {AbortSignal|undefined} userSignal
 * @param {number} timeoutMs
 * @returns {AbortSignal}
 */
function combineSignals(userSignal, timeoutMs) {
  const timed = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timed;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([userSignal, timed]);
  }
  return timed;
}

module.exports = {
  TIMEOUT_MS_LLM,
  TIMEOUT_MS_TRANSLATION,
  TIMEOUT_MS_EXTERNAL_DEFAULT,
  isAbortError,
  isTimeoutLikeError,
  normalizeExternalApiError,
  combineSignals,
};
