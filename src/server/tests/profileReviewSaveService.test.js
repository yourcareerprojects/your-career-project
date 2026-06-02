const {
  buildMergedStructuredPayload,
  buildMergedStructuredPayloadForNormalization,
  buildMergedUserIdentity,
  mergeUniqueStrings,
  normalizeSeniorityFields,
  verifySeniorityPersisted,
} = require('../services/profile/profileReviewSaveService');

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
    const existingSummary = {
      en: '[Skills] SQL',
      original_language: 'en',
      translations: { en: '[Skills] SQL' },
    };
    const existing = {
      skills: { raw_items: ['SQL'], summary_text: existingSummary },
      domains: {
        raw_items: ['Finance'],
        summary_text: { en: '[Domains] Finance', translations: { en: '[Domains] Finance' } },
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
    expect(normalized.domains.summary_text.translations.en).toBe('[Domains] Finance');
  });

  test('buildMergedStructuredPayloadForNormalization passes plain arrays when lists change', () => {
    const existing = {
      skills: { raw_items: ['SQL'], summary_text: { en: '[Skills] SQL' } },
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
});
