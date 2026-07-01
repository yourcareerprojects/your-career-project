const { generateDimensionSummary, buildDeterministicFallback } = require('../services/jobAnalysis/dimensionSummaryGenerator');
const {
  generateWhoAreYouNarratives,
  generateDeterministicFallback,
} = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
const {
  getProfileDisplayNarrativesReadiness,
  isDimensionNarrativeReady,
} = require('../services/profile/profileNarrativeReadinessService');

describe('narrative generators honor returnBundle on fallback paths', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  test('generateDimensionSummary returns bundle without API key', async () => {
    delete process.env.OPENAI_API_KEY;
    const generated = await generateDimensionSummary(
      { dimension: 'Skills', rawItems: ['JavaScript'] },
      { lang: 'en', sourceLang: 'en', returnBundle: true }
    );
    expect(generated).toMatchObject({
      canonical: buildDeterministicFallback(['JavaScript']),
      canonicalLanguage: 'en',
      localized: {},
    });
  });

  test('generateWhoAreYouNarratives returns bundle without API key', async () => {
    delete process.env.OPENAI_API_KEY;
    const answers = ['Building products', 'a', 'b', 'c', 'd'];
    const generated = await generateWhoAreYouNarratives(answers, {
      lang: 'en',
      sourceLang: 'en',
      returnBundle: true,
    });
    expect(generated).toMatchObject({
      canonical: generateDeterministicFallback(answers),
      canonicalLanguage: 'en',
      localized: {},
    });
  });
});

describe('profile display narrative readiness', () => {
  test('detects pending who_are_you when identity answers exist only on userIdentityAnswers', () => {
    const profile = {
      userIdentityAnswers: {
        workEnjoyMost: 'Building products',
      },
      who_are_you: {
        raw_answers: [],
        summary_text: JSON.stringify(Array(5).fill('No personal profile information available yet.')),
      },
      structuredUserInfo: {},
    };
    const readiness = getProfileDisplayNarrativesReadiness(profile, 'en');
    expect(readiness.ready).toBe(false);
    expect(readiness.pending).toContain('who_are_you');
  });

  test('accepts deterministic persisted summaries for display polling', () => {
    const items = ['JavaScript'];
    const fallback = buildDeterministicFallback(items);
    const profile = {
      structuredUserInfo: {
        skillDomains: { raw_items: [], summary_text: { translations: { en: 'No information available yet' } } },
        skills: { raw_items: items, summary_text: { translations: { en: fallback } } },
        skillsInDevelopment: { raw_items: [], summary_text: { translations: { en: 'No information available yet' } } },
        keyResponsibilities: { raw_items: [], summary_text: { translations: { en: 'No information available yet' } } },
        domains: { raw_items: [], summary_text: { translations: { en: 'No information available yet' } } },
      },
      who_are_you: {
        raw_answers: ['Building products', '', '', '', ''],
        summary_text: {
          translations: {
            en: JSON.stringify([
              'You describe yourself as Building products.',
              'No personal profile information available yet.',
              'No personal profile information available yet.',
              'No personal profile information available yet.',
              'No personal profile information available yet.',
            ]),
          },
        },
      },
    };

    expect(isDimensionNarrativeReady(profile.structuredUserInfo.skills, 'en')).toBe(false);
    expect(getProfileDisplayNarrativesReadiness(profile, 'en').ready).toBe(true);
  });
});
