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

jest.mock('../services/embedding/userOccupationInference', () => ({
  inferIscoFromDomains: jest.fn(async () => ({ inferred: [], methodUsed: 'rule_based' })),
}));

const { clearProfileResponseCache } = require('../services/profileGetResponseCache');
const profileController = require('../controllers/profileController');
const { generateDimensionSummary } = require('../services/jobAnalysis/dimensionSummaryGenerator');
const { generateWhoAreYouNarratives } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
const { generateWhoAreYouIdentityEmbeddingText } = require('../services/jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator');

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

  test('getProfile lazy-backfills missing summary_text for narrative dimensions', async () => {
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

    const profileStructured = JSON.parse(JSON.stringify(payload.profile.structuredUserInfo));
    const csiStructured = JSON.parse(
      JSON.stringify(payload.profile.careerSimulationInputs.structuredUserInfo)
    );
    expect(profileStructured.skills.raw_items).toEqual(['SQL', 'Data modeling']);
    expect(typeof profileStructured.skills.summary_text).toBe('string');
    expect(profileStructured.skills.summary_text.length).toBeGreaterThan(0);
    expect(profileStructured.keyResponsibilities.raw_items).toEqual(['Built reporting pipelines']);
    expect(typeof profileStructured.keyResponsibilities.summary_text).toBe('string');
    expect(profileStructured.keyResponsibilities.summary_text.length).toBeGreaterThan(0);
    expect(csiStructured.skills.raw_items).toEqual(['Python']);
    expect(typeof csiStructured.skills.summary_text).toBe('string');
    expect(csiStructured.skills.summary_text.length).toBeGreaterThan(0);
    expect(generateDimensionSummary).toHaveBeenCalled();

    const persisted = await User.findById(created._id).lean();
    expect(persisted.profile.structuredUserInfo.skills.raw_items).toEqual(['SQL', 'Data modeling']);
    expect(typeof persisted.profile.structuredUserInfo.skills.summary_text).toBe('object');
    expect(typeof persisted.profile.structuredUserInfo.skills.summary_text.original_language).toBe('string');
    expect(typeof persisted.profile.structuredUserInfo.skills.summary_text.translations).toBe('object');
    expect(
      typeof persisted.profile.structuredUserInfo.skills.summary_text.translations.en === 'string' ||
      typeof persisted.profile.structuredUserInfo.skills.summary_text.translations.de === 'string'
    ).toBe(true);
  });

  test('updateStructuredUserInfo regenerates narrative summaries from raw arrays', async () => {
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

    await profileController.updateStructuredUserInfo(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
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
    expect(generateDimensionSummary).toHaveBeenCalled();
  });

  test('updateUserIdentity stores who_are_you raw answers and generated summary text', async () => {
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

    await profileController.updateUserIdentity(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    const payloadWhoAreYou = JSON.parse(JSON.stringify(payload.who_are_you || {}));
    expect(Array.isArray(payloadWhoAreYou.raw_answers)).toBe(true);
    expect(payloadWhoAreYou.raw_answers).toHaveLength(5);
    expect(typeof payloadWhoAreYou.summary_text).toBe('string');
    const parsedPayloadSummary = JSON.parse(payloadWhoAreYou.summary_text);
    expect(Array.isArray(parsedPayloadSummary)).toBe(true);
    expect(parsedPayloadSummary).toHaveLength(5);
    expect(generateWhoAreYouNarratives).toHaveBeenCalled();

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
    expect(generateWhoAreYouIdentityEmbeddingText).toHaveBeenCalled();
  });
});

