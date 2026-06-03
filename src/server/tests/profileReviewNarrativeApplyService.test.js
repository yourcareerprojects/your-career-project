const {
  reviewNarrativeFingerprintMatchesDocument,
  tryBuildProfileNarrativesFromDocumentCache,
} = require('../services/profile/profileReviewNarrativeApplyService');
const { PLACEHOLDER: WHO_PLACEHOLDER } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
const { EMPTY_PLACEHOLDER } = require('../services/jobAnalysis/dimensionSummaryGenerator');
const {
  POLISHED_WHO_LINE,
  POLISHED_SUMMARIES,
  narrativeDimension,
  stampQualityEnrichment,
} = require('./helpers/narrativeCacheFixtures');

describe('profileReviewNarrativeApplyService', () => {
  const identity = {
    workEnjoyMost: 'Building products',
    topicsIndustriesInterest: 'Health',
    naturallyGoodAt: 'Analysis',
    workEnvironmentFit: 'Remote',
    workingLifeAchievement: 'Shipped v1',
  };

  const extractedProfileData = {
    userIdentity: identity,
    structuredUserInfo: {
      skills: [{ name: 'JavaScript' }],
      domains: ['Software'],
      keyResponsibilities: ['Ship features'],
      skillDomains: [],
      skillsInDevelopment: [],
    },
  };

  test('fingerprint matches when review body aligns with enrichment snapshot', () => {
    const doc = {
      extractedProfileData,
      narrativeEnrichment: { fingerprint: 'pending' },
    };
    const body = {
      userIdentity: identity,
      structuredUserInfo: {
        skills: ['JavaScript'],
        domains: ['Software'],
        keyResponsibilities: ['Ship features'],
      },
    };
    const { computeNarrativeSourceFingerprint } = require('../services/profile/extractionNarrativeEnrichmentService');
    doc.narrativeEnrichment.fingerprint = computeNarrativeSourceFingerprint(
      {
        userIdentity: identity,
        structuredUserInfo: {
          ...extractedProfileData.structuredUserInfo,
          ...body.structuredUserInfo,
        },
      },
      {}
    );
    expect(reviewNarrativeFingerprintMatchesDocument(doc, body, {})).toBe(true);
  });

  test('tryBuildProfileNarrativesFromDocumentCache copies summaries without placeholders', () => {
    const whoSummary = JSON.stringify(Array(5).fill(POLISHED_WHO_LINE));
    const doc = {
      extractedProfileData,
      narrativeEnrichment: stampQualityEnrichment({
        structuredUserInfo: {
          skillDomains: narrativeDimension([], EMPTY_PLACEHOLDER),
          skills: narrativeDimension(['JavaScript'], POLISHED_SUMMARIES.skills),
          skillsInDevelopment: narrativeDimension([], EMPTY_PLACEHOLDER),
          keyResponsibilities: narrativeDimension(['Ship features'], POLISHED_SUMMARIES.keyResponsibilities),
          domains: narrativeDimension(['Software'], POLISHED_SUMMARIES.domains),
        },
        who_are_you: {
          raw_answers: Object.values(identity),
          summary_text: {
            original_language: 'en',
            original: whoSummary,
            translations: { en: whoSummary },
          },
        },
      }),
    };
    const body = {
      userIdentity: identity,
      structuredUserInfo: {
        skills: ['JavaScript'],
        domains: ['Software'],
        keyResponsibilities: ['Ship features'],
      },
    };
    const { computeNarrativeSourceFingerprint } = require('../services/profile/extractionNarrativeEnrichmentService');
    doc.narrativeEnrichment.fingerprint = computeNarrativeSourceFingerprint(
      {
        userIdentity: identity,
        structuredUserInfo: {
          ...extractedProfileData.structuredUserInfo,
          ...body.structuredUserInfo,
        },
      },
      {}
    );

    const result = tryBuildProfileNarrativesFromDocumentCache(doc, body, {}, identity, 'en');
    expect(result.ok).toBe(true);
    expect(result.structuredUserInfo.skills.raw_items).toEqual(['JavaScript']);
    expect(result.structuredUserInfo.skills.summary_text.translations.en).toContain('JavaScript');
    expect(result.who_are_you.raw_answers).toHaveLength(5);
    const parsed = JSON.parse(result.who_are_you.summary_text.translations.en);
    expect(parsed[0]).toBe(POLISHED_WHO_LINE);
    expect(parsed[0]).not.toBe(WHO_PLACEHOLDER);
  });

  test('tryBuildProfileNarrativesFromDocumentCache rejects low-quality deterministic cache', () => {
    const doc = {
      extractedProfileData,
      narrativeEnrichment: {
        qualityVersion: 1,
        fingerprint: 'unused',
        structuredUserInfo: {
          skillDomains: narrativeDimension([], EMPTY_PLACEHOLDER),
          skills: narrativeDimension(['JavaScript'], 'You bring focused experience in JavaScript.'),
          skillsInDevelopment: narrativeDimension([], EMPTY_PLACEHOLDER),
          keyResponsibilities: narrativeDimension([], EMPTY_PLACEHOLDER),
          domains: narrativeDimension([], EMPTY_PLACEHOLDER),
        },
        who_are_you: {
          raw_answers: Object.values(identity),
          summary_text: {
            original_language: 'en',
            original: JSON.stringify(Array(5).fill('You describe yourself as Building products.')),
            translations: {
              en: JSON.stringify(Array(5).fill('You describe yourself as Building products.')),
            },
          },
        },
      },
    };
    const body = {
      userIdentity: identity,
      structuredUserInfo: { skills: ['JavaScript'] },
    };
    const result = tryBuildProfileNarrativesFromDocumentCache(doc, body, {}, identity, 'en');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('cache_not_ready');
  });
});
