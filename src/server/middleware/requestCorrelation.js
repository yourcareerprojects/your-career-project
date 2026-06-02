const crypto = require('crypto');

/**
 * Assigns a stable request ID for logs and client correlation.
 * Accepts incoming X-Request-ID when valid; echoes back on the response.
 */
function requestCorrelationMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const safeIncoming =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128 && /^[\w\-:.]+$/.test(incoming)
      ? incoming
      : null;
  req.requestId = safeIncoming || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

module.exports = requestCorrelationMiddleware;
