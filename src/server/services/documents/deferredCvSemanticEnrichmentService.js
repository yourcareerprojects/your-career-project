/**
 * Background structured semantic enrichment after identity-first extraction.
 */

const mongoose = require('mongoose');
const User = require('../../models/User');
const logger = require('../../utils/logger');
const { normalizeExternalApiError } = require('../../utils/httpTimeouts');
const { resolveDocumentToLocalPath } = require('./documentBlobStorage');
const { resolveCvDocumentPlainText } = require('./cvExtractedTextCacheService');
const {
  resolveStructuredSemanticInterpretation,
  mergeStructuredSemanticIntoProfile,
  stripGoodAtFromProfile,
  structuredSemanticHasProfileSignals,
  structuredSeniorityHasSignals,
} = require('../cv/structuredSemantic');
const { postExtractionPlanInputFromDoc } = require('./cvPostExtractionWorkPlanner');

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

function shouldRunStructuredSemanticEnrichment(doc) {
  const status = doc?.semanticEnrichmentStatus != null ? String(doc.semanticEnrichmentStatus) : '';
  const messageKey = String(doc?.extractionMessageKey || '');
  if (
    messageKey === 'documentUpload.extraction.heuristicFallback'
    || messageKey === 'documentUpload.extraction.aiTimeout'
  ) {
    return Boolean(doc?.path);
  }
  if (!status || status === 'pending') return true;
  if (status === 'complete' && !documentHasStructuredSemanticBlob(doc) && doc?.path) return true;
  if (status === 'skipped') return Boolean(doc?.path);
  return false;
}

function documentHasStructuredSemanticBlob(doc) {
  const interpretation = doc?.semanticInterpretation;
  if (!interpretation || typeof interpretation !== 'object') return false;
  if (structuredSemanticHasProfileSignals(interpretation)) return true;
  const ui = interpretation.userIdentity;
  if (!ui || typeof ui !== 'object') return false;
  return ['workEnjoyment', 'interests', 'strengths', 'workStyle', 'careerGoals'].some((key) => {
    const node = ui[key];
    return Array.isArray(node?.bullets) && node.bullets.length > 0;
  });
}

function mergeSemanticInterpretation(existing, semantic) {
  if (!semantic || typeof semantic !== 'object') return existing ?? null;
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  if (semantic.userIdentity) base.userIdentity = semantic.userIdentity;
  if (semantic.structuredProfile) base.structuredProfile = semantic.structuredProfile;
  if (semantic.seniority) base.seniority = semantic.seniority;
  return Object.keys(base).length > 0 ? base : null;
}

function structuredSemanticHasReviewSignals(structuredSemantic) {
  if (!structuredSemantic) return false;
  return (
    structuredSemanticHasProfileSignals(structuredSemantic)
    || structuredSeniorityHasSignals(structuredSemantic)
  );
}

/**
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 * @param {{ uiLanguage?: 'en'|'de' }} [options]
 */
async function generateAndPersistCvStructuredSemantic(userId, documentId, options = {}) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  const uiLanguage = normalizeUiLanguage(options.uiLanguage, 'en');

  const user = await User.findById(uid);
  if (!user) return { skipped: true, reason: 'user_not_found' };
  const doc = user.profile.documents.id(did);
  if (!doc) return { skipped: true, reason: 'document_not_found' };
  if (doc.extractionStatus !== 'completed') {
    return { skipped: true, reason: 'extraction_not_completed' };
  }
  const enrichmentStatus = doc.semanticEnrichmentStatus != null ? String(doc.semanticEnrichmentStatus) : null;
  if (!shouldRunStructuredSemanticEnrichment(doc)) {
    return {
      skipped: true,
      reason: 'semantic_enrichment_not_pending',
      semanticEnrichmentStatus: enrichmentStatus,
    };
  }
  if (!doc.path) {
    doc.semanticEnrichmentStatus = 'skipped';
    await user.save();
    return { skipped: true, reason: 'missing_document_path', semanticEnrichmentStatus: 'skipped' };
  }

  let resolved;
  try {
    resolved = await resolveDocumentToLocalPath(doc);
    const { text } = await resolveCvDocumentPlainText({
      userId,
      documentId,
      filePath: resolved.path,
    });
    const docLang = doc.semanticInterpretationLanguage === 'de' ? 'de' : 'en';
    const structuredSemantic = await resolveStructuredSemanticInterpretation(text, docLang).catch(() => null);

    const existingProfile =
      doc.extractedProfileData && typeof doc.extractedProfileData === 'object'
        ? doc.extractedProfileData
        : {};

    const heuristicStub = { profile: existingProfile, extractedFields: [] };
    const hasStructured = structuredSemanticHasReviewSignals(structuredSemantic);

    if (hasStructured) {
      doc.extractedProfileData = mergeStructuredSemanticIntoProfile(
        existingProfile,
        structuredSemantic,
        heuristicStub,
        { documentLanguage: docLang }
      );
      doc.semanticInterpretation = mergeSemanticInterpretation(doc.semanticInterpretation, {
        structuredProfile: structuredSemantic.structuredProfile,
        seniority: structuredSemantic.seniority,
      });
      doc.semanticEnrichmentStatus = 'complete';
      doc.extractionMessageKey = null;
      doc.extractionMessage = '';
      if (doc.extractionOutcomeStatus === 'partial' || !doc.extractionOutcomeStatus) {
        doc.extractionOutcomeStatus = 'success';
      }
    } else {
      doc.extractedProfileData = stripGoodAtFromProfile(existingProfile);
      doc.semanticEnrichmentStatus = 'skipped';
    }

    await user.save();

    if (hasStructured) {
      const sourceLanguage = doc.semanticInterpretationLanguage || docLang;
      const { schedulePostExtractionWork } = require('./cvPostExtractionExecutor');
      schedulePostExtractionWork(userId, documentId, postExtractionPlanInputFromDoc(doc), {
        uiLanguage,
        sourceLanguage,
      });
    }

    return { skipped: false, semanticEnrichmentStatus: doc.semanticEnrichmentStatus };
  } catch (err) {
    logger.error('deferred_cv_structured_semantic_failed', {
      userId: String(userId),
      documentId: String(documentId),
      ...normalizeExternalApiError(err),
      ...(err instanceof Error ? { stack: err.stack } : {}),
    });
    doc.semanticEnrichmentStatus = 'skipped';
    await user.save();
    return { skipped: false, semanticEnrichmentStatus: 'skipped', reason: 'structured_semantic_failed' };
  } finally {
    await resolved?.cleanup?.();
  }
}

async function runCvStructuredSemanticOnce(userId, documentId, options = {}) {
  const key = flightKey(userId, documentId);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = generateAndPersistCvStructuredSemantic(userId, documentId, options).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

function scheduleCvStructuredSemanticEnrichment(userId, documentId, options = {}) {
  if (!userId || !documentId) return;
  void runCvStructuredSemanticOnce(userId, documentId, options).catch((err) => {
    logger.warn('schedule_cv_structured_semantic_failed', {
      userId: String(userId),
      documentId: String(documentId),
      message: err?.message || String(err),
    });
  });
}

module.exports = {
  generateAndPersistCvStructuredSemantic,
  runCvStructuredSemanticOnce,
  scheduleCvStructuredSemanticEnrichment,
  shouldRunStructuredSemanticEnrichment,
  documentHasStructuredSemanticBlob,
};
