jest.mock('../services/documents/cvExtractedTextCacheService', () => ({
  resolveCvDocumentPlainText: jest.fn(),
}));

jest.mock('../services/documents/documentBlobStorage', () => ({
  resolveDocumentToLocalPath: jest.fn(),
}));

jest.mock('../services/cv/structuredSemantic', () => {
  const actual = jest.requireActual('../services/cv/structuredSemantic');
  return {
    ...actual,
    resolveStructuredSemanticInterpretation: jest.fn(),
  };
});

const User = require('../models/User');
const { resolveCvDocumentPlainText } = require('../services/documents/cvExtractedTextCacheService');
const { resolveDocumentToLocalPath } = require('../services/documents/documentBlobStorage');
const { resolveStructuredSemanticInterpretation } = require('../services/cv/structuredSemantic');
const {
  generateAndPersistCvStructuredSemantic,
} = require('../services/documents/deferredCvSemanticEnrichmentService');

describe('deferredCvSemanticEnrichmentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveCvDocumentPlainText.mockResolvedValue({
      text: 'CV body',
      fromCache: true,
      source: 'pdf_text_layer',
    });
    resolveDocumentToLocalPath.mockResolvedValue({ path: '/tmp/cv.pdf', cleanup: jest.fn() });
    resolveStructuredSemanticInterpretation.mockResolvedValue({
      structuredProfile: {
        skillDomains: [{ name: 'Leadership', confidence: 0.9, evidence: [] }],
        domains: [],
        responsibilities: [],
        skills: [],
        learningGoals: [],
      },
      seniority: {
        yearsOfExperience: { value: '8 years', confidence: 0.9, evidence: [] },
      },
    });
  });

  test('uses structured semantic resolver on deferred enrichment', async () => {
    const user = await User.create({
      name: 'Deferred Structured Tester',
      email: `deferred-structured-${Date.now()}@example.com`,
      password: 'Test123!@#',
      emailVerified: true,
      accountStatus: { isVerified: true, isActive: true },
      profile: { documents: [] },
    });
    user.profile.documents.push({
      type: 'resume',
      name: 'cv.pdf',
      path: 'uploads/cv.pdf',
      uploadDate: new Date(),
      extractionStatus: 'completed',
      semanticEnrichmentStatus: 'pending',
      semanticInterpretationLanguage: 'en',
      extractedProfileData: {
        userIdentity: { workEnjoyMost: 'Existing identity' },
        structuredUserInfo: { skills: [] },
      },
    });
    await user.save();
    const docId = user.profile.documents[0]._id;

    const result = await generateAndPersistCvStructuredSemantic(user._id, docId, { uiLanguage: 'en' });

    expect(resolveStructuredSemanticInterpretation).toHaveBeenCalledWith('CV body', 'en');
    expect(result.skipped).toBe(false);
    expect(result.semanticEnrichmentStatus).toBe('complete');

    const refreshed = await User.findById(user._id);
    const doc = refreshed.profile.documents.id(docId);
    expect(doc.semanticEnrichmentStatus).toBe('complete');
    expect(doc.extractedProfileData.structuredUserInfo.skillDomains).toEqual(['Leadership']);
    expect(doc.extractedProfileData.userIdentity.workEnjoyMost).toBe('Existing identity');

    await User.deleteOne({ _id: user._id });
  });
});
