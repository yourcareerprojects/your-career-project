/**
 * Options for validator.normalizeEmail / express-validator.
 * Must stay aligned across register, login, and password-reset so stored emails
 * match lookups (Gmail ignores dots in delivery, but we persist the exact local part).
 */
const AUTH_EMAIL_NORMALIZE_OPTIONS = {
  gmail_remove_dots: false,
  gmail_remove_subaddress: false,
  outlookdotcom_remove_subaddress: false,
  icloud_remove_subaddress: false,
  yahoo_remove_subaddress: false,
};

module.exports = { AUTH_EMAIL_NORMALIZE_OPTIONS };
