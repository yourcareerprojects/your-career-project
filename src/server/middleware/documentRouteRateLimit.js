const rateLimit = require('express-rate-limit');

/** Production IP limiter for /api/documents — uploads & metadata stay protected. */
const DOCUMENT_ROUTE_IP_WINDOW_MS = 15 * 60 * 1000;
const DOCUMENT_ROUTE_IP_MAX = 60;

const EXTRACTION_STATUS_PATH_RE = /^\/api\/documents\/[^/]+\/extraction-status$/;

/**
 * True for authenticated CV extraction status polls (high frequency, read-only).
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isCvExtractionStatusPollRequest(req) {
  if (req.method !== 'GET') return false;
  const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
  return EXTRACTION_STATUS_PATH_RE.test(pathOnly);
}

function createDocumentRouteIpLimiter() {
  return rateLimit({
    windowMs: DOCUMENT_ROUTE_IP_WINDOW_MS,
    max: DOCUMENT_ROUTE_IP_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
    skip: (req) => isCvExtractionStatusPollRequest(req),
  });
}

module.exports = {
  DOCUMENT_ROUTE_IP_WINDOW_MS,
  DOCUMENT_ROUTE_IP_MAX,
  isCvExtractionStatusPollRequest,
  createDocumentRouteIpLimiter,
};
