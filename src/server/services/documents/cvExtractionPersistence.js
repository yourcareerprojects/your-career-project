const mongoose = require('mongoose');
const User = require('../../models/User');
const logger = require('../../utils/logger');
const { mergeCvExtractLocalizationPatch } = require('./cvExtractLocalization');
const { schedulePostExtractionWork } = require('./cvPostExtractionExecutor');
const { postExtractionPlanInputFromBundle } = require('./cvPostExtractionWorkPlanner');
const { upsertCvExtractedTextCache } = require('./cvExtractedTextCacheService');

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}

/**
 * Persist successful extraction onto the embedded document and merge CV i18n into profile.
 * Skips writes if the document is already marked completed (idempotent).
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 * @param {Record<string, unknown>} bundle — sanitized extraction payload (no raw CV text)
 * @param {{ uiLanguage?: 'en'|'de', extractedDocumentText?: string, extractedDocumentTextSource?: string, jobId?: string }} [options]
 * @returns {Promise<{ skipped: boolean, reason?: string }>}
 */
async function applyCvExtractionSuccessToUser(userId, documentId, bundle, options = {}) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  const user = await User.findById(uid);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  const doc = user.profile.documents.id(did);
  if (!doc) {
    const err = new Error('Document not found');
    err.code = 'DOCUMENT_NOT_FOUND';
    throw err;
  }
  if (doc.extractionStatus === 'completed') {
    return { skipped: true, reason: 'document_already_completed' };
  }

  doc.extractedProfileData = bundle.profile ?? null;
  doc.cvExtractLocalization = bundle.cvExtractLocalization ?? null;
  doc.extractionMessage = bundle.message != null ? String(bundle.message).slice(0, 2000) : '';
  doc.extractionMessageKey = bundle.messageKey != null ? String(bundle.messageKey).slice(0, 200) : null;
  doc.localizationStatus = bundle.localizationStatus != null ? String(bundle.localizationStatus) : null;
  doc.semanticInterpretation = bundle.semanticInterpretation ?? null;
  doc.semanticInterpretationLanguage =
    bundle.semanticInterpretationLanguage != null ? String(bundle.semanticInterpretationLanguage).slice(0, 8) : null;
  doc.semanticEnrichmentStatus =
    bundle.semanticEnrichmentStatus != null ? String(bundle.semanticEnrichmentStatus).slice(0, 32) : null;
  doc.identityEnrichmentStatus =
    bundle.identityEnrichmentStatus != null ? String(bundle.identityEnrichmentStatus).slice(0, 32) : 'complete';
  doc.reviewReady = true;
  doc.extractionStatus = 'completed';
  doc.extractionOutcomeStatus =
    bundle.status != null ? String(bundle.status).replace(/[^\w.-]/g, '').slice(0, 32) : null;

  if (bundle.cvExtractLocalization && typeof bundle.cvExtractLocalization === 'object') {
    user.profile.cvExtractLocalization = mergeCvExtractLocalizationPatch(
      user.profile.cvExtractLocalization,
      bundle.cvExtractLocalization
    );
    user.markModified('profile.cvExtractLocalization');
  }

  await user.save();

  const plainText = options.extractedDocumentText != null ? String(options.extractedDocumentText) : '';
  if (plainText.trim()) {
    try {
      await upsertCvExtractedTextCache({
        userId: uid,
        documentId: did,
        text: plainText,
        source: options.extractedDocumentTextSource,
        jobId: options.jobId,
        storageKey: doc.storageKey || null,
      });
    } catch (cacheErr) {
      logger.warn('cv_extracted_text_cache_upsert_failed', {
        userId: String(uid),
        documentId: String(did),
        message: cacheErr?.message || String(cacheErr),
      });
    }
  }

  const sourceLanguage =
    bundle.cvExtractLocalization?.documentLanguage ||
    bundle.semanticInterpretationLanguage ||
    null;

  schedulePostExtractionWork(userId, documentId, postExtractionPlanInputFromBundle(bundle), {
    uiLanguage: options.uiLanguage,
    sourceLanguage,
  });

  return { skipped: false };
}

/**
 * Mark embedded document extraction as failed (does not overwrite completed reviews).
 */
async function applyCvExtractionFailureToUser(userId, documentId, errorKey = null) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  const user = await User.findById(uid);
  if (!user) return { skipped: true, reason: 'user_not_found' };
  const doc = user.profile.documents.id(did);
  if (!doc) return { skipped: true, reason: 'document_not_found' };
  if (doc.extractionStatus === 'completed') {
    return { skipped: true, reason: 'document_already_completed' };
  }
  doc.extractionStatus = 'failed';
  doc.extractionOutcomeStatus = 'failed';
  if (errorKey) {
    doc.extractionMessageKey = String(errorKey).slice(0, 200);
    doc.extractionMessage = '';
  }
  await user.save();
  return { skipped: false };
}

module.exports = {
  applyCvExtractionSuccessToUser,
  applyCvExtractionFailureToUser,
};
