const User = require('../models/User');

jest.mock('../services/jobAnalysis/dimensionSummaryGenerator', () => ({
  EMPTY_PLACEHOLDER: 'No information available yet',
  generateDimensionSummary: jest.fn(async ({ dimension, rawItems }, options = {}) => {
    const items = Array.isArray(rawItems) ? rawItems : [];
    const text = items.length === 0 ? 'No information available yet' : `[${dimension}] ${items.join(' | ')}`;
    if (options.returnBundle) {
      const sourceLang = String(options.sourceLang || options.lang || 'en').toLowerCase();
      const altLang = sourceLang === 'de' ? 'en' : 'de';
      return {
        canonical: `${sourceLang.toUpperCase()} ${text}`,
        canonicalLanguage: sourceLang,
        localized: {
          [altLang]: `${altLang.toUpperCase()} ${text}`,
        },
      };
    }
    return text;
  }),
}));

jest.mock('../services/jobAnalysis/whoAreYouNarrativeGenerator', () => ({
  PLACEHOLDER: 'No personal profile information available yet.',
  generateWhoAreYouNarratives: jest.fn(async (rawAnswers = [], options = {}) => {
    const base = Array.isArray(rawAnswers) ? rawAnswers : [];
    const canonical = [0, 1, 2, 3, 4].map((idx) => {
      const text = String(base[idx] || '').trim();
      return text ? `[who_are_you_${idx}] ${text}` : 'No personal profile information available yet.';
    });
    if (options.returnBundle) {
      const sourceLang = String(options.sourceLang || options.lang || 'en').toLowerCase();
      const altLang = sourceLang === 'de' ? 'en' : 'de';
      return {
        canonical: canonical.map((line) => `${sourceLang.toUpperCase()} ${line}`),
        canonicalLanguage: sourceLang,
        localized: {
          [altLang]: canonical.map((line) => `${altLang.toUpperCase()} ${line}`),
        },
      };
    }
    return canonical;
  }),
}));

jest.mock('../services/jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator', () => ({
  PLACEHOLDER: 'I have not provided enough identity information yet to create a meaningful semantic profile.',
  generateWhoAreYouIdentityEmbeddingText: jest.fn(async (rawAnswers = []) => {
    const text = (Array.isArray(rawAnswers) ? rawAnswers : []).map((v) => String(v || '').trim()).filter(Boolean).join(' | ');
    return text ? `I focus on ${text}.` : 'I have not provided enough identity information yet to create a meaningful semantic profile.';
  }),
}));

jest.mock('../services/embedding/userIdentityEmbeddingTextService', () => {
  const actual = jest.requireActual('../services/embedding/userIdentityEmbeddingTextService');
  return {
    ...actual,
    refreshUserIdentityEmbeddingOnUserDocument: jest.fn(async () => undefined),
    scheduleRefreshUserIdentityEmbeddingForUser: jest.fn(),
    ensureUserIdentityEmbeddingCachedByUserId: jest.fn(async () => null),
  };
});

jest.mock('../services/profile/deferredProfileNarrativeService', () => ({
  scheduleDeferredProfileNarrativesForUser: jest.fn(),
}));

jest.mock('../services/profile/profilePostReviewSaveService', () => ({
  schedulePostProfileReviewSaveWork: jest.fn(),
}));

jest.mock('../services/ai/translationCache', () => ({
  cachedTranslate: jest.fn(async (_text, _lang, fn) => fn()),
}));

jest.mock('../services/ai/translateStructured', () => ({
  translateStructured: jest.fn(async (text) => text),
}));

jest.mock('../services/ai/translateText', () => ({
  translateText: jest.fn(async ({ text }) => text),
}));

jest.mock('../services/profile/extractionNarrativeEnrichmentService', () => {
  const actual = jest.requireActual('../services/profile/extractionNarrativeEnrichmentService');
  return {
    ...actual,
    scheduleExtractionNarrativeEnrichment: jest.fn(),
    warmReviewNarrativeCache: jest.fn(async () => ({ updated: true })),
  };
});

