const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { emailValidation } = require('../middleware/emailValidation');
const { AUTH_EMAIL_NORMALIZE_OPTIONS } = require('../constants/authEmailNormalizeOptions');

const router = express.Router();

// Password validation middleware
const passwordValidation = [
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/\d/)
    .withMessage('Password must contain a number')
    .matches(/[a-z]/)
    .withMessage('Password must contain a lowercase letter')
    .matches(/[A-Z]/)
    .withMessage('Password must contain an uppercase letter')
    .matches(/[!@#$%^&*]/)
    .withMessage('Password must contain a special character')
];

const loginSecurityLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || req.ip,
  message: {
    error: 'Too many security updates in a short period. Please try again later.'
  }
});

const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || req.body?.email || req.ip,
  message: {
    error: 'Too many resend requests. Please try again later.'
  }
});

// Simple email validation for login (no DNS lookup to avoid timeouts)
const simpleEmailValidation = [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(AUTH_EMAIL_NORMALIZE_OPTIONS)
    .customSanitizer((value) => value ? value.toLowerCase().trim() : value)
];

// Registration: same as login but keep provider subaddresses (e.g. user+tag@gmail.com)
const registerNameValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
];

const registerEmailValidation = [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(AUTH_EMAIL_NORMALIZE_OPTIONS)
    .customSanitizer((value) => (value ? value.toLowerCase().trim() : value)),
];

// Routes
router.post('/register', registerNameValidation, registerEmailValidation, passwordValidation, authController.register);
router.post('/login', simpleEmailValidation, authController.login);
router.post('/resend-verification', auth, resendVerificationLimiter, authController.resendVerification);
router.get('/verify-email', authController.verifyEmail);
router.get('/verify-email/:token', authController.verifyEmail);
router.get('/verify', auth, authController.getCurrentUser);
router.get('/login-security', auth, authController.getLoginSecuritySummary);
router.post('/request-password-reset', 
  emailValidation,
  authController.requestPasswordReset
);
router.post('/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    ...passwordValidation
  ],
  authController.resetPassword
);
router.get('/me', auth, authController.getCurrentUser);
router.post('/reauth', auth, loginSecurityLimiter, authController.reauthenticate);
router.post('/password-change', auth, loginSecurityLimiter, authController.updatePassword);
router.post('/email-change', auth, loginSecurityLimiter, authController.initiateEmailChange);
router.post('/email-change/resend', auth, loginSecurityLimiter, authController.resendEmailChangeVerification);
router.delete('/email-change', auth, authController.cancelEmailChange);
router.post('/email-change/verify', auth, loginSecurityLimiter, authController.verifyEmailChange);

module.exports = router; 