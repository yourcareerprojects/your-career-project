/**
 * Public-safe CV extraction error taxonomy.
 * Never send raw provider messages or stacks to clients — use errorKey only.
 */
const EXTRACTION_ERROR_KEYS = {
  OCR_FAILED: 'OCR_FAILED',
  AI_TIMEOUT: 'AI_TIMEOUT',
  FILE_PARSE_FAILED: 'FILE_PARSE_FAILED',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  MAX_RETRIES_EXCEEDED: 'MAX_RETRIES_EXCEEDED',
};

const EXTRACTION_ERROR_KEY_LIST = Object.values(EXTRACTION_ERROR_KEYS);

/** Server-only codes stored on internalError (never exposed to clients). */
const EXTRACTION_INTERNAL_ERROR_CODES = {
  STALE_REQUEUED: 'STALE_REQUEUED',
};

function isKnownExtractionErrorKey(value) {
  return EXTRACTION_ERROR_KEY_LIST.includes(String(value || '').trim());
}

module.exports = {
  EXTRACTION_ERROR_KEYS,
  EXTRACTION_ERROR_KEY_LIST,
  EXTRACTION_INTERNAL_ERROR_CODES,
  isKnownExtractionErrorKey,
};