const { clearProfileResponseCache } = require('../services/profileGetResponseCache');
const profileController = require('../controllers/profileController');
const { generateDimensionSummary } = require('../services/jobAnalysis/dimensionSummaryGenerator');
const { generateWhoAreYouNarratives } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
const { generateWhoAreYouIdentityEmbeddingText } = require('../services/jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator');
const {
  scheduleRefreshUserIdentityEmbeddingForUser,
} = require('../services/embedding/userIdentityEmbeddingTextService');
const { scheduleDeferredProfileNarrativesForUser } = require('../services/profile/deferredProfileNarrativeService');
const { buildWhoAreYouRawAnswersFromIdentity } = require('../services/profile/extractionNarrativeEnrichmentService');
const {
  POLISHED_SUMMARIES,
  POLISHED_WHO_LINE,
  buildPolishedStructuredUserInfo,
  buildPolishedWhoAreYou,
  narrativeDimension,
  narrativeSummaryField,
  stampQualityEnrichment,
} = require('./helpers/narrativeCacheFixtures');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function buildProfileWithExistingNarratives() {
  const identity = reviewPayload.userIdentity;
  const whoSummaryJson = JSON.stringify(Array(5).fill(POLISHED_WHO_LINE));
  return {
    personalInfo: {},
    userIdentityAnswers: { ...identity },
    who_are_you: {
      raw_answers: [
        identity.workEnjoyMost,
        identity.topicsIndustriesInterest,
        identity.naturallyGoodAt,
        identity.workEnvironmentFit,
        identity.workingLifeAchievement,
      ],
      summary_text: narrativeSummaryField(whoSummaryJson),
      identity_embedding_text: 'Cached identity embedding text',
    },
    structuredUserInfo: {
      skillDomains: narrativeDimension([], POLISHED_SUMMARIES.skillDomains),
      skills: narrativeDimension(['SQL'], POLISHED_SUMMARIES.skills),
      skillsInDevelopment: narrativeDimension([], 'No information available yet'),
      keyResponsibilities: narrativeDimension(['Own API design'], POLISHED_SUMMARIES.keyResponsibilities),
      domains: narrativeDimension(['Finance'], POLISHED_SUMMARIES.domains),
    },
    careerSimulationInputs: { structuredUserInfo: {} },
    documents: [],
  };
}

const reviewPayload = {
  mode: 'replace',
  name: 'Review User',
  seniority: {
    currentStatus: 'employed',
    yearsOfExperience: 4,
    highestDegree: 'bachelors',
    mostSeniorWorkExperience: 'mid_level',
  },
  userIdentity: {
    workEnjoyMost: 'Building useful products',
    topicsIndustriesInterest: 'Education and health',
    naturallyGoodAt: 'Breaking down complex problems',
    workEnvironmentFit: 'Collaborative teams',
    workingLifeAchievement: 'Ship meaningful features',
  },
  structuredUserInfo: {
    skills: ['JavaScript', 'Node.js'],
    domains: ['Software'],
    keyResponsibilities: ['Own API design'],
  },
};

