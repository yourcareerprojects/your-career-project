/**
 * Canonical document types for profile.documents (embedded on User).
 * Keep Mongoose enum, upload validators, frontend options, and normalization in sync.
 */
const DOCUMENT_TYPES = {
  CV: 'cv',
  CERTIFICATE: 'certificate',
  PORTFOLIO: 'portfolio',
  TRANSCRIPT: 'transcript',
  OTHER: 'other',
};

const DOCUMENT_TYPE_CANONICAL = Object.values(DOCUMENT_TYPES);

/** Legacy stored values — valid on read; never written on new uploads. */
const LEGACY_DOCUMENT_TYPE_VALUES = ['reference', 'resume'];

const DOCUMENT_TYPE_SCHEMA_ENUM = [
  ...DOCUMENT_TYPE_CANONICAL,
  ...LEGACY_DOCUMENT_TYPE_VALUES,
];

/**
 * Values accepted in multipart upload `documentType` before normalization.
 * Frontend may send `resume`; persistence uses {@link normalizeDocumentType}.
 */
const DOCUMENT_TYPE_UPLOAD_API_VALUES = [
  'resume',
  DOCUMENT_TYPES.CERTIFICATE,
  DOCUMENT_TYPES.PORTFOLIO,
  DOCUMENT_TYPES.TRANSCRIPT,
  DOCUMENT_TYPES.OTHER,
];

const DOCUMENT_TYPE_UPLOAD_OPTIONS = DOCUMENT_TYPE_UPLOAD_API_VALUES.map((value) => ({
  value,
}));

/** i18n slug for legacy `reference` rows (maps to transcript label). */
const LEGACY_DOCUMENT_TYPE_DISPLAY_SLUG = {
  reference: DOCUMENT_TYPES.TRANSCRIPT,
};

function normalizeDocumentType(documentType) {
  switch (documentType) {
    case 'resume':
    case DOCUMENT_TYPES.CV:
      return DOCUMENT_TYPES.CV;
    case DOCUMENT_TYPES.CERTIFICATE:
    case DOCUMENT_TYPES.PORTFOLIO:
    case DOCUMENT_TYPES.TRANSCRIPT:
    case DOCUMENT_TYPES.OTHER:
      return documentType;
    default:
      return DOCUMENT_TYPES.OTHER;
  }
}

function isCvDocumentType(documentType) {
  return normalizeDocumentType(documentType) === DOCUMENT_TYPES.CV;
}

/** Slug for `documentUpload.uploadDialog.documentTypes.*` i18n keys. */
function documentTypeDisplaySlug(storedType) {
  const key = String(storedType || '').trim();
  if (!key) return '';
  if (LEGACY_DOCUMENT_TYPE_DISPLAY_SLUG[key]) {
    return LEGACY_DOCUMENT_TYPE_DISPLAY_SLUG[key];
  }
  if (key === DOCUMENT_TYPES.CV) return 'resume';
  if (DOCUMENT_TYPE_CANONICAL.includes(key)) return key;
  if (key === 'resume') return 'resume';
  return DOCUMENT_TYPES.OTHER;
}

function isAllowedUploadDocumentType(documentType) {
  return DOCUMENT_TYPE_UPLOAD_API_VALUES.includes(String(documentType || '').trim());
}

module.exports = {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_CANONICAL,
  LEGACY_DOCUMENT_TYPE_VALUES,
  DOCUMENT_TYPE_SCHEMA_ENUM,
  DOCUMENT_TYPE_UPLOAD_API_VALUES,
  DOCUMENT_TYPE_UPLOAD_OPTIONS,
  LEGACY_DOCUMENT_TYPE_DISPLAY_SLUG,
  normalizeDocumentType,
  isCvDocumentType,
  documentTypeDisplaySlug,
  isAllowedUploadDocumentType,
};
