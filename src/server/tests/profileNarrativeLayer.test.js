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

const { clearProfileResponseCache } = require('../services/profileGetResponseCache');
const profileController = require('../controllers/profileController');
const { scheduleDeferredProfileNarrativesForUser } = require('../services/profile/deferredProfileNarrativeService');
const { generateDimensionSummary } = require('../services/jobAnalysis/dimensionSummaryGenerator');
const { generateWhoAreYouNarratives } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
const { generateWhoAreYouIdentityEmbeddingText } = require('../services/jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator');
const { buildPolishedStructuredUserInfo, buildPolishedWhoAreYou } = require('./helpers/narrativeCacheFixtures');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('profileController narrative layer', () => {
  beforeEach(() => {
    clearProfileResponseCache();
  });

  test('getProfile defers LLM narrative generation and schedules background backfill', async () => {
    scheduleDeferredProfileNarrativesForUser.mockClear();
    generateDimensionSummary.mockClear();

    const created = await User.create({
      email: 'narrative-backfill@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        structuredUserInfo: {
          skills: { raw_items: ['SQL', 'Data modeling'], summary_text: { en: '', de: null } },
          keyResponsibilities: { raw_items: ['Built reporting pipelines'], summary_text: { en: '', de: null } },
          domains: { raw_items: ['Analytics'], summary_text: { en: '', de: null } },
        },
        careerSimulationInputs: {
          structuredUserInfo: {
            skills: { raw_items: ['Python'], summary_text: { en: '', de: null } },
            domains: { raw_items: ['Data'], summary_text: { en: '', de: null } },
          },
        },
        documents: [],
      },
    });

    const req = { user: { userId: String(created._id) }, language: 'de' };
    const res = mockRes();
    await profileController.getProfile(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.completion).toEqual(
      expect.objectContaining({
        overall: expect.any(Number),
        seniority: expect.any(Number),
        structuredUserInfo: expect.any(Number),
        userIdentity: expect.any(Number),
        documents: expect.any(Number),
      })
    );

    const profileStructured = JSON.parse(JSON.stringify(payload.profile.structuredUserInfo));
    const csiStructured = JSON.parse(
      JSON.stringify(payload.profile.careerSimulationInputs.structuredUserInfo)
    );
    expect(profileStructured.skills.raw_items).toEqual(['SQL', 'Data modeling']);
    expect(profileStructured.keyResponsibilities.raw_items).toEqual(['Built reporting pipelines']);
    expect(csiStructured.skills.raw_items).toEqual(['Python']);
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).toHaveBeenCalledTimes(1);
    const [scheduledUserId, scheduledOptions] = scheduleDeferredProfileNarrativesForUser.mock.calls[0];
    expect(String(scheduledUserId)).toBe(String(created._id));
    expect(scheduledOptions).toMatchObject({
      deferWhoAreYou: false,
      language: 'de',
      sourceLanguage: 'en',
    });
    expect(scheduledOptions.dimensionKeys).toEqual(
      expect.arrayContaining(['skills', 'keyResponsibilities', 'domains'])
    );

    const persisted = await User.findById(created._id).lean();
    expect(persisted.profile.structuredUserInfo.skills.summary_text).toEqual({ en: '', de: null });
    expect(persisted.profile.structuredUserInfo.keyResponsibilities.summary_text).toEqual({ en: '', de: null });
  });

  test('updateStructuredUserInfo defers narrative generation from raw arrays', async () => {
    const created = await User.create({
      email: 'narrative-update@example.com',
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
      language: 'de',
      body: {
        skillDomains: ['Strategic thinking'],
        skills: ['Stakeholder management', 'Roadmapping'],
        skillsInDevelopment: ['ML product strategy'],
        keyResponsibilities: ['Led cross-functional delivery'],
        domains: ['Product'],
      },
    };
    const res = mockRes();

    scheduleDeferredProfileNarrativesForUser.mockClear();
    generateDimensionSummary.mockClear();

    await profileController.updateStructuredUserInfo(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.narrativesReady).toBe(false);
    expect(payload.narrativePending).toEqual(
      expect.arrayContaining([
        'structuredUserInfo.skillDomains',
        'structuredUserInfo.skills',
        'structuredUserInfo.skillsInDevelopment',
        'structuredUserInfo.keyResponsibilities',
        'structuredUserInfo.domains',
      ])
    );
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).toHaveBeenCalledWith(
      String(created._id),
      expect.objectContaining({
        dimensionKeys: expect.arrayContaining(['skills', 'domains', 'keyResponsibilities']),
        language: 'de',
      })
    );
    const structuredResponse = JSON.parse(JSON.stringify(payload.structuredUserInfo));
    expect(structuredResponse.skills.raw_items).toEqual(['Stakeholder management', 'Roadmapping']);
    expect(typeof structuredResponse.skills.summary_text).toBe('object');
    expect(typeof structuredResponse.skills.summary_text.original_language).toBe('string');
    expect(typeof structuredResponse.skills.summary_text.translations).toBe('object');
    expect(structuredResponse.domains.raw_items).toEqual(['Product']);
    expect(typeof structuredResponse.domains.summary_text).toBe('object');
    expect(typeof structuredResponse.domains.summary_text.original_language).toBe('string');
    expect(typeof structuredResponse.domains.summary_text.translations).toBe('object');

    const persisted = await User.findById(created._id).lean();
    expect(persisted.profile.structuredUserInfo.keyResponsibilities.raw_items).toEqual([
      'Led cross-functional delivery',
    ]);
    expect(typeof persisted.profile.structuredUserInfo.keyResponsibilities.summary_text).toBe('object');
    expect(typeof persisted.profile.structuredUserInfo.keyResponsibilities.summary_text.original_language).toBe('string');
    expect(typeof persisted.profile.structuredUserInfo.keyResponsibilities.summary_text.translations).toBe('object');
    // Recalculated duplicate layer should also carry narrative shape.
    expect(persisted.profile.careerSimulationInputs.structuredUserInfo.skills.raw_items).toEqual([
      'Stakeholder management',
      'Roadmapping',
    ]);
  });

  test('updateUserIdentity stores who_are_you raw answers and defers narrative generation', async () => {
    const created = await User.create({
      email: 'who-are-you-update@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        cvExtractLocalization: { documentLanguage: 'de' },
        structuredUserInfo: {},
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });

    const req = {
      user: { userId: String(created._id) },
      language: 'de',
      body: {
        workEnjoyMost: 'Solving practical product problems',
        topicsIndustriesInterest: 'Health tech and education',
        naturallyGoodAt: 'Turning ambiguity into clear plans',
        workEnvironmentFit: 'Calm teams with shared ownership',
        workingLifeAchievement: 'Build products that improve access',
      },
    };
    const res = mockRes();

    scheduleDeferredProfileNarrativesForUser.mockClear();
    generateWhoAreYouNarratives.mockClear();
    generateWhoAreYouIdentityEmbeddingText.mockClear();

    await profileController.updateUserIdentity(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.narrativesReady).toBe(false);
    expect(payload.narrativePending).toEqual(['who_are_you']);
    expect(generateWhoAreYouNarratives).not.toHaveBeenCalled();
    expect(generateWhoAreYouIdentityEmbeddingText).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).toHaveBeenCalledWith(
      String(created._id),
      expect.objectContaining({
        deferWhoAreYou: true,
        language: 'de',
      })
    );
    const payloadWhoAreYou = JSON.parse(JSON.stringify(payload.who_are_you || {}));
    expect(Array.isArray(payloadWhoAreYou.raw_answers)).toBe(true);
    expect(payloadWhoAreYou.raw_answers).toHaveLength(5);
    expect(typeof payloadWhoAreYou.summary_text).toBe('string');
    const parsedPayloadSummary = JSON.parse(payloadWhoAreYou.summary_text);
    expect(Array.isArray(parsedPayloadSummary)).toBe(true);
    expect(parsedPayloadSummary).toHaveLength(5);
    const persisted = await User.findById(created._id).lean();
    expect(Array.isArray(persisted.profile.who_are_you.raw_answers)).toBe(true);
    expect(persisted.profile.who_are_you.raw_answers).toHaveLength(5);
    const persistedSummary = persisted.profile.who_are_you.summary_text;
    expect(typeof persistedSummary).toBe('object');
    const deSummaryRaw =
      persistedSummary.translations?.de ||
      persistedSummary.translations?.en ||
      persistedSummary.original;
    const parsedDeSummary = JSON.parse(deSummaryRaw);
    expect(Array.isArray(parsedDeSummary)).toBe(true);
    expect(parsedDeSummary).toHaveLength(5);
    if (typeof persistedSummary.translations?.en === 'string' && persistedSummary.translations.en.trim()) {
      const parsedEnSummary = JSON.parse(persistedSummary.translations.en);
      if (Array.isArray(parsedEnSummary)) {
        expect(parsedEnSummary).toHaveLength(5);
      }
    }
    expect(payloadWhoAreYou.summary_text).toBe(
      persistedSummary.translations?.de ||
      persistedSummary.translations?.en ||
      persistedSummary.original
    );
  });

  test('updateStructuredUserInfo reuses unchanged dimension narratives on partial edit', async () => {
    const lists = {
      skillDomains: ['Strategic thinking'],
      skills: ['Stakeholder management', 'Roadmapping'],
      skillsInDevelopment: [],
      keyResponsibilities: ['Led cross-functional delivery'],
      domains: ['Product'],
    };
    const created = await User.create({
      email: 'narrative-partial-update@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        structuredUserInfo: buildPolishedStructuredUserInfo(lists),
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });

    generateDimensionSummary.mockClear();
    scheduleDeferredProfileNarrativesForUser.mockClear();

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: {
        ...lists,
        skills: ['Stakeholder management', 'Roadmapping', 'Facilitation'],
      },
    };
    const res = mockRes();

    await profileController.updateStructuredUserInfo(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).toHaveBeenCalledWith(
      String(created._id),
      expect.objectContaining({
        dimensionKeys: ['skills'],
        language: 'en',
      })
    );
    expect(res.json.mock.calls[0][0].narrativesReady).toBe(false);

    const persisted = await User.findById(created._id).lean();
    expect(persisted.profile.structuredUserInfo.skills.raw_items).toEqual([
      'Stakeholder management',
      'Roadmapping',
      'Facilitation',
    ]);
    expect(persisted.profile.structuredUserInfo.skillDomains.summary_text).toEqual(
      buildPolishedStructuredUserInfo(lists).skillDomains.summary_text
    );
  });

  test('updateStructuredUserInfo skips narrative work for minor list edits', async () => {
    const lists = {
      skillDomains: ['Strategic thinking'],
      skills: ['Stakeholder management', 'Roadmapping'],
      skillsInDevelopment: [],
      keyResponsibilities: ['Led cross-functional delivery'],
      domains: ['Product'],
    };
    const created = await User.create({
      email: 'structured-minor-edit@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        structuredUserInfo: buildPolishedStructuredUserInfo(lists),
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });

    scheduleDeferredProfileNarrativesForUser.mockClear();
    generateDimensionSummary.mockClear();

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: {
        ...lists,
        skills: ['Stakeholder management', 'Road-mapping'],
      },
    };
    const res = mockRes();

    await profileController.updateStructuredUserInfo(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateDimensionSummary).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].narrativesReady).toBe(true);
  });

  test('updateUserIdentity skips narrative work for minor identity edits', async () => {
    const identityBody = {
      workEnjoyMost: 'Solving practical product problems',
      topicsIndustriesInterest: 'Health tech and education',
      naturallyGoodAt: 'Turning ambiguity into clear plans',
      workEnvironmentFit: 'Calm teams with shared ownership',
      workingLifeAchievement: 'Build products that improve access',
    };
    const created = await User.create({
      email: 'who-are-you-minor-edit@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        userIdentityAnswers: identityBody,
        who_are_you: buildPolishedWhoAreYou(Object.values(identityBody)),
        structuredUserInfo: {},
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });

    scheduleDeferredProfileNarrativesForUser.mockClear();
    generateWhoAreYouNarratives.mockClear();

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: {
        ...identityBody,
        workEnjoyMost: 'Solving practical product problem',
      },
    };
    const res = mockRes();

    await profileController.updateUserIdentity(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.identityEditMagnitude).toBe('minor');
    expect(payload.narrativesReady).toBe(true);
    expect(payload.narrativePending).toEqual([]);
    expect(generateWhoAreYouNarratives).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).not.toHaveBeenCalled();
    expect(payload.userIdentity.workEnjoyMost).toBe('Solving practical product problem');
    expect(JSON.parse(payload.who_are_you.summary_text)[0]).toBe('Solving practical product problem');
  });

  test('updateUserIdentity clears stale localized narratives and returns saved answers', async () => {
    const identityBody = {
      workEnjoyMost: 'Solving practical product problems',
      topicsIndustriesInterest: 'Health tech and education',
      naturallyGoodAt: 'Turning ambiguity into clear plans',
      workEnvironmentFit: 'Calm teams with shared ownership',
      workingLifeAchievement: 'Build products that improve access',
    };
    const polishedWhoAreYou = buildPolishedWhoAreYou(Object.values(identityBody));
    const staleEnglishNarratives = JSON.stringify([
      'STALE EN narrative line one that should not survive a profile edit save.',
      'STALE EN narrative line two that should not survive a profile edit save.',
      'STALE EN narrative line three that should not survive a profile edit save.',
      'STALE EN narrative line four that should not survive a profile edit save.',
      'STALE EN narrative line five that should not survive a profile edit save.',
    ]);
    polishedWhoAreYou.summary_text = {
      ...polishedWhoAreYou.summary_text,
      translations: {
        ...polishedWhoAreYou.summary_text.translations,
        en: staleEnglishNarratives,
      },
    };

    const created = await User.create({
      email: 'who-are-you-stale-translation@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        userIdentityAnswers: identityBody,
        who_are_you: polishedWhoAreYou,
        structuredUserInfo: {},
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });

    const updatedBody = {
      ...identityBody,
      workEnjoyMost: 'I lead platform strategy for growth-stage SaaS companies and mentor product teams.',
    };
    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: updatedBody,
    };
    const res = mockRes();

    await profileController.updateUserIdentity(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.userIdentity.workEnjoyMost).toBe(updatedBody.workEnjoyMost);
    expect(payload.who_are_you.raw_answers[0]).toBe(updatedBody.workEnjoyMost);
    expect(payload.identityEditMagnitude).toBe('major');
    expect(payload.narrativesReady).toBe(false);

    const parsedSummary = JSON.parse(payload.who_are_you.summary_text);
    expect(parsedSummary[0]).toBe('No personal profile information available yet.');

    const persisted = await User.findById(created._id).lean();
    expect(persisted.profile.userIdentityAnswers.workEnjoyMost).toBe(updatedBody.workEnjoyMost);
    const persistedEnSummary = persisted.profile.who_are_you.summary_text.translations.en;
    expect(JSON.parse(persistedEnSummary)[0]).toBe('No personal profile information available yet.');
  });

  test('updateUserIdentity skips narrative LLM when answers are unchanged', async () => {
    const identityBody = {
      workEnjoyMost: 'Solving practical product problems',
      topicsIndustriesInterest: 'Health tech and education',
      naturallyGoodAt: 'Turning ambiguity into clear plans',
      workEnvironmentFit: 'Calm teams with shared ownership',
      workingLifeAchievement: 'Build products that improve access',
    };
    const created = await User.create({
      email: 'who-are-you-unchanged@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        userIdentityAnswers: identityBody,
        who_are_you: {
          ...buildPolishedWhoAreYou(Object.values(identityBody)),
          raw_answers: Object.values(identityBody),
          identity_embedding_text: 'Cached identity embedding text for unchanged profile save.',
        },
        structuredUserInfo: {},
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });

    generateWhoAreYouNarratives.mockClear();
    generateWhoAreYouIdentityEmbeddingText.mockClear();

    const req = {
      user: { userId: String(created._id) },
      language: 'en',
      body: identityBody,
    };
    const res = mockRes();

    scheduleDeferredProfileNarrativesForUser.mockClear();

    await profileController.updateUserIdentity(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateWhoAreYouNarratives).not.toHaveBeenCalled();
    expect(generateWhoAreYouIdentityEmbeddingText).not.toHaveBeenCalled();
    expect(scheduleDeferredProfileNarrativesForUser).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].narrativesReady).toBe(true);
  });

  test('getProfile serializes embedded documents and omits internal narrativeEnrichment blob', async () => {
    const created = await User.create({
      email: 'profile-docs-serialize@example.com',
      password: 'password123!',
      profile: {
        personalInfo: {},
        structuredUserInfo: {},
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [{
          type: 'resume',
          name: 'cv.pdf',
          path: '/uploads/cv.pdf',
          uploadDate: new Date('2024-01-15T00:00:00.000Z'),
          description: 'My CV',
          status: 'complete',
          extractionStatus: 'complete',
          extractedProfileData: { userIdentity: { q1: 'answer' }, structuredUserInfo: {} },
          narrativeEnrichment: {
            dimensions: { skills: { summary_text: 'internal-only narrative cache' } },
            who_are_you: { summary_text: 'should not leak' },
          },
          narrativeEnrichmentStatus: 'complete',
          identityEnrichmentStatus: 'complete',
        }],
      },
    });

    const req = { user: { userId: String(created._id) }, language: 'en' };
    const res = mockRes();
    await profileController.getProfile(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.profile.documents).toHaveLength(1);

    const doc = payload.profile.documents[0];
    expect(doc.id).toBeDefined();
    expect(doc.name).toBe('cv.pdf');
    expect(doc.description).toBe('My CV');
    expect(doc.extractionStatus).toBe('complete');
    expect(doc.extractedProfileData).toBeUndefined();
    expect(doc.reviewReady).toBe(true);
    expect(doc.narrativeEnrichmentStatus).toBe('complete');
    expect(doc.narrativeEnrichment).toBeUndefined();
    expect(doc.identityEnrichmentStatus).toBeUndefined();
    expect(doc._id).toBeUndefined();
  });
});

