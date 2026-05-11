const crypto = require('crypto');
const User = require('../../models/User');

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TOKEN_HISTORY_LIMIT = 10;
const GENERIC_RESEND_VERIFICATION_MESSAGE = 'If your email is eligible, a verification email has been sent.';

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashVerificationToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function rememberEmailVerificationTokenHash(user, tokenHash) {
  if (!tokenHash) return;

  user.accountStatus = user.accountStatus || {};
  const existingHistory = Array.isArray(user.accountStatus.verificationTokenHistory)
    ? user.accountStatus.verificationTokenHistory
    : [];

  user.accountStatus.verificationTokenHistory = [
    tokenHash,
    ...existingHistory.filter((entry) => entry && entry !== tokenHash)
  ].slice(0, EMAIL_VERIFICATION_TOKEN_HISTORY_LIMIT);
}

function writeDeprecatedVerificationMirrors(user, { verified, tokenHash = null, expiresAt = null }) {
  user.accountStatus = user.accountStatus || {};
  user.accountStatus.verificationToken = tokenHash || undefined;
  user.accountStatus.tokenExpiry = expiresAt || undefined;
  if (!verified) {
    user.accountStatus.verificationAttempts = user.accountStatus.verificationAttempts || 0;
  }
}

function setEmailVerificationState(user, { verified, tokenHash = null, expiresAt = null }) {
  const previousTokenHash = user.emailVerificationToken || user.accountStatus?.verificationToken || null;
  rememberEmailVerificationTokenHash(user, previousTokenHash);
  rememberEmailVerificationTokenHash(user, tokenHash);

  applyVerifiedFlag(user, verified);
  user.emailVerificationToken = tokenHash;
  user.emailVerificationExpiresAt = expiresAt;

  // Keep legacy nested fields mirrored for backward compatibility with persisted data.
  writeDeprecatedVerificationMirrors(user, { verified, tokenHash, expiresAt });
}

function applyVerifiedFlag(user, verified) {
  // Canonical verification state lives on the top-level user fields.
  user.emailVerified = Boolean(verified);
  user.accountStatus = user.accountStatus || {};
  // Keep the deprecated nested mirror aligned for compatibility reads.
  user.accountStatus.isVerified = Boolean(verified);
}

function isUserEmailVerified(user) {
  return Boolean(user?.emailVerified || user?.accountStatus?.isVerified);
}

function doesVerificationTokenMatchCurrentState(user, tokenHash) {
  return user?.emailVerificationToken === tokenHash || user?.accountStatus?.verificationToken === tokenHash;
}

function getEmailVerificationExpiry(user) {
  return user?.emailVerificationExpiresAt || user?.accountStatus?.tokenExpiry || null;
}

function buildActiveVerificationTokenQuery(tokenHash, now) {
  return {
    $or: [
      { emailVerificationToken: tokenHash },
      { 'accountStatus.verificationToken': tokenHash }
    ],
    emailVerified: { $ne: true },
    'accountStatus.isVerified': { $ne: true },
    $and: [
      {
        $or: [
          { emailVerificationExpiresAt: { $gt: now } },
          {
            emailVerificationExpiresAt: null,
            'accountStatus.tokenExpiry': { $gt: now }
          },
          {
            emailVerificationExpiresAt: { $exists: false },
            'accountStatus.tokenExpiry': { $gt: now }
          }
        ]
      }
    ]
  };
}

function buildVerificationSuccessUpdate(tokenHash) {
  return {
    $set: {
      emailVerified: true,
      'accountStatus.isVerified': true
    },
    $unset: {
      emailVerificationToken: '',
      emailVerificationExpiresAt: '',
      'accountStatus.verificationToken': '',
      'accountStatus.tokenExpiry': ''
    },
    $push: {
      'accountStatus.verificationTokenHistory': {
        $each: [tokenHash],
        $position: 0,
        $slice: EMAIL_VERIFICATION_TOKEN_HISTORY_LIMIT
      }
    }
  };
}

function buildVerificationLookupQuery(tokenHash) {
  return {
    $or: [
      { emailVerificationToken: tokenHash },
      { 'accountStatus.verificationToken': tokenHash },
      { 'accountStatus.verificationTokenHistory': tokenHash }
    ]
  };
}

function resolveVerificationStateFromHash(user, tokenHash) {
  if (!user) {
    return { statusCode: 400, state: 'invalid', error: 'Invalid verification token' };
  }

  const isCurrentToken = doesVerificationTokenMatchCurrentState(user, tokenHash);
  const isVerified = isUserEmailVerified(user);
  const expiry = getEmailVerificationExpiry(user);
  const now = new Date();

  if (!isCurrentToken) {
    if (isVerified) {
      return {
        statusCode: 200,
        message: 'Email already verified',
        state: 'already_verified',
        user
      };
    }
    return { statusCode: 400, state: 'invalid', error: 'Invalid verification token' };
  }

  if (isVerified) {
    return {
      statusCode: 200,
      message: 'Email already verified',
      state: 'already_verified',
      user
    };
  }

  if (expiry && expiry <= now) {
    return { statusCode: 400, state: 'expired', error: 'Verification token expired' };
  }

  return {
    statusCode: 200,
    message: 'Email already verified',
    state: 'already_verified',
    user
  };
}

async function verifyEmail(token) {
  const tokenHash = hashVerificationToken(token);
  const now = new Date();

  const verifiedUser = await User.findOneAndUpdate(
    buildActiveVerificationTokenQuery(tokenHash, now),
    buildVerificationSuccessUpdate(tokenHash),
    { new: true }
  );

  if (verifiedUser) {
    return {
      statusCode: 200,
      message: 'Email verified successfully',
      state: 'verified',
      user: verifiedUser
    };
  }

  const user = await User.findOne(buildVerificationLookupQuery(tokenHash));
  return resolveVerificationStateFromHash(user, tokenHash);
}

async function resendVerification({ email, token, sendVerificationEmail, skipEmailSend = false }) {
  const emailFromBody = String(email || '').trim().toLowerCase();
  const tokenFromBody = String(token || '').trim();
  const tokenHash = tokenFromBody ? hashVerificationToken(tokenFromBody) : '';

  let user = null;
  if (tokenHash) {
    user = await User.findOne({
      $or: [
        { emailVerificationToken: tokenHash },
        { 'accountStatus.verificationToken': tokenHash }
      ]
    });
  }

  if (!user && emailFromBody) {
    user = await User.findOne({ email: emailFromBody });
  }

  if (!user || isUserEmailVerified(user)) {
    return {
      statusCode: 200,
      message: GENERIC_RESEND_VERIFICATION_MESSAGE
    };
  }

  const verificationToken = generateVerificationToken();
  setEmailVerificationState(user, {
    verified: false,
    tokenHash: hashVerificationToken(verificationToken),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)
  });
  await user.save();

  if (!skipEmailSend && typeof sendVerificationEmail === 'function') {
    await sendVerificationEmail(user.email, verificationToken);
  }

  return {
    statusCode: 200,
    message: GENERIC_RESEND_VERIFICATION_MESSAGE
  };
}

module.exports = {
  EMAIL_VERIFICATION_TTL_MS,
  GENERIC_RESEND_VERIFICATION_MESSAGE,
  generateVerificationToken,
  getEmailVerificationExpiry,
  hashVerificationToken,
  isUserEmailVerified,
  applyVerifiedFlag,
  resendVerification,
  setEmailVerificationState,
  verifyEmail,
};
