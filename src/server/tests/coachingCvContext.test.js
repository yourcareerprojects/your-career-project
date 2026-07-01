const {
  normalizeCoachingCvContext,
  formatCoachingCvContextBlock,
  hasCoachingCvContext,
  buildCvAwareFirstQuestionTurnHint,
} = require('../services/profile/coachingCvContext');

const COACHING_KEYS = [
  'workEnjoy',
  'topics',
  'strengths',
  'workEnvironment',
  'workingLifeAchievement',
];

describe('coachingCvContext', () => {
  const sampleContext = {
    documentId: 'doc-1',
    seniority: {
      currentStatus: 'employed',
      yearsOfExperience: 8,
      highestDegree: 'masters',
      mostSeniorWorkExperience: 'senior',
    },
    structuredUserInfo: {
      skillDomains: ['Strategy'],
      skills: [{ name: 'Python' }],
      domains: ['Healthcare'],
      keyResponsibilities: ['Leading cross-functional teams'],
      skillsInDevelopment: [{ name: 'AI Product Strategy' }],
    },
    identityHints: {
      workEnjoyMost: 'Building products\nLeading launches',
      topicsIndustriesInterest: 'SaaS\nHealthcare',
      naturallyGoodAt: 'Communication\nPrioritization',
      workEnvironmentFit: 'Collaborative\nStructured teams',
      workingLifeAchievement: 'Move into leadership\nGrow impact',
    },
  };

  it('normalizes and size-limits cv context', () => {
    const normalized = normalizeCoachingCvContext(sampleContext);
    expect(normalized.documentId).toBe('doc-1');
    expect(normalized.structuredUserInfo.domains).toEqual(['Healthcare']);
    expect(normalized.identityHints.workEnjoyMost).toContain('Building products');
  });

  it('returns null for empty context', () => {
    expect(normalizeCoachingCvContext(null)).toBeNull();
    expect(hasCoachingCvContext(null)).toBe(false);
  });

  it('formats per-coaching CV blocks', () => {
    const normalized = normalizeCoachingCvContext(sampleContext);
    for (const key of COACHING_KEYS) {
      const block = formatCoachingCvContextBlock(key, normalized, 'en');
      expect(typeof block).toBe('string');
      expect(block.length).toBeGreaterThan(0);
    }
  });

  it('returns empty block when context is absent', () => {
    expect(formatCoachingCvContextBlock('workEnjoy', null, 'en')).toBe('');
  });

  it('formats work-enjoy block from seniority-only CV context', () => {
    const seniorityOnly = normalizeCoachingCvContext({
      seniority: {
        currentStatus: 'employed',
        yearsOfExperience: 8,
        highestDegree: 'masters',
        mostSeniorWorkExperience: 'senior',
      },
    });
    const block = formatCoachingCvContextBlock('workEnjoy', seniorityOnly, 'de');
    expect(block).toContain('Lebenslauf');
    expect(block).toContain('Berufserfahrung');
    expect(block).toContain('Hypothese');
  });

  it('adds first-question turn hint when CV context is present', () => {
    const hint = buildCvAwareFirstQuestionTurnHint('de', normalizeCoachingCvContext({
      seniority: { currentStatus: 'employed', yearsOfExperience: 5 },
    }));
    expect(hint).toContain('CV-Detail');
  });
});
