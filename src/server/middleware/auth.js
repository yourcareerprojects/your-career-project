const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const User = require('../models/User');
const {
  hasLegacyNarrativeValidationError,
  sanitizeLegacyNarrativeProfileById,
} = require('../utils/legacyProfileSanitizer');

/**
 * EventSource cannot send Authorization headers; allow `?access_token=` for routes that opt in
 * (e.g. simulation job SSE). Ignored when Authorization is already present.
 */
function attachAccessTokenFromQuery(req, res, next) {
  const existing = req.header('Authorization');
  const q = req.query?.access_token;
  if (
    q &&
    typeof q === 'string' &&
    q.trim() &&
    (!existing || !String(existing).trim())
  ) {
    req.headers.authorization = `Bearer ${q.trim()}`;
  }
  next();
}

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({
        error: 'No authentication token, access denied'
      });
    }

    // Verify token (must match signing secret in authController; set via .env / server.js)
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const decoded = jwt.verify(token, secret);

    // Find user (with recovery for legacy malformed narrative profile shapes).
    let user;
    try {
      user = await User.findById(decoded.userId).select('-password');
    } catch (error) {
      if (!hasLegacyNarrativeValidationError(error)) {
        throw error;
      }
      const repairResult = await sanitizeLegacyNarrativeProfileById(decoded.userId);
      if (repairResult.sanitized) {
        console.warn(
          `[auth middleware] Repaired legacy narrative profile for user ${decoded.userId}`
        );
      }
      user = await User.findById(decoded.userId).select('-password');
    }
    if (!user) {
      return res.status(401).json({
        error: 'User not found'
      });
    }

    const tokenVersion = decoded.tokenVersion ?? 0;
    const userTokenVersion = user.tokenVersion || 0;
    if (tokenVersion !== userTokenVersion) {
      return res.status(401).json({
        error: 'Session is no longer valid. Please sign in again.'
      });
    }

    // Check if user is active
    if (!user.accountStatus.isActive) {
      return res.status(401).json({
        error: 'Account is inactive'
      });
    }

    // Add user to request
    req.user = decoded;
    next();
  } catch (error) {
    logger.error(
      'Auth middleware token verification failed',
      error instanceof Error ? error : { message: String(error) }
    );
    res.status(401).json({
      error: 'Token is not valid'
    });
  }
};

authMiddleware.attachAccessTokenFromQuery = attachAccessTokenFromQuery;
module.exports = authMiddleware; 