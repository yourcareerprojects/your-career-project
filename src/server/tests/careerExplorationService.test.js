/**
 * Unit tests for Career Exploration Service.
 */

const {
  generateCareerExploration,
  allocateBucketCounts,
  resolveTriggerLevel,
  buildExplorationExplanation,
  CAREER_EXPLORATION_THRESHOLDS,
  CAREER_EXPLORATION_SOURCES,
  CAREER_EXPLORATION_TRIGGER_LEVELS,
} = require('../services/careerIdentity/careerExplorationService');

function match(id, delta, newScore = 0.5, extras = {}) {
  return {
    role: {
      id,
      escoId: id,
      domain: extras.domain,
      identityDomains: extras.identityDomains,
      ...extras.role,
    },
    oldScore: Math.max(0, newScore - delta),
    newScore,
    delta,
  };
}

/** Skip real MMR (no embeddings); use deterministic domain diversity. */
async function fakeMmr(items, options = {}) {
  const k = options.k || items.length;
  const scoreFn = options.scoreFn || ((it) => it.delta || 0);
  return items
    .slice()
    .sort((a, b) => scoreFn(b) - scoreFn(a))
    .slice(0, k);
}

describe('careerExplorationService', () => {
  it('allocates bucket counts with largest remainder to exact target', () => {
    const counts = allocateBucketCounts(
      { HIGHEST_DELTA: 0.4, NEW_DOMAIN: 0.3, UNEXPECTED: 0.2, WILDCARD: 0.1 },
      8
    );
    expect(counts.HIGHEST_DELTA + counts.NEW_DOMAIN + counts.UNEXPECTED + counts.WILDCARD).toBe(8);
    expect(counts.HIGHEST_DELTA).toBe(3);
    expect(counts.NEW_DOMAIN).toBe(2);
    expect(counts.UNEXPECTED).toBe(2);
    expect(counts.WILDCARD).toBe(1);
  });

  it('maps changeScore to triggerLevel', () => {
    expect(resolveTriggerLevel(10, CAREER_EXPLORATION_THRESHOLDS)).toBe(
      CAREER_EXPLORATION_TRIGGER_LEVELS.NONE
    );
    expect(resolveTriggerLevel(35, CAREER_EXPLORATION_THRESHOLDS)).toBe(
      CAREER_EXPLORATION_TRIGGER_LEVELS.MILD
    );
    expect(resolveTriggerLevel(55, CAREER_EXPLORATION_THRESHOLDS)).toBe(
      CAREER_EXPLORATION_TRIGGER_LEVELS.MODERATE
    );
    expect(resolveTriggerLevel(80, CAREER_EXPLORATION_THRESHOLDS)).toBe(
      CAREER_EXPLORATION_TRIGGER_LEVELS.STRONG
    );
  });

  it('returns empty exploration when triggerLevel is none', async () => {
    const result = await generateCareerExploration({
      deltaJobMatches: [match('a', 0.2)],
      identityChangeScore: 10,
      mmrSelectFn: fakeMmr,
    });
    expect(result.triggerLevel).toBe('none');
    expect(result.explorationJobs).toEqual([]);
    expect(result.explanation).toMatch(/not changed enough/i);
  });

  it('returns 5–10 exploration jobs with required fields', async () => {
    const deltaJobMatches = Array.from({ length: 20 }, (_, i) =>
      match(`job-${i}`, 0.4 - i * 0.015, 0.55, {
        identityDomains: i % 3 === 0 ? ['leadership'] : ['interests'],
        domain: i % 2 === 0 ? 'Engineering' : 'Health',
      })
    );

    const result = await generateCareerExploration({
      deltaJobMatches,
      identityChangeScore: {
        changeScore: 42,
        reasons: [
          'New Leadership domain',
          'Analytical Thinking confidence increased',
        ],
      },
      newDomains: ['leadership', 'thinking_style'],
      targetCount: 8,
      mmrSelectFn: fakeMmr,
      domainAffinityFn: (m) =>
        (m.role.identityDomains || []).includes('leadership') ? 1 : 0.05,
      config: {
        thresholds: {
          // Widen unexpected band so mid-delta jobs qualify in this fixture.
          UNEXPECTED_DELTA_MIN: 0.01,
          UNEXPECTED_DELTA_MAX: 0.4,
          UNEXPECTED_NEW_SCORE_MIN: 0.2,
          UNEXPECTED_NEW_SCORE_MAX: 0.9,
          USE_MMR_FOR_HIGHEST_DELTA: false,
          USE_MMR_FOR_NEW_DOMAIN: false,
          USE_MMR_FOR_UNEXPECTED: false,
        },
      },
    });

    expect(result.triggerLevel).toBe('mild');
    expect(result.explorationJobs.length).toBeGreaterThanOrEqual(5);
    expect(result.explorationJobs.length).toBeLessThanOrEqual(10);
    expect(result.explorationJobs.length).toBe(8);

    for (const job of result.explorationJobs) {
      expect(job.role).toBeTruthy();
      expect(Number.isFinite(job.oldScore)).toBe(true);
      expect(Number.isFinite(job.newScore)).toBe(true);
      expect(Number.isFinite(job.delta)).toBe(true);
      expect(Object.values(CAREER_EXPLORATION_SOURCES)).toContain(job.source);
    }

    expect(result.explanation).toMatch(/shifted toward/i);
    expect(result.explanation.toLowerCase()).toMatch(/leadership|analytical/);
  });

  it('avoids duplicates, rated, and accepted jobs', async () => {
    const deltaJobMatches = [
      match('keep-me', 0.5, 0.8),
      match('rated', 0.49, 0.79),
      match('accepted', 0.48, 0.78),
      match('a', 0.4, 0.7),
      match('b', 0.39, 0.69),
      match('c', 0.38, 0.68),
      match('d', 0.37, 0.67),
      match('e', 0.36, 0.66),
      match('f', 0.35, 0.65),
      match('g', 0.34, 0.64),
    ];

    const result = await generateCareerExploration({
      deltaJobMatches,
      identityChangeScore: 45,
      recentlyRatedJobIds: ['rated'],
      acceptedJobIds: ['accepted'],
      targetCount: 5,
      mmrSelectFn: fakeMmr,
      config: {
        thresholds: {
          MIN_JOBS: 5,
          USE_MMR_FOR_HIGHEST_DELTA: false,
          USE_MMR_FOR_NEW_DOMAIN: false,
          USE_MMR_FOR_UNEXPECTED: false,
          UNEXPECTED_DELTA_MIN: 0.01,
          UNEXPECTED_DELTA_MAX: 0.5,
          UNEXPECTED_NEW_SCORE_MIN: 0.2,
          UNEXPECTED_NEW_SCORE_MAX: 0.95,
        },
      },
    });

    const ids = result.explorationJobs.map((j) => j.role.escoId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('rated');
    expect(ids).not.toContain('accepted');
  });

  it('is deterministic for the same inputs', async () => {
    const deltaJobMatches = Array.from({ length: 12 }, (_, i) =>
      match(`r-${i}`, 0.3 - i * 0.01, 0.5, { domain: `D${i % 4}` })
    );
    const opts = {
      deltaJobMatches,
      identityChangeScore: { changeScore: 60, reasons: ['New Leadership domain'] },
      newDomains: ['leadership'],
      targetCount: 6,
      mmrSelectFn: fakeMmr,
      config: {
        thresholds: {
          MIN_JOBS: 5,
          USE_MMR_FOR_HIGHEST_DELTA: false,
          USE_MMR_FOR_NEW_DOMAIN: false,
          USE_MMR_FOR_UNEXPECTED: false,
          UNEXPECTED_DELTA_MIN: 0.01,
          UNEXPECTED_DELTA_MAX: 0.4,
          UNEXPECTED_NEW_SCORE_MIN: 0.2,
          UNEXPECTED_NEW_SCORE_MAX: 0.9,
        },
      },
    };

    const a = await generateCareerExploration(opts);
    const b = await generateCareerExploration(opts);
    expect(a.explorationJobs.map((j) => j.role.id)).toEqual(
      b.explorationJobs.map((j) => j.role.id)
    );
    expect(a.explanation).toBe(b.explanation);
    expect(a.triggerLevel).toBe(b.triggerLevel);
  });

  it('builds the example-style explanation from domains', () => {
    const text = buildExplorationExplanation(
      { changeScore: 42, reasons: [] },
      ['thinking_style', 'leadership'],
      'en'
    );
    expect(text).toBe(
      'Your identity has recently shifted toward analytical strengths and leadership-related strengths.'
    );
  });
});
