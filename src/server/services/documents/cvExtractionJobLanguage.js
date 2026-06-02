const { normalizeLanguage } = require('../../utils/languageResolution');

/** UI locales supported by the CV extraction pipeline. */
const CV_JOB_LANGUAGES = ['en', 'de'];

/**
 * Normalize any locale input to a CV job snapshot language (`en` | `de`).
 * @param {unknown} value
 * @param {'en'|'de'} [fallback='en']
 * @returns {'en'|'de'}
 */
function normalizeCvJobLanguage(value, fallback = 'en') {
  const base = normalizeLanguage(value, fallback);
  return base === 'de' ? 'de' : 'en';
}

/**
 * Resolve language once at job creation (never re-read live user settings in the worker).
 * @param {{ requestLang?: unknown, userLanguage?: unknown }} params
 * @returns {'en'|'de'}
 */
function resolveJobSnapshotLanguage({ requestLang, userLanguage } = {}) {
  if (requestLang != null && String(requestLang).trim() !== '') {
    return normalizeCvJobLanguage(requestLang);
  }
  if (userLanguage != null && String(userLanguage).trim() !== '') {
    return normalizeCvJobLanguage(userLanguage);
  }
  return 'en';
}

/**
 * Language for worker execution — job snapshot only (legacy jobs without field → `en`).
 * @param {{ language?: string } | null | undefined} job
 * @returns {'en'|'de'}
 */
function resolveJobLanguageFromDocument(job) {
  if (job && job.language != null && String(job.language).trim() !== '') {
    return normalizeCvJobLanguage(job.language);
  }
  return 'en';
}

module.exports = {
  CV_JOB_LANGUAGES,
  normalizeCvJobLanguage,
  resolveJobSnapshotLanguage,
  resolveJobLanguageFromDocument,
};