describe('profileController.saveProfileReview', () => {
  beforeEach(() => {
    clearProfileResponseCache();
    scheduleRefreshUserIdentityEmbeddingForUser.mockClear();
  });

  test('persists seniority, identity, and structured data atomically', async () => {
    const created = await User.create({
      email: 'review-save@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        structuredUserInfo: {},
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: reviewPayload,
    };
    const res = mockRes();

    await profileController.saveProfileReview(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.seniority).toMatchObject(reviewPayload.seniority);
    expect(payload.userIdentity.workEnjoyMost).toBe(reviewPayload.userIdentity.workEnjoyMost);
    expect(payload.narrativesReady).toBe(false);
    expect(payload.narrativePending.length).toBeGreaterThan(0);
    expect(scheduleRefreshUserIdentityEmbeddingForUser).not.toHaveBeenCalled();

    const persisted = await User.findById(created._id).lean();
    expect(scheduleDeferredProfileNarrativesForUser).toHaveBeenCalled();
    expect(generateWhoAreYouNarratives).not.toHaveBeenCalled();
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(persisted.name).toBe('Review User');
    expect(persisted.profile.seniority).toMatchObject(reviewPayload.seniority);
    expect(persisted.profile.userIdentityAnswers.workEnjoyMost).toBe(reviewPayload.userIdentity.workEnjoyMost);
    expect(persisted.profile.structuredUserInfo.skills.raw_items).toEqual(['JavaScript', 'Node.js']);
    expect(persisted.profile.structuredUserInfo.domains.raw_items).toEqual(['Software']);
  });

  test('merge mode combines existing and incoming structured lists', async () => {
    const created = await User.create({
      email: 'review-save-merge@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        structuredUserInfo: {
          skills: { raw_items: ['SQL'], summary_text: { en: 'SQL' } },
          domains: { raw_items: ['Finance'], summary_text: { en: 'Finance' } },
        },
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: {
        ...reviewPayload,
        mode: 'merge',
        structuredUserInfo: {
          skills: ['Python'],
          domains: ['Health'],
        },
      },
    };
    const res = mockRes();

    await profileController.saveProfileReview(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const persisted = await User.findById(created._id).lean();
    expect(persisted.profile.structuredUserInfo.skills.raw_items).toEqual(['SQL', 'Python']);
    expect(persisted.profile.structuredUserInfo.domains.raw_items).toEqual(['Finance', 'Health']);
  });

  test('reuses pre-generated extraction narratives when review-save matches CV baseline', async () => {
    const docId = '507f1f77bcf86cd799439011';
    const extractedProfile = {
      seniority: reviewPayload.seniority,
      userIdentity: reviewPayload.userIdentity,
      structuredUserInfo: {
        skillDomains: [],
        skills: reviewPayload.structuredUserInfo.skills.map((name) => ({ name })),
        domains: reviewPayload.structuredUserInfo.domains,
        keyResponsibilities: reviewPayload.structuredUserInfo.keyResponsibilities,
        skillsInDevelopment: [],
      },
    };
    const { computeNarrativeSourceFingerprint } = require('../services/profile/extractionNarrativeEnrichmentService');
    const profileDataForFp = {
      userIdentity: reviewPayload.userIdentity,
      structuredUserInfo: {
        ...extractedProfile.structuredUserInfo,
        ...reviewPayload.structuredUserInfo,
      },
    };
    const narrativeEnrichment = stampQualityEnrichment({
      fingerprint: computeNarrativeSourceFingerprint(profileDataForFp, {}),
      structuredUserInfo: buildPolishedStructuredUserInfo({
        skillDomains: [],
        skills: reviewPayload.structuredUserInfo.skills,
        skillsInDevelopment: [],
        keyResponsibilities: reviewPayload.structuredUserInfo.keyResponsibilities,
        domains: reviewPayload.structuredUserInfo.domains,
      }),
      who_are_you: {
        ...buildPolishedWhoAreYou(buildWhoAreYouRawAnswersFromIdentity(reviewPayload.userIdentity)),
        identity_embedding_text: 'Cached identity embedding text for matching.',
      },
    });
    const created = await User.create({
      email: 'review-save-cv-cache@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        structuredUserInfo: {},
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [
          {
            _id: docId,
            extractionStatus: 'completed',
            extractedProfileData: extractedProfile,
            narrativeEnrichment,
          },
        ],
      },
    });

    generateDimensionSummary.mockClear();
    scheduleDeferredProfileNarrativesForUser.mockClear();
    generateWhoAreYouNarratives.mockClear();

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: {
        ...reviewPayload,
        documentId: docId,
        acceptedFields: {},
      },
    };
    const res = mockRes();
    await profileController.saveProfileReview(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(generateWhoAreYouNarratives).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).not.toHaveBeenCalled();

    const payload = res.json.mock.calls[0][0];
    expect(payload.narrativesReady).toBe(true);
    const narratives = JSON.parse(payload.who_are_you.summary_text);
    expect(narratives[0]).toContain('clarify problems early');
  });
});

