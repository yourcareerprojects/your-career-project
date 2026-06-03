/**
 * Demand-driven CV extract localization (not part of post-extraction background work).
 */

const mongoose = require('mongoose');
const User = require('../../models/User');
const {
  runCvExtractLocalizationOnce,
} = require('./deferredCvExtractLocalizationService');

/** @typedef {'en'|'de'} CvUiLang */

/**
 * @param {unknown} value
 * @returns {CvUiLang}
 */
function normalizeTargetLanguage(value) {
  const code = String(value || 'en').toLowerCase().split('-')[0] || 'en';
  return code === 'de' ? 'de' : 'en';
}

/**
 * @param {object|null|undefined} doc
 * @returns {CvUiLang}
 */
function documentSourceLanguage(doc) {
  const fromSemantic = doc?.semanticInterpretationLanguage;
  if (fromSemantic === 'de' || fromSemantic === 'en') return fromSemantic;
  const fromBundle = doc?.cvExtractLocalization?.documentLanguage;
  if (fromBundle === 'de' || fromBundle === 'en') return fromBundle;
  return 'en';
}

/**
 * @param {unknown} status
 */
function isLocalizationSettled(status) {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'complete' || s === 'partial' || s === 'skipped';
}

/**
 * True when bilingual translation should run for the requested UI locale.
 * @param {object|null|undefined} doc
 * @param {CvUiLang} targetLanguage
 */
function cvExtractNeedsLocalization(doc, targetLanguage) {
  if (!doc?.extractedProfileData || typeof doc.extractedProfileData !== 'object') {
    return false;
  }
  if (doc.extractionStatus !== 'completed') return false;
  if (isLocalizationSettled(doc.localizationStatus)) return false;
  const source = documentSourceLanguage(doc);
  const target = normalizeTargetLanguage(targetLanguage);
  return source !== target;
}

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}

/**
 * Return localized CV extract for a document, translating only on demand.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 * @param {CvUiLang} targetLanguage
 * @returns {Promise<{ skipped: boolean, reason?: string, localizationStatus?: string|null, doc?: object|null }>}
 */
async function getLocalizedCvExtract(userId, documentId, targetLanguage) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  const uiLanguage = normalizeTargetLanguage(targetLanguage);

  const user = await User.findById(uid);
  if (!user) {
    return { skipped: true, reason: 'user_not_found' };
  }
  const doc = user.profile?.documents?.id(did);
  if (!doc) {
    return { skipped: true, reason: 'document_not_found' };
  }

  if (isLocalizationSettled(doc.localizationStatus)) {
    return {
      skipped: true,
      reason: 'already_localized',
      localizationStatus: String(doc.localizationStatus),
      doc,
    };
  }

  if (!cvExtractNeedsLocalization(doc, uiLanguage)) {
    return {
      skipped: true,
      reason: 'same_language_as_source',
      localizationStatus: doc.localizationStatus != null ? String(doc.localizationStatus) : 'idle',
      doc,
    };
  }

  const result = await runCvExtractLocalizationOnce(uid, did, { uiLanguage });
  const refreshed = await User.findById(uid);
  const freshDoc = refreshed?.profile?.documents?.id(did) || doc;
  return { ...result, doc: freshDoc };
}

module.exports = {
  cvExtractNeedsLocalization,
  documentSourceLanguage,
  getLocalizedCvExtract,
  isLocalizationSettled,
  normalizeTargetLanguage,
};
