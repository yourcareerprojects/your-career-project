const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { validateEmailDomain } = require('../middleware/emailValidation');
const {
  hasLegacyNarrativeValidationError,
  sanitizeLegacyNarrativeProfileById,
} = require('../utils/legacyProfileSanitizer');
const {
  generateReauthToken,
  verifyReauthToken,
  createEmailVerificationCode,
  logSecurityEvent,
  REAUTH_TOKEN_TTL_SECONDS
} = require('../utils/loginSecurity');
const {
  EMAIL_VERIFICATION_TTL_MS,
  applyVerifiedFlag,
  generateVerificationToken,
  getEmailVerificationExpiry,
  hashVerificationToken,
  isUserEmailVerified,
  resendVerification: resendVerificationWithService,
  setEmailVerificationState,
  verifyEmail: verifyEmailWithService,
} = require('../services/auth/emailVerificationService');
const { deleteStoredDocumentBlob } = require('../services/documents/documentBlobStorage');
const CvExtractionJob = require('../models/CvExtractionJob');
const SimulationJob = require('../models/SimulationJob');
const SimulationPrioritizedItem = require('../models/SimulationPrioritizedItem');
const SimulationTraitUsage = require('../models/SimulationTraitUsage');
const RoleFitExplanation = require('../models/RoleFitExplanation');
const CvExtractedTextCache = require('../models/CvExtractedTextCache');
const UploadContentFingerprint = require('../models/UploadContentFingerprint');

function logAuthControllerError(context, err, extra = undefined) {
  const payload = {
    message: err?.message || String(err),
    stack: err?.stack,
  };
  if (extra !== undefined) payload.extra = extra;
  console.error(`[authController] ${context}`, payload);
}

const EMAIL_CHANGE_EXPIRY_MINUTES = parseInt(process.env.EMAIL_CHANGE_EXPIRY_MINUTES || '10', 10);
const EMAIL_CHANGE_RESEND_COOLDOWN_MS = parseInt(process.env.EMAIL_CHANGE_RESEND_COOLDOWN_MS || '60000', 10);
const EMAIL_CHANGE_MAX_ATTEMPTS = parseInt(process.env.EMAIL_CHANGE_MAX_ATTEMPTS || '6', 10);

// Configure email transporter with multiple providers
const createTransporter = async (email) => {
  const domain = email.split('@')[1].toLowerCase();
  
  // Configure different SMTP settings based on email provider
  const smtpConfigs = {
    'gmail.com': {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    },
    'outlook.com': {
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.OUTLOOK_USER,
        pass: process.env.OUTLOOK_PASSWORD
      }
    },
    'yahoo.com': {
      host: 'smtp.mail.yahoo.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.YAHOO_USER,
        pass: process.env.YAHOO_APP_PASSWORD
      }
    },
    'protonmail.com': {
      host: 'smtp.protonmail.ch',
      port: 587,
      secure: true,
      auth: {
        user: process.env.PROTONMAIL_USER,
        pass: process.env.PROTONMAIL_PASSWORD
      }
    }
  };

  // Check if we have a configured provider for this domain
  const providerConfig = smtpConfigs[domain];
  if (providerConfig && providerConfig.auth.user && providerConfig.auth.pass) {
    return nodemailer.createTransport(providerConfig);
  }

  // Try default SMTP config if credentials are provided
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const defaultConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    };
    return nodemailer.createTransport(defaultConfig);
  }

  // Try generic EMAIL_USER and EMAIL_PASS (for Gmail or other services)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  // Fallback to test account for development
  console.log('No SMTP credentials configured, using Ethereal test account');
  try {
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
  } catch (error) {
    console.error('Failed to create test email account:', error);
    throw new Error('Email service is not configured. Please set SMTP credentials in environment variables.');
  }
};

// Generate JWT token
const generateToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const expiresIn = process.env.JWT_EXPIRATION || '24h';
  const tokenVersion = user.tokenVersion || 0;
  
  return jwt.sign(
    { userId: user._id, tokenVersion },
    secret,
    { expiresIn }
  );
};

