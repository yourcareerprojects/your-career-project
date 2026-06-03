const {
  resolveNarrativeWarmDelta,
  computeNarrativeSourceFingerprint,
} = require('../services/profile/extractionNarrativeEnrichmentService');
const {
  buildPolishedStructuredUserInfo,
  buildPolishedWhoAreYou,
  stampQualityEnrichment,
} = require('./helpers/narrativeCacheFixtures');

describe('extractionNarrativeEnrichmentService.resolveNarrativeWarmDelta', () => {
  const baseIdentity = {
    workEnjoyMost: 'Building',
    topicsIndustriesInterest: 'Tech',
    naturallyGoodAt: 'Code',
    workEnvironmentFit: 'Remote',
    workingLifeAchievement: 'Shipped',
  };

  const baseLists = {
    skillDomains: ['Engineering'],
    skills: ['JavaScript'],
    skillsInDevelopment: [],
    keyResponsibilities: ['Design APIs'],
    domains: ['Software'],
  };

  function buildEnrichment(identity, lists) {
    const profileData = { userIdentity: identity, structuredUserInfo: lists };
    return stampQualityEnrichment({
      fingerprint: computeNarrativeSourceFingerprint(profileData, {}),
      structuredUserInfo: buildPolishedStructuredUserInfo(lists),
      who_are_you: buildPolishedWhoAreYou(Object.values(identity)),
    });
  }

  test('detects who-only changes when follow-up text is appended to identity', () => {
    const enrichment = buildEnrichment(baseIdentity, baseLists);
    const updatedIdentity = {
      ...baseIdentity,
      workEnjoyMost: `${baseIdentity.workEnjoyMost}\n\nMore detail from follow-up`,
    };
    const delta = resolveNarrativeWarmDelta(
      enrichment,
      { userIdentity: updatedIdentity, structuredUserInfo: baseLists },
      {},
      'en'
    );
    expect(delta.dimensionKeysToRegen).toEqual([]);
    expect(delta.whoChanged).toBe(true);
  });

  test('detects single structured dimension change', () => {
    const enrichment = buildEnrichment(baseIdentity, baseLists);
    const updatedLists = {
      ...baseLists,
      keyResponsibilities: [...baseLists.keyResponsibilities, 'Mentor juniors'],
    };
    const delta = resolveNarrativeWarmDelta(
      enrichment,
      { userIdentity: baseIdentity, structuredUserInfo: updatedLists },
      {},
      'en'
    );
    expect(delta.dimensionKeysToRegen).toEqual(['keyResponsibilities']);
    expect(delta.whoChanged).toBe(false);
  });

  test('flags low-quality cached dimensions for regen', () => {
    const enrichment = stampQualityEnrichment({
      fingerprint: 'x',
      structuredUserInfo: {
        skills: {
          raw_items: ['JavaScript'],
          summary_text: { translations: { en: 'You bring focused experience in JavaScript.' } },
        },
      },
      who_are_you: buildPolishedWhoAreYou(Object.values(baseIdentity)),
    });
    const delta = resolveNarrativeWarmDelta(
      enrichment,
      { userIdentity: baseIdentity, structuredUserInfo: baseLists },
      {},
      'en'
    );
    expect(delta.dimensionKeysToRegen).toContain('skills');
  });
});
