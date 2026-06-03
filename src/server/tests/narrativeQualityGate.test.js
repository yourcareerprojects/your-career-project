const { buildDeterministicFallback } = require('../services/jobAnalysis/dimensionSummaryGenerator');
const {
  meetsDimensionSummaryQuality,
  meetsWhoAreYouLineQuality,
  meetsWhoAreYouNarrativesQuality,
  isDeterministicDimensionSummary,
  isDeterministicWhoAreYouLine,
  isNarrativeCacheQualityVersionCurrent,
} = require('../services/profile/narrativeQualityGate');
const { NARRATIVE_CACHE_QUALITY_VERSION } = require('../../constants/narrativeCacheQuality');
const {
  isDimensionNarrativeReady,
  isWhoAreYouNarrativeReady,
  getDocumentNarrativeCacheReadiness,
} = require('../services/profile/profileNarrativeReadinessService');

describe('narrativeQualityGate', () => {
  test('rejects deterministic dimension fallbacks', () => {
    const items = ['Leadership', 'Strategy'];
    const fallback = buildDeterministicFallback(items);
    expect(isDeterministicDimensionSummary(fallback, items)).toBe(true);
    expect(meetsDimensionSummaryQuality(fallback, items)).toBe(false);
  });

  test('accepts multi-sentence polished dimension summaries', () => {
    const items = ['JavaScript', 'React'];
    const polished =
      'You apply JavaScript and React to build reliable product experiences. '
      + 'You translate complex requirements into maintainable interfaces. '
      + 'Teams rely on you to ship iteratively without sacrificing quality.';
    expect(meetsDimensionSummaryQuality(polished, items)).toBe(true);
  });

  test('rejects short unified-style one-liners for multi-item dimensions', () => {
    expect(meetsDimensionSummaryQuality('You work with JavaScript and React.', ['JavaScript', 'React'])).toBe(false);
  });

  test('rejects deterministic who-are-you lines', () => {
    const raw = 'Building products';
    expect(isDeterministicWhoAreYouLine(`You describe yourself as ${raw}.`, raw)).toBe(true);
    expect(meetsWhoAreYouLineQuality(`You describe yourself as ${raw}.`, raw)).toBe(false);
  });

  test('accepts rich who-are-you paragraphs', () => {
    const raw = 'Building products';
    const polished =
      'You start by clarifying the user problem, then shape small experiments that reduce risk. '
      + 'You keep stakeholders aligned with concrete demos instead of abstract status updates.';
    expect(meetsWhoAreYouLineQuality(polished, raw)).toBe(true);
    expect(
      meetsWhoAreYouNarrativesQuality(
        [polished, polished, polished, polished, polished],
        [raw, raw, raw, raw, raw]
      )
    ).toBe(true);
  });
});

describe('profileNarrativeReadinessService quality integration', () => {
  test('cache without qualityVersion is not ready', () => {
    const doc = {
      narrativeEnrichment: {
        structuredUserInfo: {
          skills: {
            raw_items: ['JavaScript'],
            summary_text: {
              original_language: 'en',
              original: 'You apply JavaScript to deliver maintainable product features across the stack.',
              translations: {
                en: 'You apply JavaScript to deliver maintainable product features across the stack.',
              },
            },
          },
        },
        who_are_you: { raw_answers: [], summary_text: { translations: { en: '[]' } } },
      },
    };
    const readiness = getDocumentNarrativeCacheReadiness(doc, 'en');
    expect(readiness.ready).toBe(false);
    expect(readiness.pending).toContain('narrativeEnrichment.qualityVersion');
  });

  test('stale deterministic cache fails dimension readiness', () => {
    const items = ['JavaScript'];
    const fallback = buildDeterministicFallback(items);
    expect(
      isDimensionNarrativeReady(
        {
          raw_items: items,
          summary_text: { translations: { en: fallback } },
        },
        'en'
      )
    ).toBe(false);
  });

  test('stamped cache with polished text is ready', () => {
    const polished =
      'You apply JavaScript to deliver maintainable product features across the stack.';
    const doc = {
      narrativeEnrichment: {
        qualityVersion: NARRATIVE_CACHE_QUALITY_VERSION,
        structuredUserInfo: {
          skillDomains: { raw_items: [], summary_text: { translations: { en: 'No information available yet' } } },
          skills: {
            raw_items: ['JavaScript'],
            summary_text: { translations: { en: polished } },
          },
          skillsInDevelopment: { raw_items: [], summary_text: { translations: { en: 'No information available yet' } } },
          keyResponsibilities: { raw_items: [], summary_text: { translations: { en: 'No information available yet' } } },
          domains: { raw_items: [], summary_text: { translations: { en: 'No information available yet' } } },
        },
        who_are_you: { raw_answers: [] },
      },
    };
    expect(isNarrativeCacheQualityVersionCurrent(doc.narrativeEnrichment)).toBe(true);
    expect(getDocumentNarrativeCacheReadiness(doc, 'en').ready).toBe(true);
  });

  test('who readiness rejects deterministic lines', () => {
    const raw = 'Building products';
    const summary = JSON.stringify([
      `You describe yourself as ${raw}.`,
      'x', 'x', 'x', 'x',
    ]);
    expect(
      isWhoAreYouNarrativeReady(
        {
          raw_answers: [raw, 'a', 'b', 'c', 'd'],
          summary_text: { translations: { en: summary } },
        },
        'en'
      )
    ).toBe(false);
  });
});
