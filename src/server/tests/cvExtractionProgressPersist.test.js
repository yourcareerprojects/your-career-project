const mongoose = require('mongoose');
const User = require('../models/User');
const {
  persistIdentityReviewBaseline,
  extractedProfileIdentityIsEmpty,
} = require('../services/documents/cvExtractionProgressPersist');
const { normalizeInterpretationShape } = require('../services/documents/semanticCvInterpreter');

describe('persistIdentityReviewBaseline', () => {
  let userId;
  let documentId;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test');
    }
  });

  beforeEach(async () => {
    const user = await User.create({
      email: `cv-persist-${Date.now()}@example.com`,
      password: 'test-password-123',
      profile: {
        documents: [{
          type: 'cv',
          name: 'cv.pdf',
          path: '/tmp/cv.pdf',
          extractionStatus: 'completed',
          extractedProfileData: {
            userIdentity: {
              workEnjoyMost: '',
              topicsIndustriesInterest: '',
              naturallyGoodAt: '',
              workEnvironmentFit: '',
              workingLifeAchievement: '',
            },
          },
          identityEnrichmentStatus: 'pending',
        }],
      },
    });
    userId = user._id;
    documentId = user.profile.documents[0]._id;
  });

  afterEach(async () => {
    if (userId) await User.deleteOne({ _id: userId });
  });

  test('extractedProfileIdentityIsEmpty detects blank identity fields', () => {
    expect(extractedProfileIdentityIsEmpty({
      userIdentity: { workEnjoyMost: '', topicsIndustriesInterest: 'x' },
    })).toBe(false);
    expect(extractedProfileIdentityIsEmpty({
      userIdentity: { workEnjoyMost: '' },
    })).toBe(true);
  });

  test('merges identity into completed document when identity was late', async () => {
    const identitySemantic = normalizeInterpretationShape({
      userIdentity: {
        workEnjoyment: { bullets: ['Building products'], confidence: 0.9, evidence: [] },
        interests: { bullets: ['Healthcare'], confidence: 0.8, evidence: [] },
        strengths: { bullets: ['Communication'], confidence: 0.8, evidence: [] },
        workStyle: { bullets: ['Collaborative teams'], confidence: 0.7, evidence: [] },
        careerGoals: { bullets: ['Lead teams'], confidence: 0.6, evidence: [] },
      },
    });
    const heuristicResult = {
      profile: { structuredUserInfo: { skills: [] }, userIdentity: {} },
      status: 'partial',
    };

    const result = await persistIdentityReviewBaseline(
      userId,
      documentId,
      heuristicResult,
      identitySemantic
    );

    expect(result.skipped).toBe(false);
    expect(result.mergedIntoCompleted).toBe(true);

    const user = await User.findById(userId).lean();
    const doc = user.profile.documents.find((d) => String(d._id) === String(documentId));
    expect(doc.identityEnrichmentStatus).toBe('complete');
    expect(doc.extractedProfileData.userIdentity.workEnjoyMost).toContain('Building products');
  });
});
