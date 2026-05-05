/**
 * HTTP request language resolution (no translation DB; embed-only i18n lives on documents).
 */

const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGE_FORMAT = /^[a-z]{2}(?:-[a-z]{2})?$/i;

function normalizeLanguage(language, fallback = DEFAULT_LANGUAGE) {
  const candidate = String(language || '').trim().toLowerCase();
  if (!candidate || !SUPPORTED_LANGUAGE_FORMAT.test(candidate)) {
    return fallback;
  }
  const [base] = candidate.split('-');
  return base || fallback;
}

function getUserPreferredLanguage(req) {
  const fromUser =
    req?.user?.language ||
    req?.user?.preferredLanguage ||
    req?.user?.preferences?.language ||
    req?.user?.preferences?.locale;
  if (fromUser) return fromUser;

  const header = req?.headers?.['accept-language'];
  if (!header || typeof header !== 'string') return null;
  const first = header.split(',')[0]?.trim();
  if (!first) return null;
  return first.split(';')[0]?.trim();
}

function resolveRequestLanguage(req, { defaultLanguage = DEFAULT_LANGUAGE } = {}) {
  const explicit =
    req?.query?.lang ||
    req?.query?.language ||
    req?.body?.lang ||
    req?.body?.language;
  if (explicit) return normalizeLanguage(explicit, defaultLanguage);

  const preferred = getUserPreferredLanguage(req);
  if (preferred) return normalizeLanguage(preferred, defaultLanguage);

  return defaultLanguage;
}

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_FORMAT,
  normalizeLanguage,
  getUserPreferredLanguage,
  resolveRequestLanguage,
};
