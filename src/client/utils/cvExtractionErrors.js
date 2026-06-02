const { EXTRACTION_ERROR_KEYS, isKnownExtractionErrorKey } = require('../../constants/cvExtractionErrors');

const EXTRACTION_ERROR_I18N_KEYS = {
  [EXTRACTION_ERROR_KEYS.OCR_FAILED]: 'documentUpload.extractionErrors.OCR_FAILED',
  [EXTRACTION_ERROR_KEYS.AI_TIMEOUT]: 'documentUpload.extractionErrors.AI_TIMEOUT',
  [EXTRACTION_ERROR_KEYS.FILE_PARSE_FAILED]: 'documentUpload.extractionErrors.FILE_PARSE_FAILED',
  [EXTRACTION_ERROR_KEYS.UNSUPPORTED_FORMAT]: 'documentUpload.extractionErrors.UNSUPPORTED_FORMAT',
  [EXTRACTION_ERROR_KEYS.EXTRACTION_FAILED]: 'documentUpload.extractionErrors.EXTRACTION_FAILED',
  [EXTRACTION_ERROR_KEYS.RATE_LIMITED]: 'documentUpload.extractionErrors.RATE_LIMITED',
  [EXTRACTION_ERROR_KEYS.INTERNAL_ERROR]: 'documentUpload.extractionErrors.INTERNAL_ERROR',
  [EXTRACTION_ERROR_KEYS.MAX_RETRIES_EXCEEDED]: 'documentUpload.extractionErrors.MAX_RETRIES_EXCEEDED',
};

const FALLBACK_I18N_KEY = 'documentUpload.extractionErrors.fallback';

/**
 * Map server errorKey to a user-safe localized message. Never displays raw backend errors.
 * @param {string|null|undefined} errorKey
 * @param {(key: string, opts?: object) => string} t - i18next `t`
 * @returns {string}
 */
function getExtractionErrorMessage(errorKey, t) {
  const key = isKnownExtractionErrorKey(errorKey)
    ? errorKey
    : EXTRACTION_ERROR_KEYS.INTERNAL_ERROR;
  const i18nKey = EXTRACTION_ERROR_I18N_KEYS[key] || FALLBACK_I18N_KEY;
  const translated = t(i18nKey);
  if (translated && translated !== i18nKey) {
    return translated;
  }
  return t(FALLBACK_I18N_KEY);
}

module.exports = {
  getExtractionErrorMessage,
  EXTRACTION_ERROR_KEYS,
};
