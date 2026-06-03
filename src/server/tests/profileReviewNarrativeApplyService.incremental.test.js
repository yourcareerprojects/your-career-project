const {
  applyReviewSaveNarrativesFromDocument,
} = require('../services/profile/profileReviewNarrativeApplyService');
const {
  computeNarrativeSourceFingerprint,
} = require('../services/profile/extractionNarrativeEnrichmentService');
const { generateWhoAreYouNarratives } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
const {
  buildPolishedStructuredUserInfo,
  buildPolishedWhoAreYou,
  POLISHED_SUMMARIES,
  POLISHED_WHO_LINE,
  stampQualityEnrichment,
} = require('./helpers/narrativeCacheFixtures');

jest.mock('../services/jobAnalysis/whoAreYouNarrativeGenerator', () => ({
  ...jest.requireActual('../services/jobAnalysis/whoAreYouNarrativeGenerator'),
  generateWhoAreYouNarratives: jest.fn(),
}));

describe('applyReviewSaveNarrativesFromDocument incremental', () => {
  const identity = {
    workEnjoyMost: 'Building',
    topicsIndustriesInterest: 'Tech',
    naturallyGoodAt: 'Code',
    workEnvironmentFit: 'Remote',
    workingLifeAchievement: 'Shipped',
  };

  const lists = {
    skillDomains: ['Engineering'],
    skills: ['JavaScript'],
    skillsInDevelopment: [],
    keyResponsibilities: ['Design APIs'],
    domains: ['Software'],
  };

  function buildDoc(bodyIdentity = identity) {
    const profileData = { userIdentity: bodyIdentity, structuredUserInfo: lists };
    const fingerprint = computeNarrativeSourceFingerprint(profileData, {});
    return {
      extractedProfileData: profileData,
      narrativeEnrichment: stampQualityEnrichment({
        fingerprint,
        structuredUserInfo: buildPolishedStructuredUserInfo(lists),
        who_are_you: buildPolishedWhoAreYou(Object.values(identity)),
      }),
    };
  }

  beforeEach(() => {
    generateWhoAreYouNarratives.mockReset();
    generateWhoAreYouNarratives.mockResolvedValue({
      canonical: Array(5).fill(POLISHED_WHO_LINE),
      canonicalLanguage: 'en',
      localized: {},
    });
  });

  test('regenerates only who-are-you when follow-up text changes identity', async () => {
    const doc = buildDoc();
    const updatedIdentity = {
      ...identity,
      workEnjoyMost: `${identity.workEnjoyMost}\n\nFollow-up detail`,
    };
    const body = { userIdentity: updatedIdentity, structuredUserInfo: lists };

    const result = await applyReviewSaveNarrativesFromDocument(
      doc,
      body,
      {},
      updatedIdentity,
      { language: 'en', sourceLanguage: 'en' }
    );

    expect(result.ok).toBe(true);
    expect(['structured_cache_who_delta', 'incremental_cache']).toContain(result.applyMode);
    expect(result.regenDimensions).toEqual([]);
    expect(result.regenWho).toBe(true);
    expect(generateWhoAreYouNarratives).toHaveBeenCalledTimes(1);
    expect(result.structuredUserInfo.skills.summary_text.original).toBe(POLISHED_SUMMARIES.skills);
  });
});
