const mongoose = require('mongoose');
const User = require('../models/User');
const {
  generateAndPersistCvExtractLocalization,
  scheduleCvExtractLocalization,
} = require('../services/documents/deferredCvExtractLocalizationService');
const { localizeCvExtractedProfile } = require('../services/documents/cvExtractLocalization');
const { serializeEmbeddedDocumentForClient } = require('../services/documents/serializeEmbeddedDocument');

jest.mock('../services/documents/cvExtractLocalization', () => {
  const actual = jest.requireActual('../services/documents/cvExtractLocalization');
  return {
    ...actual,
    localizeCvExtractedProfile: jest.fn(),
  };
});

async function seedDocument(overrides = {}) {
  const user = await User.create({
    name: 'Deferred Loc Tester',
    email: `deferred-loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test123!@#',
    emailVerified: true,
    accountStatus: { isVerified: true, isActive: true },
    profile: { documents: [] },
  });
  user.profile.documents.push({
    type: 'resume',
    name: 'cv.txt',
    path: '/tmp/cv.txt',
    uploadDate: new Date(),
    extractionStatus: 'completed',
    extractionOutcomeStatus: 'success',
    semanticInterpretationLanguage: 'en',
    ...overrides,
  });
  await user.save();
  return {
    userId: user._id,
    documentId: user.profile.documents[0]._id,
  };
}

describe('deferredCvExtractLocalizationService', () => {
  const createdUserIds = [];

  afterEach(async () => {
    jest.clearAllMocks();
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
      createdUserIds.length = 0;
    }
  });

  test('generateAndPersistCvExtractLocalization updates pending document', async () => {
    const { userId, documentId } = await seedDocument({
      localizationStatus: 'idle',
      extractedProfileData: {
        userIdentity: { workEnjoyMost: 'Building products' },
        structuredUserInfo: { skillDomains: ['Strategy'] },
      },
    });
    createdUserIds.push(userId);

    localizeCvExtractedProfile.mockResolvedValue({
      profile: {
        userIdentity: { workEnjoyMost: 'Building products' },
        structuredUserInfo: { skillDomains: ['Strategy'] },
      },
      cvI18n: { documentLanguage: 'en', userIdentity: {}, structuredUserInfo: {} },
      localizationStatus: 'complete',
    });

    const result = await generateAndPersistCvExtractLocalization(userId, documentId, { uiLanguage: 'en' });
    expect(result.skipped).toBe(false);
    expect(result.localizationStatus).toBe('complete');
    expect(localizeCvExtractedProfile).toHaveBeenCalledTimes(1);

    const refreshed = await User.findById(userId).lean();
    const doc = refreshed.profile.documents.find((d) => String(d._id) === String(documentId));
    expect(doc.localizationStatus).toBe('complete');
    expect(doc.cvExtractLocalization).toBeTruthy();
  });

  test('generateAndPersistCvExtractLocalization is idempotent when not pending', async () => {
    const { userId, documentId } = await seedDocument({
      localizationStatus: 'complete',
      cvExtractLocalization: { documentLanguage: 'en' },
      extractedProfileData: { userIdentity: {}, structuredUserInfo: {} },
    });
    createdUserIds.push(userId);

    const result = await generateAndPersistCvExtractLocalization(userId, documentId, { uiLanguage: 'en' });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('localization_not_pending');
    expect(localizeCvExtractedProfile).not.toHaveBeenCalled();
  });

  test('scheduleCvExtractLocalization runs localization for pending extraction', async () => {
    const { userId, documentId } = await seedDocument({
      localizationStatus: 'idle',
      semanticInterpretationLanguage: 'de',
      extractedProfileData: {
        userIdentity: { workEnjoyMost: 'Coaching teams' },
        structuredUserInfo: {},
      },
    });
    createdUserIds.push(userId);

    localizeCvExtractedProfile.mockResolvedValue({
      profile: {
        userIdentity: { workEnjoyMost: 'Coaching teams' },
        structuredUserInfo: {},
      },
      cvI18n: { documentLanguage: 'de', userIdentity: {}, structuredUserInfo: {} },
      localizationStatus: 'complete',
    });

    scheduleCvExtractLocalization(userId, documentId, { uiLanguage: 'de' });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(localizeCvExtractedProfile).toHaveBeenCalledTimes(1);
  });
});

describe('serializeEmbeddedDocumentForClient deferred localization', () => {
  test('returns fallback flattened profile while localization is idle', () => {
    const serialized = serializeEmbeddedDocumentForClient(
      {
        _id: new mongoose.Types.ObjectId(),
        type: 'resume',
        name: 'cv.pdf',
        path: '/tmp/cv.pdf',
        uploadDate: new Date(),
        localizationStatus: 'idle',
        extractedProfileData: {
          userIdentity: { workEnjoyMost: 'German text' },
          structuredUserInfo: { skillDomains: ['Domain A'] },
        },
      },
      { uiLanguage: 'en' }
    );
    expect(serialized.localizationStatus).toBe('idle');
    expect(serialized.extractedProfileData.userIdentity.workEnjoyMost).toBe('German text');
    expect(serialized.extractedProfileData.structuredUserInfo.skillDomains).toEqual(['Domain A']);
  });

  test('omits extraction payload when includeExtractionPayload is false', () => {
    const serialized = serializeEmbeddedDocumentForClient(
      {
        _id: new mongoose.Types.ObjectId(),
        type: 'resume',
        name: 'cv.pdf',
        path: '/tmp/cv.pdf',
        uploadDate: new Date(),
        extractionStatus: 'completed',
        semanticInterpretation: { skills: ['large blob'] },
        cvExtractLocalization: { documentLanguage: 'de' },
        extractedProfileData: { userIdentity: { q1: 'answer' } },
      },
      { uiLanguage: 'en', includeExtractionPayload: false }
    );
    expect(serialized.extractedProfileData).toBeUndefined();
    expect(serialized.semanticInterpretation).toBeUndefined();
    expect(serialized.cvExtractLocalization).toBeUndefined();
    expect(serialized.reviewReady).toBe(true);
  });
});