describe('profileController.saveProfileReview narrative cache fast path', () => {
  test('skips dimension and who LLM when document cache fingerprint matches', async () => {
    const docId = '507f1f77bcf86cd799439011';
    const identity = reviewPayload.userIdentity;
    const extractedProfile = {
      userIdentity: identity,
      structuredUserInfo: {
        skillDomains: [],
        skills: reviewPayload.structuredUserInfo.skills.map((name) => ({ name })),
        domains: reviewPayload.structuredUserInfo.domains,
        keyResponsibilities: reviewPayload.structuredUserInfo.keyResponsibilities,
        skillsInDevelopment: [],
      },
    };
    const { computeNarrativeSourceFingerprint } = require('../services/profile/extractionNarrativeEnrichmentService');
    const profileDataForFp = {
      userIdentity: identity,
      structuredUserInfo: {
        ...extractedProfile.structuredUserInfo,
        ...reviewPayload.structuredUserInfo,
      },
    };
    const fingerprint = computeNarrativeSourceFingerprint(profileDataForFp, {});
    const narrativeEnrichment = stampQualityEnrichment({
      fingerprint,
      structuredUserInfo: buildPolishedStructuredUserInfo({
        skillDomains: [],
        skills: reviewPayload.structuredUserInfo.skills,
        skillsInDevelopment: [],
        keyResponsibilities: reviewPayload.structuredUserInfo.keyResponsibilities,
        domains: reviewPayload.structuredUserInfo.domains,
      }),
      who_are_you: buildPolishedWhoAreYou(Object.values(identity)),
    });

    const created = await User.create({
      email: 'review-save-fast-path@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        structuredUserInfo: {},
        documents: [
          {
            _id: docId,
            type: 'resume',
            name: 'cv.pdf',
            extractedProfileData: extractedProfile,
            narrativeEnrichment,
          },
        ],
      },
    });

    generateDimensionSummary.mockClear();
    generateWhoAreYouNarratives.mockClear();

    await profileController.saveProfileReview(
      {
        user: { userId: String(created._id) },
        language: 'en',
        body: { ...reviewPayload, documentId: docId, acceptedFields: {} },
      },
      mockRes()
    );

    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(generateWhoAreYouNarratives).not.toHaveBeenCalled();
  });
});

describe('profileController.getProfileNarrativesStatus', () => {
  test('reports ready when display narratives are populated', async () => {
    const created = await User.create({
      email: 'narratives-status@example.com',
      password: 'password123!',
      profile: buildProfileWithExistingNarratives(),
    });

    const req = { user: { userId: String(created._id) }, language: 'en' };
    const res = mockRes();
    await profileController.getProfileNarrativesStatus(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.ready).toBe(true);
    expect(payload.pending).toEqual([]);
  });

  test('schedules deferred generation when display narratives are still placeholders', async () => {
    const created = await User.create({
      email: 'narratives-status-pending@example.com',
      password: 'password123!',
      profile: {
        userIdentityAnswers: {
          workEnjoyMost: 'Building products',
        },
        who_are_you: {
          raw_answers: ['Building products', '', '', '', ''],
          summary_text: JSON.stringify(Array(5).fill('No personal profile information available yet.')),
        },
        structuredUserInfo: {
          skills: {
            raw_items: ['Python'],
            summary_text: 'No information available yet',
          },
        },
      },
    });

    const req = { user: { userId: String(created._id) }, language: 'en' };
    const res = mockRes();
    await profileController.getProfileNarrativesStatus(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.ready).toBe(false);
    expect(payload.pending).toEqual(expect.arrayContaining(['who_are_you', 'structuredUserInfo.skills']));
    expect(scheduleDeferredProfileNarrativesForUser).toHaveBeenCalled();
  });
});

const profileReviewSaveService = require('../services/profile/profileReviewSaveService');

