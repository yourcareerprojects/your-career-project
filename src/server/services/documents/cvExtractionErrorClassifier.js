const { EXTRACTION_ERROR_KEYS, isKnownExtractionErrorKey } = require('../../../constants/cvExtractionErrors');
const { isTimeoutLikeError, normalizeExternalApiError } = require('../../utils/httpTimeouts');

/**
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
function serializeInternalError(error) {
  const e = error instanceof Error ? error : new Error(String(error ?? 'unknown'));
  const norm = normalizeExternalApiError(e);
  const out = {
    message: String(e.message || error || 'unknown').slice(0, 2000),
    name: e.name ? String(e.name).slice(0, 120) : undefined,
    code: e.code != null ? String(e.code).slice(0, 120) : norm.code || undefined,
    provider: e.provider != null ? String(e.provider).slice(0, 64) : undefined,
    httpStatus: norm.httpStatus ?? undefined,
  };
  if (e.stack) {
    out.stack = String(e.stack).slice(0, 8000);
  }
  return out;
}

/**
 * @param {unknown} error
 * @param {{ stage?: string }} [opts]
 * @returns {string}
 */
function determineExtractionErrorKey(error, opts = {}) {
  const stage = String(opts.stage || '').toLowerCase();
  const e = error instanceof Error ? error : new Error(String(error ?? ''));
  const norm = normalizeExternalApiError(e);
  const msg = String(e.message || '').toLowerCase();
  const code = String(e.code || '').toLowerCase();

  if (norm.httpStatus === 429 || code.includes('rate_limit') || msg.includes('rate limit')) {
    return EXTRACTION_ERROR_KEYS.RATE_LIMITED;
  }

  if (
    msg.includes('invalid file type')
    || msg.includes('unsupported file')
    || msg.includes('unsupported format')
    || msg.includes('content does not match')
  ) {
    return EXTRACTION_ERROR_KEYS.UNSUPPORTED_FORMAT;
  }

  if (
    code === 'enoent'
    || msg.includes('document not found')
    || msg.includes('missing path')
    || msg.includes('user not found')
  ) {
    return EXTRACTION_ERROR_KEYS.FILE_PARSE_FAILED;
  }

  if (isTimeoutLikeError(e)) {
    if (stage === 'ocr' || stage === 'upload') {
      return EXTRACTION_ERROR_KEYS.OCR_FAILED;
    }
    return EXTRACTION_ERROR_KEYS.AI_TIMEOUT;
  }

  if (
    stage === 'ocr'
    || msg.includes('ocr')
    || msg.includes('no extractable text')
    || msg.includes('could not read')
  ) {
    return EXTRACTION_ERROR_KEYS.OCR_FAILED;
  }

  if (stage === 'extraction' || stage === 'localization') {
    if (norm.httpStatus != null && norm.httpStatus >= 400) {
      return EXTRACTION_ERROR_KEYS.EXTRACTION_FAILED;
    }
    return EXTRACTION_ERROR_KEYS.EXTRACTION_FAILED;
  }

  if (stage === 'upload') {
    return EXTRACTION_ERROR_KEYS.FILE_PARSE_FAILED;
  }

  return EXTRACTION_ERROR_KEYS.INTERNAL_ERROR;
}

/**
 * Public error key for API responses (legacy `error` string supported, never returned).
 * @param {object|null|undefined} job
 * @returns {string}
 */
function resolvePublicErrorKey(job) {
  if (!job) {
    return EXTRACTION_ERROR_KEYS.INTERNAL_ERROR;
  }
  if (isKnownExtractionErrorKey(job.errorKey)) {
    return job.errorKey;
  }
  if (job.error) {
    return determineExtractionErrorKey(new Error(String(job.error)), { stage: job.stage });
  }
  if (job.internalError?.message) {
    return determineExtractionErrorKey(new Error(String(job.internalError.message)), {
      stage: job.stage,
    });
  }
  return EXTRACTION_ERROR_KEYS.INTERNAL_ERROR;
}

/**
 * @param {object|null|undefined} job
 * @returns {boolean}
 */
function isStaleRequeuedJob(job) {
  if (!job || job.status !== 'queued') return false;
  if (job.internalError?.code === 'STALE_REQUEUED') return true;
  const legacy = String(job.error || job.internalError?.message || '');
  return /requeued/i.test(legacy);
}

module.exports = {
  serializeInternalError,
  determineExtractionErrorKey,
  resolvePublicErrorKey,
  isStaleRequeuedJob,
};
