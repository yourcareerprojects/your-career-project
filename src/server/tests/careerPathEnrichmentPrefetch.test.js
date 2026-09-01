const {
  buildPrefetchKey,
  scheduleCareerPathEnrichmentPrefetch,
  resolveCareerContextWithPrefetch,
  _resetPrefetchCacheForTests,
  _cacheByKey,
  _inflightByKey,
} = require('../services/profile/careerPathPlanning/careerPathEnrichmentPrefetch');

describe('careerPathEnrichmentPrefetch', () => {
  const userId = 'user-123';
  const role = { title: 'Software Developer', escoId: 'http://data.europa.eu/esco/occupation/abc' };
  const lang = 'en';

  beforeEach(() => {
    _resetPrefetchCacheForTests();
  });

  it('buildPrefetchKey combines user, role escoId, and language', () => {
    const key = buildPrefetchKey(userId, role, lang);
    expect(key).toBe(`user-123:esco:http://data.europa.eu/esco/occupation/abc:en`);
  });

  it('scheduleCareerPathEnrichmentPrefetch starts background enrichment', async () => {
    const buildContext = jest.fn().mockResolvedValue({ career: { title: 'Software Developer' } });
    const enrichContext = jest.fn().mockResolvedValue({
      career: { title: 'Software Developer' },
      enrichment: { softSkills: ['Communication'] },
    });

    const status = scheduleCareerPathEnrichmentPrefetch({
      userId,
      role,
      lang,
      buildContext,
      enrichContext,
    });

    expect(status).toBe('started');
    expect(_inflightByKey.size).toBe(1);

    await new Promise((resolve) => setImmediate(resolve));
    await Promise.all(_inflightByKey.values());

    expect(buildContext).toHaveBeenCalledTimes(1);
    expect(enrichContext).toHaveBeenCalledTimes(1);
    expect(_cacheByKey.size).toBe(1);
  });

  it('scheduleCareerPathEnrichmentPrefetch returns cached when enrichment is ready', async () => {
    const buildContext = jest.fn().mockResolvedValue({ career: { title: 'Software Developer' } });
    const enrichContext = jest.fn().mockResolvedValue({
      career: { title: 'Software Developer' },
      enrichment: { softSkills: ['Communication'] },
    });

    scheduleCareerPathEnrichmentPrefetch({
      userId,
      role,
      lang,
      buildContext,
      enrichContext,
    });
    await Promise.all(_inflightByKey.values());

    const status = scheduleCareerPathEnrichmentPrefetch({
      userId,
      role,
      lang,
      buildContext,
      enrichContext,
    });

    expect(status).toBe('cached');
    expect(buildContext).toHaveBeenCalledTimes(1);
  });

  it('resolveCareerContextWithPrefetch reuses prefetched enrichment on submit', async () => {
    const enriched = {
      career: { title: 'Software Developer' },
      enrichment: { softSkills: ['Communication'] },
    };
    const buildContext = jest.fn().mockResolvedValue({ career: { title: 'Software Developer' } });
    const enrichContext = jest.fn().mockResolvedValue(enriched);

    scheduleCareerPathEnrichmentPrefetch({
      userId,
      role,
      lang,
      buildContext,
      enrichContext,
    });
    await Promise.all(_inflightByKey.values());

    buildContext.mockClear();
    enrichContext.mockClear();

    const resolved = await resolveCareerContextWithPrefetch({
      userId,
      role,
      lang,
      buildContext,
      enrichContext,
    });

    expect(resolved).toEqual(enriched);
    expect(buildContext).not.toHaveBeenCalled();
    expect(enrichContext).not.toHaveBeenCalled();
  });

  it('resolveCareerContextWithPrefetch awaits in-flight prefetch', async () => {
    let resolveEnrich;
    const enrichPromise = new Promise((resolve) => {
      resolveEnrich = resolve;
    });
    const buildContext = jest.fn().mockResolvedValue({ career: { title: 'Software Developer' } });
    const enrichContext = jest.fn().mockReturnValue(enrichPromise);

    scheduleCareerPathEnrichmentPrefetch({
      userId,
      role,
      lang,
      buildContext,
      enrichContext,
    });

    const pendingResolve = resolveCareerContextWithPrefetch({
      userId,
      role,
      lang,
      buildContext,
      enrichContext,
    });

    resolveEnrich({
      career: { title: 'Software Developer' },
      enrichment: { softSkills: ['Teamwork'] },
    });

    const resolved = await pendingResolve;
    expect(resolved.enrichment.softSkills).toEqual(['Teamwork']);
    expect(buildContext).toHaveBeenCalledTimes(1);
    expect(enrichContext).toHaveBeenCalledTimes(1);
  });
});

describe('generateCareerPathPlan with prefetch', () => {
  const {
    generateCareerPathPlan,
  } = require('../services/profile/careerPathCoachingService');
  const {
    _resetPrefetchCacheForTests,
  } = require('../services/profile/careerPathPlanning/careerPathEnrichmentPrefetch');

  const COMPLETE_CAREER_PREFERENCES = {
    timeline: 'one_to_two_years',
    gapClosing: 'courses',
    moveType: 'deepen',
  };

  beforeEach(() => {
    _resetPrefetchCacheForTests();
  });

  it('skips enrichment LLM on submit when prefetch already completed', async () => {
    const role = { title: 'Software Developer', escoId: 'esco-1' };
    const userId = 'prefetch-user';
    const enrichedContext = {
      career: { title: 'Software Developer', requiredSkills: ['JS'] },
      enrichment: { softSkills: ['Communication'], fromCache: true },
    };

    const buildContext = jest.fn().mockResolvedValue({
      career: { title: 'Software Developer' },
    });
    const enrichContext = jest.fn().mockResolvedValue(enrichedContext);
    const coachLlm = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        introduction: 'Hello',
        whyThisPath: 'Because',
        recommendedPath: {
          steps: [
            { title: 'Step 1', description: 'Do A', duration: '3 months' },
            { title: 'Step 2', description: 'Do B', duration: '6 months' },
          ],
        },
        alternatives: [
          {
            title: 'Alt 1',
            steps: [
              { title: 'A1', description: 'Alt step', duration: '1 month' },
              { title: 'A2', description: 'Alt step 2', duration: '2 months' },
            ],
          },
          {
            title: 'Alt 2',
            steps: [
              { title: 'B1', description: 'Alt step', duration: '1 month' },
              { title: 'B2', description: 'Alt step 2', duration: '2 months' },
            ],
          },
        ],
      }),
    });

    const { scheduleCareerPathEnrichmentPrefetch } = require('../services/profile/careerPathPlanning/careerPathEnrichmentPrefetch');

    scheduleCareerPathEnrichmentPrefetch({
      userId,
      role,
      lang: 'en',
      buildContext,
      enrichContext,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));

    buildContext.mockClear();
    enrichContext.mockClear();

    const result = await generateCareerPathPlan({
      role,
      userId,
      userContext: {
        seniority: {
          currentStatus: 'employed',
          highestDegree: 'bachelors',
          yearsOfExperience: 5,
          mostSeniorWorkExperience: 'mid_level',
        },
      },
      preferences: COMPLETE_CAREER_PREFERENCES,
      lang: 'en',
      llm: coachLlm,
      enrichmentLlm: jest.fn(),
      buildContext,
      enrichContext,
    });

    expect(result.complete).toBe(true);
    expect(buildContext).not.toHaveBeenCalled();
    expect(enrichContext).not.toHaveBeenCalled();
    expect(coachLlm).toHaveBeenCalledTimes(1);
  });
});
