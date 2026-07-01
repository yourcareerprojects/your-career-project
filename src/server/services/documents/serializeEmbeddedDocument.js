const { documentTypeDisplaySlug } = require('../../../constants/documentTypes');
const { fallbackCvProfileWithoutLocalization } = require('./cvExtractLocalization');
const { computeCvExtractionReadiness } = require('./cvExtractionReadiness');

function normalizeUiLanguage(value, fallback = 'en') {
  const code = String(value || fallback).toLowerCase().split('-')[0] || fallback;
  return code === 'de' ? 'de' : 'en';
}

function resolveExtractedProfileForClient(doc, uiLanguage) {
  const profile = doc?.extractedProfileData ?? null;
  if (!profile || typeof profile !== 'object') return profile;
  const locStatus = String(doc?.localizationStatus || '');
  if (locStatus !== 'pending' && locStatus !== 'idle') return profile;
  return fallbackCvProfileWithoutLocalization(profile, normalizeUiLanguage(uiLanguage, 'en'));
}

function documentHasExtractionResult(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.extractedProfileData && typeof doc.extractedProfileData === 'object') return true;
  const pipeline = String(doc.extractionStatus ?? '').trim().toLowerCase();
  const outcome = String(doc.extractionOutcomeStatus ?? '').trim().toLowerCase();
  return pipeline === 'completed' || pipeline === 'complete'
    || outcome === 'success' || outcome === 'partial';
}

function docForReadinessComputation(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  if (doc.extractedProfileData) return doc;
  if (documentHasExtractionResult(doc)) {
    return { ...doc, extractedProfileData: {} };
  }
  return doc;
}

function serializeEmbeddedDocumentForClient(doc, options = {}) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: false }) : doc;
  const uiLanguage = options.uiLanguage;
  const lang = normalizeUiLanguage(uiLanguage, 'en');
  const includeExtractionPayload = options.includeExtractionPayload !== false;
  const readiness = computeCvExtractionReadiness(docForReadinessComputation(o), null, { language: lang });
  const serialized = {
    id: o._id,
    type: o.type,
    documentTypeDisplay: documentTypeDisplaySlug(o.type),
    name: o.name,
    path: o.path,
    storageProvider: o.storageProvider ?? null,
    storageKey: o.storageKey ?? null,
    mimeType: o.mimeType ?? null,
    uploadDate: o.uploadDate,
    isArchived: o.isArchived,
    version: o.version,
    description: o.description,
    status: o.status,
    extractionStatus: o.extractionStatus ?? null,
    extractionOutcomeStatus: o.extractionOutcomeStatus ?? null,
    extractionMessage: o.extractionMessage ?? null,
    extractionMessageKey: o.extractionMessageKey ?? null,
    localizationStatus: o.localizationStatus ?? null,
    semanticInterpretationLanguage: o.semanticInterpretationLanguage ?? null,
    semanticEnrichmentStatus: o.semanticEnrichmentStatus ?? null,
    narrativeEnrichmentStatus: o.narrativeEnrichmentStatus ?? null,
    reviewReady: readiness.reviewReady,
    reviewQuality: readiness.reviewQuality,
    isBackgroundEnriching: readiness.isBackgroundEnriching,
    backgroundEnrichment: readiness.backgroundEnrichment,
    displayStage: readiness.displayStage,
    phase: readiness.phase,
    narrativesReady: readiness.narrativesReady,
    blockingTask: readiness.blockingTask,
  };
  if (includeExtractionPayload) {
    serialized.extractedProfileData = resolveExtractedProfileForClient(o, uiLanguage);
    serialized.cvExtractLocalization = o.cvExtractLocalization ?? null;
    serialized.semanticInterpretation = o.semanticInterpretation ?? null;
  }
  return serialized;
}

module.exports = {
  serializeEmbeddedDocumentForClient,
};
