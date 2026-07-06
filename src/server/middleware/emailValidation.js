const { body } = require('express-validator');
const dns = require('dns').promises;
const { AUTH_EMAIL_NORMALIZE_OPTIONS } = require('../constants/authEmailNormalizeOptions');

// List of known disposable email domains
const disposableEmailDomains = new Set([
  'tempmail.com',
  'throwawaymail.com',
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  // Add more as needed
]);

// List of major email providers
const majorEmailProviders = new Set([
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'protonmail.com',
  // Add more as needed
]);

// Custom validator to check if email domain is valid and not disposable
const validateEmailDomain = async (email) => {
  const domain = email.split('@')[1]?.toLowerCase();
  
  if (!domain) {
    throw new Error('Invalid email format');
  }
  
  // Check if it's a disposable email
  if (disposableEmailDomains.has(domain)) {
    throw new Error('Disposable email addresses are not allowed');
  }

  // For major providers, skip DNS lookup (faster and more reliable)
  if (majorEmailProviders.has(domain)) {
    return true;
  }

  try {
    // Check if domain has valid MX records (with timeout)
    const mxRecords = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('DNS lookup timeout')), 5000)
      )
    ]);
    
    if (!mxRecords || mxRecords.length === 0) {
      throw new Error('Invalid email domain');
    }

    return true;
  } catch (error) {
    // If DNS lookup fails, log but don't block for common domains
    console.warn('Email domain validation warning for', domain, ':', error.message);
    // Allow the email through if DNS fails - the email format is still valid
    // This prevents login failures due to network issues
    return true;
  }
};

// Custom validator to check for email aliases
const validateEmailAlias = (email) => {
  const [localPart, domain] = email.split('@');
  
  // Check for common alias patterns
  if (localPart.includes('+') && domain === 'gmail.com') {
    // Gmail aliases are allowed
    return true;
  }

  // Add more alias validation rules for other providers as needed
  return true;
};

// Rate limiting for email verification
const emailVerificationAttempts = new Map();
const MAX_ATTEMPTS = 3;
const ATTEMPT_WINDOW = 3600000; // 1 hour in milliseconds

const resetEmailVerificationRateLimit = () => {
  emailVerificationAttempts.clear();
};

const checkRateLimit = (email) => {
  const now = Date.now();
  const attempts = emailVerificationAttempts.get(email) || [];
  
  // Remove old attempts
  const recentAttempts = attempts.filter(time => now - time < ATTEMPT_WINDOW);
  
  if (recentAttempts.length >= MAX_ATTEMPTS) {
    throw new Error('Too many verification attempts. Please try again later.');
  }
  
  recentAttempts.push(now);
  emailVerificationAttempts.set(email, recentAttempts);
  return true;
};

// Export validation middleware
const emailValidation = [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(AUTH_EMAIL_NORMALIZE_OPTIONS)
    .custom(validateEmailAlias)
    .withMessage('Invalid email alias format')
    .custom(validateEmailDomain)
    .withMessage('Invalid or disposable email domain')
    .custom(checkRateLimit)
    .withMessage('Too many verification attempts')
];

module.exports = {
  emailValidation,
  validateEmailDomain,
  validateEmailAlias,
  checkRateLimit,
  resetEmailVerificationRateLimit,
  disposableEmailDomains,
  majorEmailProviders
}; 