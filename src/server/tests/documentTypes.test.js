const { validationResult } = require('express-validator');
const User = require('../models/User');
const { documentUploadValidation } = require('../routes/documents');
const {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_CANONICAL,
  DOCUMENT_TYPE_SCHEMA_ENUM,
  DOCUMENT_TYPE_UPLOAD_API_VALUES,
  normalizeDocumentType,
  isCvDocumentType,
  documentTypeDisplaySlug,
  isAllowedUploadDocumentType,
} = require('../../constants/documentTypes');

async function runUploadValidators(body) {
  const req = { body };
  for (const validator of documentUploadValidation) {
    // eslint-disable-next-line no-await-in-loop
    await validator.run(req);
  }
  return validationResult(req);
}

describe('documentTypes constants', () => {
  test('canonical types match target vocabulary', () => {
    expect(DOCUMENT_TYPE_CANONICAL).toEqual([
      'cv',
      'certificate',
      'portfolio',
      'transcript',
      'other',
    ]);
    expect(DOCUMENT_TYPES).toEqual({
      CV: 'cv',
      CERTIFICATE: 'certificate',
      PORTFOLIO: 'portfolio',
      TRANSCRIPT: 'transcript',
      OTHER: 'other',
    });
  });

  test('schema enum includes legacy reference and resume for reads', () => {
    expect(DOCUMENT_TYPE_SCHEMA_ENUM).toEqual(
      expect.arrayContaining(['transcript', 'reference', 'resume'])
    );
    expect(DOCUMENT_TYPE_SCHEMA_ENUM).not.toContain('invalid');
  });

  test('upload API accepts resume and transcript but not reference or cv', () => {
    expect(DOCUMENT_TYPE_UPLOAD_API_VALUES).toEqual([
      'resume',
      'certificate',
      'portfolio',
      'transcript',
      'other',
    ]);
    expect(isAllowedUploadDocumentType('resume')).toBe(true);
    expect(isAllowedUploadDocumentType('transcript')).toBe(true);
    expect(isAllowedUploadDocumentType('reference')).toBe(false);
    expect(isAllowedUploadDocumentType('cv')).toBe(false);
  });

  test('normalizeDocumentType maps resume to cv and keeps transcript', () => {
    expect(normalizeDocumentType('resume')).toBe(DOCUMENT_TYPES.CV);
    expect(normalizeDocumentType('transcript')).toBe(DOCUMENT_TYPES.TRANSCRIPT);
    expect(normalizeDocumentType('certificate')).toBe(DOCUMENT_TYPES.CERTIFICATE);
    expect(normalizeDocumentType('unknown')).toBe(DOCUMENT_TYPES.OTHER);
    expect(normalizeDocumentType('reference')).toBe(DOCUMENT_TYPES.OTHER);
  });

  test('isCvDocumentType recognizes resume and cv only', () => {
    expect(isCvDocumentType('resume')).toBe(true);
    expect(isCvDocumentType('cv')).toBe(true);
    expect(isCvDocumentType('transcript')).toBe(false);
    expect(isCvDocumentType('reference')).toBe(false);
  });

  test('documentTypeDisplaySlug maps legacy reference to transcript i18n key', () => {
    expect(documentTypeDisplaySlug('reference')).toBe('transcript');
    expect(documentTypeDisplaySlug('cv')).toBe('resume');
    expect(documentTypeDisplaySlug('transcript')).toBe('transcript');
  });
});

describe('document upload validation middleware', () => {
  test('transcript upload passes validation', async () => {
    const result = await runUploadValidators({ documentType: 'transcript' });
    expect(result.isEmpty()).toBe(true);
  });

  test('resume upload passes validation', async () => {
    const result = await runUploadValidators({ documentType: 'resume' });
    expect(result.isEmpty()).toBe(true);
  });

  test('reference and cv are rejected at validation', async () => {
    const referenceResult = await runUploadValidators({ documentType: 'reference' });
    expect(referenceResult.isEmpty()).toBe(false);

    const cvResult = await runUploadValidators({ documentType: 'cv' });
    expect(cvResult.isEmpty()).toBe(false);
  });

  test('invalid document types fail validation', async () => {
    const result = await runUploadValidators({ documentType: 'diploma' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array()[0].msg).toBe('Invalid document type');
  });
});

describe('User document type persistence', () => {
  const baseUser = {
    email: 'doctypes@example.com',
    password: 'Test123!@#',
    profile: { documents: [] },
  };

  test('transcript persists correctly', async () => {
    const user = await User.create({
      ...baseUser,
      email: 'transcript-user@example.com',
      profile: {
        documents: [{
          type: DOCUMENT_TYPES.TRANSCRIPT,
          name: 'grades.pdf',
          path: '/tmp/grades.pdf',
          uploadDate: new Date(),
        }],
      },
    });
    const loaded = await User.findById(user._id);
    expect(loaded.profile.documents[0].type).toBe('transcript');
  });

  test('resume normalizes to cv when applied before save', async () => {
    const storedType = normalizeDocumentType('resume');
    const user = await User.create({
      ...baseUser,
      email: 'resume-user@example.com',
      profile: {
        documents: [{
          type: storedType,
          name: 'cv.pdf',
          path: '/tmp/cv.pdf',
          uploadDate: new Date(),
        }],
      },
    });
    const loaded = await User.findById(user._id);
    expect(loaded.profile.documents[0].type).toBe('cv');
  });

  test('legacy reference documents still load safely', async () => {
    const user = await User.create({
      ...baseUser,
      email: 'legacy-ref@example.com',
      profile: {
        documents: [{
          type: 'reference',
          name: 'old-ref.pdf',
          path: '/tmp/old-ref.pdf',
          uploadDate: new Date(),
        }],
      },
    });
    const loaded = await User.findById(user._id);
    expect(loaded.profile.documents[0].type).toBe('reference');
    expect(documentTypeDisplaySlug(loaded.profile.documents[0].type)).toBe('transcript');
  });
});
