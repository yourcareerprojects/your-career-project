const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const getReauthSecret = () => {
  const secret = process.env.JWT_REAUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_REAUTH_SECRET or JWT_SECRET must be set');
  }
  return secret;
};

const REAUTH_TOKEN_TTL_SECONDS = parseInt(process.env.REAUTH_TOKEN_TTL_SECONDS || '600', 10);

const ensureSecurityContainer = (user) => {
  if (!user.security) {
    user.security = {};
  }
  if (!Array.isArray(user.security.events)) {
    user.security.events = [];
  }
};

const generateReauthToken = (userId) => {
  const expiresAt = new Date(Date.now() + REAUTH_TOKEN_TTL_SECONDS * 1000);
  const token = jwt.sign(
    { userId, type: 'reauth' },
    getReauthSecret(),
    { expiresIn: `${REAUTH_TOKEN_TTL_SECONDS}s` }
  );

  return { token, expiresAt };
};

const verifyReauthToken = (token) => {
  try {
    const decoded = jwt.verify(token, getReauthSecret());
    if (decoded.type !== 'reauth') {
      return null;
    }
    return decoded;
  } catch (error) {
    return null;
  }
};

const createEmailVerificationCode = () => {
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  return { code, codeHash };
};

const logSecurityEvent = (user, {
  type,
  status = 'success',
  ip,
  userAgent,
  metadata = {}
}) => {
  ensureSecurityContainer(user);
  user.security.events.unshift({
    type,
    status,
    ip,
    userAgent,
    metadata,
    createdAt: new Date()
  });
  user.security.events = user.security.events.slice(0, 50);
};

module.exports = {
  generateReauthToken,
  verifyReauthToken,
  createEmailVerificationCode,
  logSecurityEvent,
  REAUTH_TOKEN_TTL_SECONDS
};

