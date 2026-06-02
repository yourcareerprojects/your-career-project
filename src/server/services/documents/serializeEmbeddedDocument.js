const { documentTypeDisplaySlug } = require('../../../constants/documentTypes');

function serializeEmbeddedDocumentForClient(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: false }) : doc;
  return {
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
    extractedProfileData: o.extractedProfileData ?? null,
    cvExtractLocalization: o.cvExtractLocalization ?? null,
    extractionMessage: o.extractionMessage ?? null,
    extractionMessageKey: o.extractionMessageKey ?? null,
    localizationStatus: o.localizationStatus ?? null,
    semanticInterpretation: o.semanticInterpretation ?? null,
    semanticInterpretationLanguage: o.semanticInterpretationLanguage ?? null,
  };
}

module.exports = {
  serializeEmbeddedDocumentForClient,
};
