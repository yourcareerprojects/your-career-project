/**
 * CV extract localization persistence (demand-driven via lazyCvExtractLocalizationService).
 */

const mongoose = require('mongoose');
const User = require('../../models/User');
const logger = require('../../utils/logger');
const { normalizeExternalApiError } = require('../../utils/httpTimeouts');
const {
  localizeCvExtractedProfile,
  fallbackCvProfileWithoutLocalization,
  mergeCvExtractLocalizationPatch,
} = require('./cvExtractLocalization');
const { updateUserDocumentWithVersionRetry } = require('./userDocumentVersionedSave');

/** @type {Map<string, Promise<{ skipped: boolean, reason?: string }>>} */
const inFlight = new Map();

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}

function flightKey(userId, documentId) {
  return `${String(userId)}:${String(documentId)}`;
}

function normalizeUiLanguage(value, fallback = 'en') {
  const code = String(value || fallback).toLowerCase().split('-')[0] || fallback;
  return code === 'de' ? 'de' : 'en';
}

/**
 * Localize a pending CV extraction and persist bilingual bundles onto the user document.
 * Idempotent when localization is already complete or skipped.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 * @param {{ uiLanguage?: 'en'|'de' }} [options]
 * @returns {Promise<{ skipped: boolean, reason?: string, localizationStatus?: string|null }>}
 */
function isCvExtractLocalizationInFlight(userId, documentId) {
  return inFlight.has(flightKey(userId, documentId));
}

async function generateAndPersistCvExtractLocalization(userId, documentId, options = {}) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  const uiLanguage = normalizeUiLanguage(options.uiLanguage, 'en');

  const gateUser = await User.findById(uid);
  if (!gateUser) {
    return { skipped: true, reason: 'user_not_found' };
  }
  const gateDoc = gateUser.profile.documents.id(did);
  if (!gateDoc) {
    return { skipped: true, reason: 'document_not_found' };
  }
  if (gateDoc.extractionStatus !== 'completed') {
    return { skipped: true, reason: 'extraction_not_completed' };
  }
  const status = gateDoc.localizationStatus != null ? String(gateDoc.localizationStatus) : null;
  const deferrable = !status || status === 'pending' || status === 'idle';
  if (!deferrable) {
    return { skipped: true, reason: 'localization_not_pending', localizationStatus: status };
  }
  if (!gateDoc.extractedProfileData || typeof gateDoc.extractedProfileData !== 'object') {
    await updateUserDocumentWithVersionRetry(uid, did, (_user, doc) => {
      doc.localizationStatus = 'skipped';
    });
    return { skipped: true, reason: 'no_extracted_profile', localizationStatus: 'skipped' };
  }

  const docLang = gateDoc.semanticInterpretationLanguage === 'de' ? 'de' : 'en';
  const rawProfile = gateDoc.extractedProfileData;

  try {
    const localized = await localizeCvExtractedProfile(rawProfile, docLang, uiLanguage);
    const saveResult = await updateUserDocumentWithVersionRetry(uid, did, (user, doc) => {
      doc.extractedProfileData = localized.profile;
      doc.cvExtractLocalization = localized.cvI18n;
      doc.localizationStatus = localized.localizationStatus || 'complete';
      if (localized.cvI18n && typeof localized.cvI18n === 'object') {
        user.profile.cvExtractLocalization = mergeCvExtractLocalizationPatch(
          user.profile.cvExtractLocalization,
          localized.cvI18n
        );
      }
    });
    if (!saveResult.ok) {
      return { skipped: true, reason: saveResult.reason || 'save_failed' };
    }
    return {
      skipped: false,
      localizationStatus: saveResult.doc?.localizationStatus || localized.localizationStatus || 'complete',
    };
  } catch (err) {
    logger.error('deferred_cv_extract_localization_failed', {
      userId: String(userId),
      documentId: String(documentId),
      ...normalizeExternalApiError(err),
      ...(err instanceof Error ? { stack: err.stack } : {}),
    });
    const fallbackProfile = fallbackCvProfileWithoutLocalization(rawProfile, uiLanguage);
    await updateUserDocumentWithVersionRetry(uid, did, (user, doc) => {
      doc.extractedProfileData = fallbackProfile;
      doc.cvExtractLocalization = null;
      doc.localizationStatus = 'skipped';
    }).catch((saveErr) => {
      logger.warn('deferred_cv_extract_localization_skip_save_failed', {
        userId: String(userId),
        documentId: String(documentId),
        message: saveErr?.message || String(saveErr),
      });
    });
    return { skipped: false, localizationStatus: 'skipped', reason: 'localization_failed' };
  }
}

/**
 * Coalesce concurrent localization for the same document.
 */
async function runCvExtractLocalizationOnce(userId, documentId, options = {}) {
  const key = flightKey(userId, documentId);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = generateAndPersistCvExtractLocalization(userId, documentId, options)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Fire-and-forget localization (used only by explicit demand-driven callers).
 */
function scheduleCvExtractLocalization(userId, documentId, options = {}) {
  if (!userId || !documentId) return;
  void runCvExtractLocalizationOnce(userId, documentId, options).catch((err) => {
    logger.warn('schedule_cv_extract_localization_failed', {
      userId: String(userId),
      documentId: String(documentId),
      message: err?.message || String(err),
    });
  });
}

module.exports = {
  generateAndPersistCvExtractLocalization,
  runCvExtractLocalizationOnce,
  scheduleCvExtractLocalization,
  isCvExtractLocalizationInFlight,
};
