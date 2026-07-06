const {
  isCvNarrativeBatchEnabled,
} = require('../../constants/cvNarrativeBatch');
const {
  bilingualPairToSummaryField,
  mapUnifiedNarrativeToEnrichmentParts,
} = require('../services/profile/unifiedCvNarrativeMapper');
const {
  estimateLegacyOpenAiCallCount,
} = require('../services/profile/narrativeGenerationMetrics');
const {
  generateNarrativeEnrichmentBatched,
  generateNarrativeEnrichmentLegacy,
} = require('../services/profile/extractionNarrativeEnrichmentService');

jest.mock('../services/jobAnalysis/roleIdentityComposer', () => ({
  openaiProvider: jest.fn(),
}));

jest.mock('../services/jobAnalysis/dimensionSummaryGenerator', () => ({
  EMPTY_PLACEHOLDER: 'No information available yet',
  buildDeterministicFallback: jest.fn((items) => `Fallback: ${items.join(', ')}`),
  generateDimensionSummary: jest.fn(),
}));

jest.mock('../services/jobAnalysis/whoAreYouNarrativeGenerator', () => ({
  PLACEHOLDER: 'No personal profile information available yet.',
  generateWhoAreYouNarratives: jest.fn(),
  normalizeAnswers: (arr) => [0, 1, 2, 3, 4].map((i) => String((arr || [])[i] || '').trim()),
  generateDeterministicFallback: jest.fn(() => Array(5).fill('who-fallback')),
}));

jest.mock('../services/jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator', () => ({
  PLACEHOLDER: 'identity-placeholder',
  generateDeterministicFallback: jest.fn(async () => 'embedding-fallback'),
}));

const { openaiProvider } = require('../services/jobAnalysis/roleIdentityComposer');

const SAMPLE_UNIFIED_NARRATIVE = {
  dimensions: {
    skillDomains: { de: 'DE Stärken', en: 'EN Strengths' },
    skills: { de: 'DE Skills', en: 'EN Skills' },
    skillsInDevelopment: { de: 'No information available yet', en: 'No information available yet' },
    keyResponsibilities: { de: 'DE Resp', en: 'EN Resp' },
    domains: { de: 'DE Dom', en: 'EN Dom' },
  },
  whoAreYou: {
    answers: {
      de: ['d1', 'd2', 'd3', 'd4', 'd5'],
      en: ['e1', 'e2', 'e3', 'e4', 'e5'],
    },
  },
  embeddingText: 'I build reliable systems.',
};

describe('cvNarrativeBatch flag', () => {
  const prev = process.env.CV_NARRATIVE_BATCH;

  afterEach(() => {
    if (prev === undefined) delete process.env.CV_NARRATIVE_BATCH;
    else process.env.CV_NARRATIVE_BATCH = prev;
  });

  test('isCvNarrativeBatchEnabled respects CV_NARRATIVE_BATCH=true', () => {
    process.env.CV_NARRATIVE_BATCH = 'true';
    expect(isCvNarrativeBatchEnabled()).toBe(true);
    process.env.CV_NARRATIVE_BATCH = 'false';
    expect(isCvNarrativeBatchEnabled()).toBe(false);
  });
});

describe('unifiedCvNarrative mapping', () => {
  test('bilingualPairToSummaryField stores en and de without extra calls', () => {
    const field = bilingualPairToSummaryField({ de: 'Hallo', en: 'Hello' }, 'en');
    expect(field.translations.en).toBe('Hello');
    expect(field.translations.de).toBe('Hallo');
  });

  test('mapUnifiedNarrativeToEnrichmentParts matches structured dimension keys', () => {
    const { structuredUserInfo, who_are_you } = mapUnifiedNarrativeToEnrichmentParts(
      SAMPLE_UNIFIED_NARRATIVE,
      {
        lists: {
          skillDomains: ['Leadership'],
          skills: ['JS'],
          skillsInDevelopment: [],
          keyResponsibilities: ['APIs'],
          domains: ['Software'],
        },
        rawAnswers: ['a', 'b', 'c', 'd', 'e'],
        sourceLanguage: 'en',
      }
    );
    expect(structuredUserInfo.skillDomains.raw_items).toEqual(['Leadership']);
    expect(structuredUserInfo.skillDomains.summary_text.translations.en).toContain('EN Strengths');
    expect(who_are_you.summary_text.translations.en).toContain('e1');
    expect(who_are_you.identity_embedding_text).toContain('reliable');
  });
});

