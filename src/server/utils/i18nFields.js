/**
 * Strict embedded i18n: every localized field is a plain object with required string `en`.
 * Optional locale keys (e.g. `de`) may be null when untranslated.
 */

const DEFAULT_LANG = 'en';

class InvalidI18nFieldError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidI18nFieldError';
  }
}

/**
 * @param {unknown} field
 * @param {string} [context]
 */
function assertIsLocalizedField(field, context = 'field') {
  if (field == null || typeof field !== 'object' || Array.isArray(field)) {
    throw new InvalidI18nFieldError(`Invalid i18n ${context}: expected object with { en, ... }`);
  }
  if (!Object.prototype.hasOwnProperty.call(field, 'en')) {
    throw new InvalidI18nFieldError(`Invalid i18n ${context}: missing 'en'`);
  }
  if (typeof field.en !== 'string') {
    throw new InvalidI18nFieldError(`Invalid i18n ${context}: 'en' must be a string`);
  }
  if (field.de != null && typeof field.de !== 'string') {
    throw new InvalidI18nFieldError(`Invalid i18n ${context}: 'de' must be a string or null`);
  }
}

/**
 * @param {object} field
 * @param {string} lang — base language code (e.g. en, de)
 * @returns {string}
 */
function getLocalizedField(field, lang = DEFAULT_LANG) {
  assertIsLocalizedField(field, 'field');
  const code = (lang && String(lang).toLowerCase().split('-')[0]) || DEFAULT_LANG;
  if (Object.prototype.hasOwnProperty.call(field, code) && field[code] != null) {
    return String(field[code]);
  }
  return String(field[DEFAULT_LANG]);
}

/**
 * Resolves a field to a display string without throwing. Use for response shaping
 * over persisted or migrated data: plain strings, partial locale objects, or strict { en, de }.
 * @param {unknown} field
 * @param {string} [lang]
 * @returns {string}
 */
function getLocalizedFieldLenient(field, lang = DEFAULT_LANG) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'number' || typeof field === 'boolean') return String(field);
  if (typeof field !== 'object' || Array.isArray(field)) {
    return String(field);
  }
  const code = (lang && String(lang).toLowerCase().split('-')[0]) || DEFAULT_LANG;
  const asTrimmed = (v) => {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : String(v);
    return s.trim();
  };
  if (Object.prototype.hasOwnProperty.call(field, code) && field[code] != null) {
    const t = asTrimmed(field[code]);
    if (t) return t;
  }
  if (Object.prototype.hasOwnProperty.call(field, 'en') && field.en != null) {
    const t = asTrimmed(field.en);
    if (t) return t;
  }
  for (const k of Object.keys(field)) {
    const v = field[k];
    if (v != null && typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

/**
 * Canonical English string for hashing and EN-only pipelines.
 * @param {object|null|undefined} field
 * @returns {string|null} null only when field is null/undefined
 */
function getEnglishField(field) {
  if (field == null) return null;
  assertIsLocalizedField(field, 'field');
  return String(field.en);
}

/**
 * @param {object|null|undefined} domainField
 * @returns {string} trimmed English domain label (empty if field null)
 */
function getEnglishDomainName(domainField) {
  if (domainField == null) return '';
  assertIsLocalizedField(domainField, 'domain');
  return String(domainField.en != null ? domainField.en : '').trim();
}

module.exports = {
  DEFAULT_LANG,
  InvalidI18nFieldError,
  assertIsLocalizedField,
  getLocalizedField,
  getLocalizedFieldLenient,
  getEnglishField,
  getEnglishDomainName,
};
