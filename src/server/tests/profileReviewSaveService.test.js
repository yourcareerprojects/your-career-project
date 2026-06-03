const {
  buildMergedStructuredPayload,
  buildMergedStructuredPayloadForNormalization,
  buildMergedUserIdentity,
  buildStructuredBaselineFromExtraction,
  resolveDeferDimensionKeysForExtraction,
  userIdentityMatchesExtraction,
  mergeUniqueStrings,
  normalizeSeniorityFields,
  verifySeniorityPersisted,
} = require('../services/profile/profileReviewSaveService');
const {
  POLISHED_SUMMARIES,
  narrativeSummaryField,
  stampQualityEnrichment,
} = require('./helpers/narrativeCacheFixtures');

describe('profileReviewSaveService', () => {
  test('mergeUniqueStrings deduplicates and trims', () => {
    expect(mergeUniqueStrings([' A ', 'b'], ['b', 'c'])).toEqual(['A', 'b', 'c']);
  });

  test('buildMergedStructuredPayload merges lists in merge mode', () => {
    const existing = {
      skills: { raw_items: ['SQL'] },
      domains: { raw_items: ['Finance'] },
    };
    const incoming = {
      skills: ['Python', 'SQL'],
      domains: ['Health'],
    };
    const merged = buildMergedStructuredPayload(existing, incoming, 'merge');
    expect(merged.skills).toEqual(['SQL', 'Python']);
    expect(merged.domains).toEqual(['Finance', 'Health']);
  });

  test('buildMergedStructuredPayload replaces lists in replace mode', () => {
    const existing = {
      skills: { raw_items: ['SQL'] },
    };
    const incoming = { skills: ['Python'] };
    const merged = buildMergedStructuredPayload(existing, incoming, 'replace');
    expect(merged.skills).toEqual(['Python']);
  });

  test('buildMergedStructuredPayloadForNormalization reuses summary_text when raw_items unchanged', () => {
    const existingSummary = narrativeSummaryField(POLISHED_SUMMARIES.skills);
    const existing = {
      skills: { raw_items: ['SQL'], summary_text: existingSummary },
      domains: {
        raw_items: ['Finance'],
        summary_text: narrativeSummaryField(POLISHED_SUMMARIES.domains),
      },
    };
    const normalized = buildMergedStructuredPayloadForNormalization(
      existing,
      { skills: ['SQL'], domains: ['Finance'] },
      'merge'
    );
    expect(normalized.skills).toEqual({
      raw_items: ['SQL'],
      summary_text: existingSummary,
    });
    expect(normalized.domains.raw_items).toEqual(['Finance']);
    expect(normalized.domains.summary_text.translations.en).toBe(POLISHED_SUMMARIES.domains);
  });

  test('buildMergedStructuredPayloadForNormalization applies extraction narrative cache for reuse keys', () => {
    const cachedSummary = narrativeSummaryField(POLISHED_SUMMARIES.skills);
    const normalized = buildMergedStructuredPayloadForNormalization(
      {},
      { skills: ['SQL'] },
      'replace',
      {
        extractionNarrativeCache: stampQualityEnrichment({
          structuredUserInfo: {
            skills: { raw_items: ['SQL'], summary_text: cachedSummary },
          },
        }),
        reuseExtractionNarrativeKeys: ['skills'],
      }
    );
    expect(normalized.skills).toEqual({
      raw_items: ['SQL'],
      summary_text: cachedSummary,
    });
  });

  test('buildMergedStructuredPayloadForNormalization passes plain arrays when lists change', () => {
    const existing = {
      skills: { raw_items: ['SQL'], summary_text: narrativeSummaryField(POLISHED_SUMMARIES.skills) },
    };
    const normalized = buildMergedStructuredPayloadForNormalization(
      existing,
      { skills: ['SQL', 'Python'] },
      'merge'
    );
    expect(normalized.skills).toEqual(['SQL', 'Python']);
  });

  test('buildMergedUserIdentity prefers incoming in merge mode when present', () => {
    const merged = buildMergedUserIdentity(
      { workEnjoyMost: 'Existing answer' },
      { workEnjoyMost: 'New answer' },
      'merge'
    );
    expect(merged.workEnjoyMost).toBe('New answer');
  });

  test('buildMergedUserIdentity keeps existing in merge mode when incoming empty', () => {
    const merged = buildMergedUserIdentity(
      { workEnjoyMost: 'Existing answer' },
      { workEnjoyMost: '' },
      'merge'
    );
    expect(merged.workEnjoyMost).toBe('Existing answer');
  });

  test('normalizeSeniorityFields parses years of experience', () => {
    expect(normalizeSeniorityFields({
      currentStatus: 'employed',
      yearsOfExperience: '3',
      highestDegree: 'bachelor',
      mostSeniorWorkExperience: 'mid_level',
    })).toEqual({
      currentStatus: 'employed',
      yearsOfExperience: 3,
      highestDegree: 'bachelor',
      mostSeniorWorkExperience: 'mid_level',
    });
  });

  test('verifySeniorityPersisted detects mismatch', () => {
    expect(verifySeniorityPersisted(
      { currentStatus: 'employed', yearsOfExperience: 1, highestDegree: 'bachelor', mostSeniorWorkExperience: 'entry_level' },
      { currentStatus: 'employed', yearsOfExperience: 2, highestDegree: 'bachelor', mostSeniorWorkExperience: 'entry_level' }
    )).toBe(false);
  });

  test('buildStructuredBaselineFromExtraction respects acceptedFields', () => {
    const baseline = buildStructuredBaselineFromExtraction(
      {
        structuredUserInfo: {
          skills: ['Keep', 'Skip'],
          domains: ['Finance'],
        },
      },
      { 'structuredUserInfo.skills.1': false }
    );
    expect(baseline.lists.skills).toEqual(['Keep']);
    expect(baseline.lists.domains).toEqual(['Finance']);
  });

  test('resolveDeferDimensionKeysForExtraction defers unchanged dimensions on first save', () => {
    const extraction = {
      lists: {
        skillDomains: [],
        skills: ['SQL'],
        skillsInDevelopment: [],
        keyResponsibilities: ['Design APIs'],
        domains: ['Finance'],
      },
      userIdentity: {},
    };
    const incoming = {
      skills: ['SQL'],
      domains: ['Finance'],
      keyResponsibilities: ['Design APIs'],
      skillDomains: [],
      skillsInDevelopment: [],
    };
    const deferKeys = resolveDeferDimensionKeysForExtraction({
      existingStructured: {},
      incomingStructured: incoming,
      extractionBaseline: extraction,
      mode: 'replace',
    });
    expect(deferKeys.sort()).toEqual(
      ['domains', 'keyResponsibilities', 'skillDomains', 'skills', 'skillsInDevelopment'].sort()
    );
  });

  test('resolveDeferDimensionKeysForExtraction skips defer when incoming differs from extraction', () => {
    const extraction = {
      lists: {
        skillDomains: [],
        skills: ['SQL'],
        skillsInDevelopment: [],
        keyResponsibilities: [],
        domains: ['Finance'],
      },
      userIdentity: {},
    };
    const deferKeys = resolveDeferDimensionKeysForExtraction({
      existingStructured: {},
      incomingStructured: { skills: ['Python'], domains: [], keyResponsibilities: [], skillDomains: [], skillsInDevelopment: [] },
      extractionBaseline: extraction,
      mode: 'replace',
    });
    expect(deferKeys).not.toContain('skills');
  });

  test('userIdentityMatchesExtraction compares normalized answers', () => {
    expect(userIdentityMatchesExtraction(
      { workEnjoyMost: 'A', topicsIndustriesInterest: '', naturallyGoodAt: '', workEnvironmentFit: '', workingLifeAchievement: '' },
      { workEnjoyMost: 'A', topicsIndustriesInterest: '', naturallyGoodAt: '', workEnvironmentFit: '', workingLifeAchievement: '' }
    )).toBe(true);
    expect(userIdentityMatchesExtraction(
      { workEnjoyMost: 'A' },
      { workEnjoyMost: 'B' }
    )).toBe(false);
  });
});
