const rateLimit = require('express-rate-limit');

/** Production IP limiter for /api/documents — uploads & metadata stay protected. */
const DOCUMENT_ROUTE_IP_WINDOW_MS = 15 * 60 * 1000;
const DOCUMENT_ROUTE_IP_MAX = 60;

const EXTRACTION_STATUS_PATH_RE = /^\/api\/documents\/[^/]+\/extraction-status$/;
const NARRATIVE_CACHE_STATUS_PATH_RE = /^\/api\/documents\/[^/]+\/narrative-cache-status$/;

function documentRoutePathOnly(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

/**
 * True for high-frequency, read-only document status polls used during CV extraction
 * and profile review-save (must not share the upload IP cap).
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isDocumentHighFrequencyPollRequest(req) {
  const pathOnly = documentRoutePathOnly(req);
  if (EXTRACTION_STATUS_PATH_RE.test(pathOnly)) {
    return req.method === 'GET';
  }
  if (NARRATIVE_CACHE_STATUS_PATH_RE.test(pathOnly)) {
    return req.method === 'GET' || req.method === 'POST';
  }
  return false;
}

/**
 * @deprecated Use isDocumentHighFrequencyPollRequest — kept for existing tests/imports.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isCvExtractionStatusPollRequest(req) {
  if (req.method !== 'GET') return false;
  return EXTRACTION_STATUS_PATH_RE.test(documentRoutePathOnly(req));
}

function createDocumentRouteIpLimiter() {
  return rateLimit({
    windowMs: DOCUMENT_ROUTE_IP_WINDOW_MS,
    max: DOCUMENT_ROUTE_IP_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
    skip: (req) => isDocumentHighFrequencyPollRequest(req),
  });
}

module.exports = {
  DOCUMENT_ROUTE_IP_WINDOW_MS,
  DOCUMENT_ROUTE_IP_MAX,
  isCvExtractionStatusPollRequest,
  isDocumentHighFrequencyPollRequest,
  createDocumentRouteIpLimiter,
};