// Send verification email
const sendVerificationEmail = async (email, token) => {
  const transporter = await createTransporter(email);
  const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${encodeURIComponent(token)}`;
  
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Verify your email address',
    html: `
      <h1>Welcome to Your Career Project!</h1>
      <p>Please verify your email address by clicking the link below:</p>
      <a href="${verificationUrl}" style="
        display: inline-block;
        padding: 10px 20px;
        background-color: #007bff;
        color: white;
        text-decoration: none;
        border-radius: 5px;
        margin: 20px 0;
      ">Verify your email</a>
      <p>If you did not request this verification, please ignore this email.</p>
      <p>This verification link will expire in 24 hours.</p>
      <p>If you're having trouble clicking the button, copy and paste this URL into your browser:</p>
      <p>${verificationUrl}</p>
    `,
    text: `Welcome to Your Career Project!

Please verify your email by opening this link:
${verificationUrl}

If you did not sign up for this account, you can safely ignore this email.
This verification link expires in 24 hours.`
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw new Error('Failed to send verification email');
  }
};

const sendSecurityEmail = async ({ to, subject, html, text }) => {
  const transporter = await createTransporter(to);
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@careerpathexplorer.com',
    to,
    subject,
    html,
    text
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    // Log test email preview URL if using Ethereal
    if (info.messageId && nodemailer.getTestMessageUrl) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log('Test email preview URL:', previewUrl);
      }
    }
  } catch (error) {
    console.error('Error sending security email:', error);
    throw error;
  }
};

const sendEmailChangeVerificationEmail = async ({ to, code, currentEmail }) => {
  const expiresInMinutes = Math.floor(EMAIL_CHANGE_EXPIRY_MINUTES);

  const html = `
    <h1>Confirm your new email address</h1>
    <p>We received a request to change the email on your Career Path Explorer account from ${currentEmail} to this address.</p>
    <p>Use the verification code below within the next ${expiresInMinutes} minutes to finish the change.</p>
    <p style="
      font-size: 28px;
      letter-spacing: 8px;
      font-weight: bold;
      text-align: center;
      margin: 30px 0;
    ">${code}</p>
    <p>Return to the Career Path Explorer tab where you requested the change, enter this code, and hit Verify.</p>
    <p>If you did not request this change, you can ignore this email.</p>
    <p>The update will not take effect unless the correct code is entered.</p>
  `;

  const text = `We received a request to change the email on your Career Path Explorer account from ${currentEmail} to this address.
Your verification code is: ${code}
Enter this code within the next ${expiresInMinutes} minutes to finish the change.
If you did not request this change, please ignore this email.`;

  await sendSecurityEmail({ to, subject: 'Confirm your new email address', html, text });
};

const sendEmailChangeAlert = async ({ to, newEmail }) => {
  const html = `
    <h1>Email change requested</h1>
    <p>The email on your Career Path Explorer account is being changed to <strong>${newEmail}</strong>.</p>
    <p>If this was you, no action is needed.</p>
    <p>If you did not request this change, please secure your account immediately:</p>
    <ul>
      <li>Reset your password: <a href="${process.env.CLIENT_URL}/forgot-password">Reset password</a></li>
      <li>Contact support if you cannot access your account.</li>
    </ul>
  `;

  const text = `The email on your Career Path Explorer account is being changed to ${newEmail}.
If you did not request this, reset your password immediately at ${process.env.CLIENT_URL}/forgot-password and contact support.`;

  await sendSecurityEmail({ to, subject: 'Email change requested', html, text });
};

const sendEmailChangeConfirmation = async ({ recipient, newEmail, previousEmail }) => {
  const html = `
    <h1>Your email was updated</h1>
    <p>This confirms that the email on your Career Path Explorer account has been changed to <strong>${newEmail}</strong>.</p>
    <p>Previous email: ${previousEmail}</p>
    <p>If you did not authorize this change, please reset your password immediately and contact support.</p>
  `;

  const text = `The email on your Career Path Explorer account has been changed to ${newEmail}.
Previous email: ${previousEmail}.
If you did not authorize this change, reset your password immediately and contact support.`;

  await sendSecurityEmail({ to: recipient, subject: 'Your email was updated', html, text });
};

const sendPasswordChangeAlert = async ({ to }) => {
  const html = `
    <h1>Your password was changed</h1>
    <p>This is a confirmation that your Career Path Explorer password was just updated.</p>
    <p>If this was not you, please reset your password immediately and contact support.</p>
    <a href="${process.env.CLIENT_URL}/forgot-password" style="
      display: inline-block;
      padding: 10px 20px;
      background-color: #d32f2f;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      margin: 20px 0;
    ">Reset Password</a>
  `;

  const text = `Your Career Path Explorer password was just updated.
If you did not perform this action, reset your password immediately at ${process.env.CLIENT_URL}/forgot-password and contact support.`;

  await sendSecurityEmail({ to, subject: 'Your password was changed', html, text });
};

const buildVerifyEmailRedirectUrl = (token = '') => {
  const clientBaseUrl = String(process.env.CLIENT_URL || process.env.FRONTEND_URL || '').trim();

  if (!clientBaseUrl) {
    return token
      ? `/verify-email?token=${encodeURIComponent(token)}`
      : '/verify-email';
  }

  const redirectUrl = new URL('/verify-email', clientBaseUrl.endsWith('/') ? clientBaseUrl : `${clientBaseUrl}/`);
  if (token) {
    redirectUrl.searchParams.set('token', token);
  }
  return redirectUrl.toString();
};

const hashResetToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || '').trim())
  .digest('hex');

const buildResetPasswordUrl = (token = '') => {
  const clientBaseUrl = String(process.env.CLIENT_URL || process.env.FRONTEND_URL || '').trim();

  if (!clientBaseUrl) {
    return token
      ? `/reset-password?token=${encodeURIComponent(token)}`
      : '/reset-password';
  }

  const redirectUrl = new URL('/reset-password', clientBaseUrl.endsWith('/') ? clientBaseUrl : `${clientBaseUrl}/`);
  if (token) {
    redirectUrl.searchParams.set('token', token);
  }
  return redirectUrl.toString();
};

const sanitizePendingEmailChange = (pending = null) => {
  // Handle null, undefined, empty object, or missing newEmail
  if (!pending || typeof pending !== 'object' || !pending.newEmail) {
    return null;
  }
  
  const lastSentAt = pending.lastSentAt ? new Date(pending.lastSentAt) : null;
  const resendAvailableAt = lastSentAt
    ? new Date(lastSentAt.getTime() + EMAIL_CHANGE_RESEND_COOLDOWN_MS)
    : null;

  return {
    newEmail: pending.newEmail,
    requestedAt: pending.requestedAt,
    expiresAt: pending.expiresAt,
    lastSentAt,
    resendAvailableAt,
    attemptsRemaining: typeof pending.attemptsRemaining === 'number'
      ? pending.attemptsRemaining
      : EMAIL_CHANGE_MAX_ATTEMPTS,
    maxAttempts: pending.maxAttempts || EMAIL_CHANGE_MAX_ATTEMPTS,
    reauthExpiresAt: pending.reauthExpiresAt
  };
};

const buildUserResponse = (user) => ({
  id: user._id,
  name: user.name || '',
  email: user.email,
  isVerified: isUserEmailVerified(user),
  emailVerified: isUserEmailVerified(user),
  emailVerificationExpiresAt: getEmailVerificationExpiry(user),
  profile: user.profile,
  preferences: user.preferences,
  security: {
    lastPasswordChangeAt: user.security?.lastPasswordChangeAt,
    lastEmailChangeAt: user.security?.lastEmailChangeAt
  },
  pendingEmailChange: sanitizePendingEmailChange(user.accountStatus?.pendingEmailChange)
});

async function findUserByEmailWithLegacyRecovery(normalizedEmail, originalEmail) {
  // Prefer raw Mongo lookup first to avoid Mongoose hydration errors on legacy malformed records.
  const trimmedOriginal = String(originalEmail || '').trim();
  const rawByNormalized = await User.collection.findOne({ email: normalizedEmail });
  const rawByOriginal =
    !rawByNormalized && trimmedOriginal && trimmedOriginal !== normalizedEmail
      ? await User.collection.findOne({ email: trimmedOriginal })
      : null;
  const rawUser = rawByNormalized || rawByOriginal;

  if (rawUser?._id) {
    const repairResult = await sanitizeLegacyNarrativeProfileById(rawUser._id);
    if (repairResult.sanitized) {
      console.warn(
        `[authController] Repaired legacy narrative profile for user ${rawUser._id} during login`
      );
    }
    return User.findById(rawUser._id);
  }

  // Fallback to standard Mongoose query for non-legacy paths.
  try {
    let user = await User.findOne({ email: normalizedEmail });
    if (!user && trimmedOriginal && trimmedOriginal !== normalizedEmail) {
      user = await User.findOne({ email: trimmedOriginal });
    }
    return user;
  } catch (error) {
    if (!hasLegacyNarrativeValidationError(error)) {
      throw error;
    }
    // Last-ditch recovery if hydration failed without a raw match above.
    const fallbackRawByNormalized = await User.collection.findOne({ email: normalizedEmail });
    const fallbackRawByOriginal =
      !fallbackRawByNormalized && trimmedOriginal && trimmedOriginal !== normalizedEmail
        ? await User.collection.findOne({ email: trimmedOriginal })
        : null;
    const fallbackRawUser = fallbackRawByNormalized || fallbackRawByOriginal;
    if (!fallbackRawUser?._id) throw error;
    await sanitizeLegacyNarrativeProfileById(fallbackRawUser._id);
    return User.findById(fallbackRawUser._id);
  }
}

const verifyReauthOrPassword = async ({ user, reauthToken, currentPassword, req, eventType }) => {
  const logFailure = (reason) => {
    logSecurityEvent(user, {
      type: eventType || 'reauth_verification',
      status: 'failure',
      ip: req?.ip,
      userAgent: req?.headers ? req.headers['user-agent'] : undefined,
      metadata: { reason }
    });
  };

  if (reauthToken) {
    const decoded = verifyReauthToken(reauthToken);
    // Compare user IDs properly (handle both string and ObjectId formats)
    const userIdMatch = decoded && (
      decoded.userId?.toString() === user._id?.toString() || 
      decoded.userId?.toString() === user.id?.toString()
    );
    if (!decoded || !userIdMatch) {
      logFailure('invalid_reauth_token');
      const error = new Error('Reauthentication token is invalid or expired');
      error.statusCode = 401;
      throw error;
    }
    return true;
  }

  if (!currentPassword) {
    logFailure('missing_current_password');
    const error = new Error('Current password is required');
    error.statusCode = 400;
    throw error;
  }

  // Check if user has a valid password before comparing
  if (!user.password || typeof user.password !== 'string') {
    logFailure('invalid_password_hash');
    const error = new Error('User password is not properly set. Please contact support.');
    error.statusCode = 500;
    throw error;
  }

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    logFailure('incorrect_password');
    const error = new Error('Current password is incorrect');
    error.statusCode = 401;
    throw error;
  }

  return true;
};

// Register new user
exports.register = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password } = req.body;

    // Validate email domain
    try {
      await validateEmailDomain(email);
    } catch (error) {
      const msg = (error.message || 'Invalid or disposable email domain')
        .replace(/^Disposable email/i, 'disposable email');
      return res.status(400).json({
        errors: [{ msg }]
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    
    if (existingUser) {
      return res.status(400).json({
        error: 'User already exists with this email'
      });
    }

    // Create new user
    const user = new User({
      name: String(name || '').trim(),
      email,
      password,
      accountStatus: {
        isActive: true
      }
    });
    const verificationToken = generateVerificationToken();
    setEmailVerificationState(user, {
      verified: false,
      tokenHash: hashVerificationToken(verificationToken),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    });

    await user.save();

    // Send verification email (skip in tests)
    if (process.env.NODE_ENV !== 'test') {
      try {
        await sendVerificationEmail(email, verificationToken);
      } catch (err) {
        // Don't block registration if email sending fails, but surface in logs
        console.error('Failed to send verification email:', err);
      }
    }

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      message: 'Registration successful.',
      token,
      user: buildUserResponse(user)
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: error.message || 'Error during registration'
    });
  }
};

// Resend verification email
exports.resendVerification = async (req, res) => {
  try {
    const result = await resendVerificationWithService({
      email: req.body?.email,
      token: req.body?.token,
      sendVerificationEmail,
      skipEmailSend: process.env.NODE_ENV === 'test'
    });

    res.status(result.statusCode).json({
      message: result.message
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      error: error.message || 'Error resending verification email'
    });
  }
};

exports.verifyEmailGet = (req, res) => {
  const token = String(req.query.token || req.params.token || '').trim();
  return res.redirect(buildVerifyEmailRedirectUrl(token));
};

// Verify email
exports.verifyEmail = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const arr = errors.array();
      return res.status(400).json({
        errors: arr,
        error: arr[0]?.msg || 'Verification token is required',
        state: 'invalid'
      });
    }

    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required', state: 'invalid' });
    }
    const result = await verifyEmailWithService(token);
    const responseBody = result.error
      ? { error: result.error, state: result.state }
      : {
          message: result.message,
          state: result.state,
          user: result.user ? buildUserResponse(result.user) : undefined
        };

    return res.status(result.statusCode).json(responseBody);
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      error: 'Error during email verification'
    });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    // Check for validation errors from express-validator middleware
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: errors.array()[0].msg || 'Validation failed'
      });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Normalize email (lowercase) to match database storage
    // The email should already be normalized by express-validator, but ensure it's lowercase
    const normalizedEmail = (email || '').toLowerCase().trim();

    // Find user - try both normalized and original email with legacy-shape recovery.
    const user = await findUserByEmailWithLegacyRecovery(normalizedEmail, email);
    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    // Check if user has a password
    if (!user.password) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    // Update last login
    user.accountStatus.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user);
    res.json({
      token,
      user: buildUserResponse(user)
    });
  } catch (error) {
    logAuthControllerError('Login error', error);
    res.status(500).json({
      error: 'Error during login'
    });
  }
};

// Request password reset
exports.requestPasswordReset = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user || !isUserEmailVerified(user)) {
      return res.json({
        message: 'If an eligible account exists, a reset email has been sent.'
      });
    }

    // Generate reset token (store hash in DB; send plain token in email link)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = hashResetToken(resetToken);
    const resetExpiresAt = new Date(Date.now() + 3600000);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          'accountStatus.resetPasswordToken': resetTokenHash,
          'accountStatus.resetPasswordExpires': resetExpiresAt,
        },
      }
    );

    if (process.env.NODE_ENV !== 'test') {
      const resetUrl = buildResetPasswordUrl(resetToken);
      const transporter = await createTransporter(email);
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: 'Reset your password',
        html: `
        <h1>Password Reset Request</h1>
        <p>We received a request to reset the password for your Career Path Explorer account.</p>
        <p>Click the button below to choose a new password:</p>
        <a href="${resetUrl}" style="
          display: inline-block;
          padding: 10px 20px;
          background-color: #1976d2;
          color: white;
          text-decoration: none;
          border-radius: 5px;
          margin: 20px 0;
        ">Reset Password</a>
        <p>Or copy and paste this link into your browser:</p>
        <p>${resetUrl}</p>
        <p>This link will expire in 1 hour. If you did not request a password reset, you can ignore this email.</p>
      `,
        text: `Reset your Career Path Explorer password: ${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`
      });
    }

    res.json({
      message: 'If an eligible account exists, a reset email has been sent.'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      error: 'Error during password reset request'
    });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, password } = req.body;
    const normalizedToken = String(token || '').trim();

    if (!normalizedToken) {
      return res.status(400).json({
        error: 'Invalid or expired reset token'
      });
    }

    const tokenHash = hashResetToken(normalizedToken);

    const user = await User.findOne({
      'accountStatus.resetPasswordToken': tokenHash,
      'accountStatus.resetPasswordExpires': { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired reset token'
      });
    }

    const isSamePassword = await user.comparePassword(password);
    if (isSamePassword) {
      return res.status(400).json({
        error: 'New password must be different from the current password'
      });
    }

    const consumedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        'accountStatus.resetPasswordToken': tokenHash,
        'accountStatus.resetPasswordExpires': { $gt: new Date() },
      },
      {
        $unset: {
          'accountStatus.resetPasswordToken': '',
          'accountStatus.resetPasswordExpires': '',
        },
      },
      { new: true }
    );

    if (!consumedUser) {
      return res.status(400).json({
        error: 'Invalid or expired reset token'
      });
    }

    consumedUser.password = password;
    consumedUser.security = consumedUser.security || {};
    consumedUser.security.lastPasswordChangeAt = new Date();
    consumedUser.tokenVersion = (consumedUser.tokenVersion || 0) + 1;

    logSecurityEvent(consumedUser, {
      type: 'password_reset',
      status: 'success',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    await consumedUser.save();

    try {
      await sendPasswordChangeAlert({ to: user.email });
    } catch (emailError) {
      console.error('Failed to send password reset confirmation email:', emailError);
    }

    res.json({
      message: 'Password reset successful'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      error: 'Error during password reset'
    });
  }
};

// Get current user
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      user: buildUserResponse(user)
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      error: 'Error fetching user data'
    });
  }
};

// Reauthenticate user (short-lived token)
exports.reauthenticate = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { currentPassword } = req.body || {};
    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      logSecurityEvent(user, {
        type: 'reauthentication',
        status: 'failure',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      await user.save();
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const { token, expiresAt } = generateReauthToken(user._id);
    logSecurityEvent(user, {
      type: 'reauthentication',
      status: 'success',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    await user.save();

    res.json({
      reauthToken: token,
      expiresAt,
      ttlSeconds: REAUTH_TOKEN_TTL_SECONDS
    });
  } catch (error) {
    console.error('Reauthentication error:', error);
    res.status(500).json({ error: 'Failed to reauthenticate' });
  }
};

// Initiate email change
exports.initiateEmailChange = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { newEmail, confirmEmail, reauthToken, currentPassword } = req.body || {};
    if (!newEmail || !confirmEmail) {
      return res.status(400).json({ error: 'New email and confirmation are required' });
    }

    if (newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      return res.status(400).json({ error: 'Email addresses do not match' });
    }

    await verifyReauthOrPassword({ user, reauthToken, currentPassword, req, eventType: 'email_change_request' });

    const normalizedEmail = newEmail.trim().toLowerCase();

    if (normalizedEmail === user.email.toLowerCase()) {
      return res.status(400).json({ error: 'New email must be different from current email' });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already in use' });
    }

    await validateEmailDomain(normalizedEmail);

    const { code, codeHash } = createEmailVerificationCode();
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_EXPIRY_MINUTES * 60 * 1000);
    const now = new Date();

    user.accountStatus.pendingEmailChange = {
      newEmail: normalizedEmail,
      codeHash,
      requestedAt: now,
      expiresAt,
      lastSentAt: now,
      attemptsRemaining: EMAIL_CHANGE_MAX_ATTEMPTS,
      maxAttempts: EMAIL_CHANGE_MAX_ATTEMPTS,
      reauthExpiresAt: new Date(Date.now() + REAUTH_TOKEN_TTL_SECONDS * 1000)
    };

    logSecurityEvent(user, {
      type: 'email_change_request',
      status: 'success',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { newEmail: normalizedEmail }
    });

    await sendEmailChangeVerificationEmail({ to: normalizedEmail, code, currentEmail: user.email });

    await sendEmailChangeAlert({
      to: user.email,
      newEmail: normalizedEmail
    });

    await user.save();

    res.json({
      message: 'Verification code sent to new address',
      pendingEmailChange: sanitizePendingEmailChange(user.accountStatus.pendingEmailChange)
    });
  } catch (error) {
    console.error('Initiate email change error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || 'Failed to initiate email change' });
  }
};

// Resend email change verification
exports.resendEmailChangeVerification = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const pending = user.accountStatus.pendingEmailChange;
    if (!pending) {
      return res.status(400).json({ error: 'No pending email change request' });
    }

    if (!pending.codeHash) {
      user.accountStatus.pendingEmailChange = undefined;
      await user.save();
      return res.status(400).json({
        error: 'Pending email change is no longer valid. Please restart the process.',
        code: 'request_not_found'
      });
    }

    if (pending.expiresAt && pending.expiresAt < new Date()) {
      user.accountStatus.pendingEmailChange = undefined;
      await user.save();
      return res.status(400).json({ error: 'Pending email change request has expired' });
    }

    if (!pending.codeHash) {
      user.accountStatus.pendingEmailChange = undefined;
      await user.save();
      return res.status(400).json({
        error: 'Pending email change is no longer valid. Please restart the process.',
        code: 'request_not_found'
      });
    }

    const cooldownMs = EMAIL_CHANGE_RESEND_COOLDOWN_MS;
    if (pending.lastSentAt && (Date.now() - new Date(pending.lastSentAt).getTime()) < cooldownMs) {
      const waitSeconds = Math.ceil((cooldownMs - (Date.now() - new Date(pending.lastSentAt).getTime())) / 1000);
      return res.status(429).json({ error: `Please wait ${waitSeconds} seconds before resending` });
    }

    const { code, codeHash } = createEmailVerificationCode();
    pending.codeHash = codeHash;
    pending.lastSentAt = new Date();
    pending.expiresAt = new Date(Date.now() + EMAIL_CHANGE_EXPIRY_MINUTES * 60 * 1000);
    pending.attemptsRemaining = pending.maxAttempts || EMAIL_CHANGE_MAX_ATTEMPTS;

    await sendEmailChangeVerificationEmail({
      to: pending.newEmail,
      code,
      currentEmail: user.email
    });

    logSecurityEvent(user, {
      type: 'email_change_resend',
      status: 'success',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { newEmail: pending.newEmail }
    });

    await user.save();

    res.json({
      message: 'Verification code resent',
      pendingEmailChange: sanitizePendingEmailChange(pending)
    });
  } catch (error) {
    console.error('Resend email change error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
};

// Cancel email change
exports.cancelEmailChange = async (req, res) => {
  try {
    // Log for debugging
    console.log('Cancel email change - Request user ID:', req.user.userId, 'Type:', typeof req.user.userId);
    
    if (!req.user || !req.user.userId) {
      console.error('Cancel email change - Missing user ID in request');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      console.error('Cancel email change - User not found in database:', req.user.userId);
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.accountStatus.pendingEmailChange) {
      return res.status(400).json({ error: 'No pending email change request' });
    }

    // Prepare security event
    const securityEvent = {
      type: 'email_change_cancelled',
      status: 'success',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: {},
      createdAt: new Date()
    };

    // Ensure security container exists
    if (!user.security) {
      user.security = {};
    }
    if (!Array.isArray(user.security.events)) {
      user.security.events = [];
    }

    // Add event to the beginning and limit to 50
    user.security.events.unshift(securityEvent);
    user.security.events = user.security.events.slice(0, 50);

    // Use Mongoose updateOne with $unset for reliable nested field removal
    // Mongoose handles ID conversion automatically, so we can use req.user.userId directly
    const updateResult = await User.updateOne(
      { _id: user._id },
      {
        $unset: { 'accountStatus.pendingEmailChange': '' },
        $set: { 'security.events': user.security.events }
      }
    );

    // Verify the update was successful
    if (updateResult.matchedCount === 0) {
      console.error('Cancel email change - User not found in update operation:', user._id);
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify the field was actually removed
    const verifyUser = await User.findById(user._id)
      .select('accountStatus.pendingEmailChange')
      .lean();
    
    const fieldRemoved = !verifyUser?.accountStatus?.pendingEmailChange || 
                         !verifyUser.accountStatus.pendingEmailChange?.newEmail;

    if (!fieldRemoved) {
      console.error('Cancel email change - Field still exists after $unset! Retrying...', {
        pendingEmailChange: verifyUser.accountStatus.pendingEmailChange
      });
      // Force remove using $set to null then $unset in separate operations
      await User.updateOne(
        { _id: user._id },
        { $set: { 'accountStatus.pendingEmailChange': null } }
      );
      await User.updateOne(
        { _id: user._id },
        { $unset: { 'accountStatus.pendingEmailChange': '' } }
      );
    }

    console.log('Cancel email change - Update result:', {
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount,
      pendingEmailChangeRemoved: fieldRemoved
    });

    res.json({ message: 'Email change request cancelled' });
  } catch (error) {
    console.error('Cancel email change error:', error);
    res.status(500).json({ error: 'Failed to cancel email change request' });
  }
};

// Verify email change code
exports.verifyEmailChange = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required', code: 'code_missing' });
    }

    const pending = user.accountStatus.pendingEmailChange;
    if (!pending) {
      return res.status(400).json({ error: 'No pending email change request', code: 'request_not_found' });
    }

    const now = new Date();
    if (pending.expiresAt && pending.expiresAt < now) {
      user.accountStatus.pendingEmailChange = undefined;
      await user.save();
      return res.status(400).json({ error: 'Verification code has expired', code: 'code_expired' });
    }

    if (pending.reauthExpiresAt && pending.reauthExpiresAt < now) {
      user.accountStatus.pendingEmailChange = undefined;
      await user.save();
      return res.status(401).json({
        error: 'Reauthentication expired. Please restart the email change.',
        code: 'reauth_required'
      });
    }

    const attemptsRemaining = typeof pending.attemptsRemaining === 'number'
      ? pending.attemptsRemaining
      : EMAIL_CHANGE_MAX_ATTEMPTS;

    if (attemptsRemaining <= 0) {
      user.accountStatus.pendingEmailChange = undefined;
      await user.save();
      return res.status(429).json({
        error: 'Too many incorrect attempts. Please restart the email change process.',
        code: 'attempts_exceeded'
      });
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    if (codeHash !== pending.codeHash) {
      pending.attemptsRemaining = attemptsRemaining - 1;

      if (pending.attemptsRemaining <= 0) {
        user.accountStatus.pendingEmailChange = undefined;
        await user.save();
        logSecurityEvent(user, {
          type: 'email_change_code',
          status: 'failure',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: { reason: 'attempts_exceeded' }
        });
        return res.status(429).json({
          error: 'Too many incorrect attempts. Please restart the email change process.',
          code: 'attempts_exceeded'
        });
      }

      await user.save();
      logSecurityEvent(user, {
        type: 'email_change_code',
        status: 'failure',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: { attemptsRemaining: pending.attemptsRemaining }
      });
      return res.status(400).json({
        error: 'Verification code is incorrect',
        code: 'code_invalid',
        attemptsRemaining: pending.attemptsRemaining
      });
    }

    const previousEmail = user.email;

    user.accountStatus.emailHistory.push({
      email: user.email,
      changedAt: now,
      verified: true
    });

    user.email = pending.newEmail;
    user.accountStatus.pendingEmailChange = undefined;
    applyVerifiedFlag(user, true);
    user.security = user.security || {};
    user.security.lastEmailChangeAt = now;

    logSecurityEvent(user, {
      type: 'email_change_completed',
      status: 'success',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { previousEmail, newEmail: user.email }
    });

    await user.save();

    await sendEmailChangeConfirmation({
      recipient: user.email,
      newEmail: user.email,
      previousEmail
    });
    await sendEmailChangeConfirmation({
      recipient: previousEmail,
      newEmail: user.email,
      previousEmail
    });

    res.json({ message: 'Email updated successfully' });
  } catch (error) {
    console.error('Verify email change error:', error);
    res.status(500).json({ error: 'Failed to verify email change' });
  }
};

// Delete authenticated user's account
exports.deleteOwnAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { currentPassword } = req.body || {};

    await verifyReauthOrPassword({
      user,
      currentPassword,
      req,
      eventType: 'account_deletion'
    });

    const userId = user._id;
    const documentBlobs = Array.isArray(user.profile?.documents) ? user.profile.documents : [];
    for (const document of documentBlobs) {
      await deleteStoredDocumentBlob(document).catch((error) => {
        console.warn('[authController] Failed to delete document blob during account deletion', {
          userId: String(userId),
          storageKey: document?.storageKey,
          message: error?.message || String(error)
        });
      });
    }

    await Promise.all([
      CvExtractionJob.deleteMany({ userId }),
      SimulationJob.deleteMany({ userId }),
      SimulationPrioritizedItem.deleteMany({ userId }),
      SimulationTraitUsage.deleteMany({ userId }),
      RoleFitExplanation.deleteMany({ userId }),
      CvExtractedTextCache.deleteMany({ userId }),
      UploadContentFingerprint.deleteMany({ userId }),
      User.deleteOne({ _id: userId })
    ]);

    return res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message || 'Failed to delete account' });
  }
};

const validatePasswordStrength = (password) => {
  const rules = [
    { test: /.{8,}/, message: 'At least 8 characters' },
    { test: /[a-z]/, message: 'At least one lowercase letter' },
    { test: /[A-Z]/, message: 'At least one uppercase letter' },
    { test: /\d/, message: 'At least one number' },
    { test: /[!@#$%^&*]/, message: 'At least one special character (!@#$%^&*)' }
  ];

  const failed = rules.filter(rule => !rule.test.test(password));
  return {
    isValid: failed.length === 0,
    messages: failed.map(rule => rule.message)
  };
};

// Update password
exports.updatePassword = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { newPassword, confirmPassword, reauthToken, currentPassword } = req.body || {};

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'New password and confirmation are required' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const validation = validatePasswordStrength(newPassword);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.messages.join(', ') });
    }

    console.log('Step 1: Verifying reauthentication...');
    await verifyReauthOrPassword({ user, reauthToken, currentPassword, req, eventType: 'password_change' });
    console.log('Step 1: Reauthentication verified');

    // Check if user has a valid password before comparing
    if (!user.password || typeof user.password !== 'string') {
      return res.status(400).json({ error: 'User password is not set. Please contact support.' });
    }

    console.log('Step 2: Comparing new password with current password...');
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }
    console.log('Step 2: Password is different from current');

    console.log('Step 3: Updating user password and security info...');
    user.password = newPassword;
    user.security = user.security || {};
    user.security.lastPasswordChangeAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1;

    logSecurityEvent(user, {
      type: 'password_change',
      status: 'success',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    console.log('Step 4: Saving user to database...');
    await user.save();
    console.log('Step 4: User saved successfully');

    // Send password change alert (non-blocking - don't fail if email fails)
    console.log('Step 5: Sending password change alert email...');
    try {
      await sendPasswordChangeAlert({ to: user.email });
      console.log('Step 5: Email sent successfully');
    } catch (emailError) {
      console.error('Step 5: Failed to send password change alert email:', emailError);
      // Continue even if email fails - password change is more important
    }

    console.log('Step 6: Generating new token...');
    const token = generateToken(user);
    console.log('Step 6: Token generated successfully');

    res.json({
      message: 'Password updated successfully',
      lastPasswordChangeAt: user.security.lastPasswordChangeAt,
      token
    });
  } catch (error) {
    console.error('Password update error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    const status = error.statusCode || 500;
    // Provide a user-friendly error message
    let errorMessage = error.message || 'Failed to update password';
    // If it's a bcrypt or password-related error, provide a clearer message
    if (error.message && error.message.includes('PLAIN')) {
      errorMessage = 'Password authentication error. Please try again or contact support if the issue persists.';
    }
    res.status(status).json({ error: errorMessage });
  }
};

// Login security summary
exports.getLoginSecuritySummary = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('email emailVerified accountStatus security');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      email: user.email,
      isVerified: isUserEmailVerified(user),
      lastLoginAt: user.accountStatus?.lastLogin,
      lastEmailChangeAt: user.security?.lastEmailChangeAt,
      lastPasswordChangeAt: user.security?.lastPasswordChangeAt,
      pendingEmailChange: sanitizePendingEmailChange(user.accountStatus?.pendingEmailChange)
    });
  } catch (error) {
    console.error('Login security summary error:', error);
    res.status(500).json({ error: 'Failed to fetch login security summary' });
  }
};