describe('estimateLegacyOpenAiCallCount', () => {
  test('counts generate+translate per populated dimension plus who+embedding', () => {
    const count = estimateLegacyOpenAiCallCount({
      lists: { skills: ['x'], skillDomains: [], keyResponsibilities: ['y'], domains: [], skillsInDevelopment: [] },
      rawAnswers: ['one', '', '', '', ''],
      includeWhoAreYou: true,
      includeEmbedding: true,
    });
    expect(count).toBe(7);
  });
});

describe('extractionNarrativeEnrichment batched vs legacy', () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevBatch = process.env.CV_NARRATIVE_BATCH;

  const SAMPLE_LLM_JSON = JSON.stringify(SAMPLE_UNIFIED_NARRATIVE);

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    openaiProvider.mockResolvedValue(SAMPLE_LLM_JSON);
    const { generateDimensionSummary } = require('../services/jobAnalysis/dimensionSummaryGenerator');
    const { generateWhoAreYouNarratives } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
    generateDimensionSummary.mockImplementation(async ({ dimension, rawItems }, opts = {}) => {
      const text = `[${dimension}] ${rawItems.join('|')}`;
      if (opts.returnBundle) {
        return { canonical: text, canonicalLanguage: 'en', localized: { de: `DE ${text}` } };
      }
      return text;
    });
    generateWhoAreYouNarratives.mockImplementation(async (answers, opts = {}) => {
      const canonical = answers.map((a, i) => `who-${i}-${a}`);
      if (opts.returnBundle) {
        return { canonical, canonicalLanguage: 'en', localized: { de: canonical.map((v) => `de-${v}`) } };
      }
      return canonical;
    });
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    if (prevBatch === undefined) delete process.env.CV_NARRATIVE_BATCH;
    else process.env.CV_NARRATIVE_BATCH = prevBatch;
  });

  const profileData = {
    userIdentity: {
      workEnjoyMost: 'Building',
      topicsIndustriesInterest: 'Tech',
      naturallyGoodAt: 'Code',
      workEnvironmentFit: 'Remote',
      workingLifeAchievement: 'Shipped',
    },
    structuredUserInfo: {
      skillDomains: ['Leadership'],
      skills: ['JS'],
      skillsInDevelopment: [],
      keyResponsibilities: ['APIs'],
      domains: ['Software'],
    },
  };

  test('batched path uses production-quality per-dimension and who generators', async () => {
    openaiProvider.mockClear();
    const { generateDimensionSummary } = require('../services/jobAnalysis/dimensionSummaryGenerator');
    const { generateWhoAreYouNarratives } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
    generateDimensionSummary.mockClear();
    generateWhoAreYouNarratives.mockClear();

    const enrichment = await generateNarrativeEnrichmentBatched(profileData, { sourceLanguage: 'en' });
    expect(generateDimensionSummary).toHaveBeenCalled();
    expect(generateWhoAreYouNarratives).toHaveBeenCalled();
    expect(enrichment.structuredUserInfo.skills.summary_text.translations.en).toContain('[Skills]');
    expect(enrichment.who_are_you.raw_answers).toHaveLength(5);
  });

  test('legacy path calls per-dimension generators', async () => {
    const { generateDimensionSummary } = require('../services/jobAnalysis/dimensionSummaryGenerator');
    const { generateWhoAreYouNarratives } = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
    generateDimensionSummary.mockClear();
    generateWhoAreYouNarratives.mockClear();
    openaiProvider.mockClear();

    await generateNarrativeEnrichmentLegacy(profileData, { sourceLanguage: 'en' });
    expect(generateDimensionSummary).toHaveBeenCalled();
    expect(generateWhoAreYouNarratives).toHaveBeenCalled();
    expect(openaiProvider).not.toHaveBeenCalled();
  });
});