describe('saveProfileReview narrative regeneration', () => {
  const {
    buildMergedStructuredPayloadForNormalization,
    canReuseDimensionNarrative,
  } = profileReviewSaveService;
  beforeEach(() => {
    clearProfileResponseCache();
    jest.clearAllMocks();
  });

  test('overlay preserves domain narratives after User persist roundtrip', async () => {
    const created = await User.create({
      email: 'review-save-overlay-roundtrip@example.com',
      password: 'password123!',
      profile: buildProfileWithExistingNarratives(),
    });
    const user = await User.findById(created._id);
    const existingStructured =
      user.profile.structuredUserInfo && typeof user.profile.structuredUserInfo.toObject === 'function'
        ? user.profile.structuredUserInfo.toObject()
        : user.profile.structuredUserInfo;
    expect(canReuseDimensionNarrative(existingStructured.domains)).toBe(true);
    const merged = buildMergedStructuredPayloadForNormalization(
      existingStructured,
      {
        skills: ['SQL'],
        domains: ['Finance'],
        keyResponsibilities: ['Own API design'],
        skillDomains: [],
        skillsInDevelopment: [],
      },
      'merge'
    );
    expect(merged.domains).toMatchObject({
      raw_items: ['Finance'],
      summary_text: expect.objectContaining({
        translations: { en: POLISHED_SUMMARIES.domains },
      }),
    });
  });

  test('merge with unchanged structured lists does not re-call narrative generators', async () => {
    const created = await User.create({
      email: 'review-save-skip-llm-merge@example.com',
      password: 'password123!',
      profile: buildProfileWithExistingNarratives(),
    });

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: {
        mode: 'merge',
        seniority: {
          ...reviewPayload.seniority,
          yearsOfExperience: 6,
        },
        userIdentity: reviewPayload.userIdentity,
        structuredUserInfo: {
          skills: ['SQL'],
          domains: ['Finance'],
          keyResponsibilities: ['Own API design'],
          skillDomains: [],
          skillsInDevelopment: [],
        },
      },
    };
    const res = mockRes();

    await profileController.saveProfileReview(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(generateWhoAreYouNarratives).not.toHaveBeenCalled();
    expect(generateWhoAreYouIdentityEmbeddingText).not.toHaveBeenCalled();

    const persisted = await User.findById(created._id).lean();
    expect(persisted.profile.seniority.yearsOfExperience).toBe(6);
    expect(persisted.profile.structuredUserInfo.skills.summary_text.translations.en).toBe(
      POLISHED_SUMMARIES.skills
    );
  });

  test('replace with unchanged structured lists does not re-call narrative generators', async () => {
    const created = await User.create({
      email: 'review-save-skip-llm-replace@example.com',
      password: 'password123!',
      profile: buildProfileWithExistingNarratives(),
    });

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: {
        mode: 'replace',
        seniority: reviewPayload.seniority,
        userIdentity: reviewPayload.userIdentity,
        structuredUserInfo: {
          skills: ['SQL'],
          domains: ['Finance'],
          keyResponsibilities: ['Own API design'],
          skillDomains: [],
          skillsInDevelopment: [],
        },
      },
    };
    const res = mockRes();

    await profileController.saveProfileReview(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(generateWhoAreYouNarratives).not.toHaveBeenCalled();
    expect(generateWhoAreYouIdentityEmbeddingText).not.toHaveBeenCalled();
  });

  test('merge that changes a structured list still regenerates that dimension', async () => {
    const created = await User.create({
      email: 'review-save-regen-merge@example.com',
      password: 'password123!',
      profile: buildProfileWithExistingNarratives(),
    });

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: {
        mode: 'merge',
        seniority: reviewPayload.seniority,
        userIdentity: reviewPayload.userIdentity,
        structuredUserInfo: {
          skills: ['SQL', 'Python'],
        },
      },
    };
    const res = mockRes();

    await profileController.saveProfileReview(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).toHaveBeenCalled();
    const persisted = await User.findById(created._id).lean();
    expect(persisted.profile.structuredUserInfo.skills.raw_items).toEqual(
      expect.arrayContaining(['SQL', 'Python'])
    );
  });
});
