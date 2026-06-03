const {
  buildProfileFromIdentityAndHeuristic,
  mergeStructuredSemanticIntoProfile,
  buildCombinedSemanticExtraction,
  __testables: { mergeUserIdentityFields },
} = require('../services/cv/cvSemanticCompose');
const { normalizeInterpretationShape } = require('../services/documents/semanticCvInterpreter');

describe('identity-first CV extraction helpers', () => {
  test('mergeUserIdentityFields uses LLM values only', () => {
    expect(
      mergeUserIdentityFields({
        workEnjoyMost: 'LLM answer',
      })
    ).toEqual({
      workEnjoyMost: 'LLM answer',
      topicsIndustriesInterest: '',
      naturallyGoodAt: '',
      workEnvironmentFit: '',
      workingLifeAchievement: '',
    });
  });

  test('buildProfileFromIdentityAndHeuristic keeps heuristic structured baseline', () => {
    const identitySemantic = normalizeInterpretationShape({
      userIdentity: {
        workEnjoyment: { bullets: ['Solving complex problems'], confidence: 0.9, evidence: [] },
        interests: { bullets: ['Healthcare SaaS'], confidence: 0.8, evidence: [] },
        strengths: { bullets: ['Communication'], confidence: 0.8, evidence: [] },
        workStyle: { bullets: ['Collaborative teams'], confidence: 0.7, evidence: [] },
        careerGoals: { bullets: ['Lead product teams'], confidence: 0.6, evidence: [] },
      },
    });
    const heuristicResult = {
      profile: {
        structuredUserInfo: {
          skills: [{ name: 'JavaScript' }],
          skillDomains: ['Execution'],
          domains: [],
          keyResponsibilities: [],
          skillsInDevelopment: [],
        },
        seniority: { yearsOfExperience: 5 },
        userIdentity: { workEnjoyMost: 'Should not appear' },
      },
      extractedFields: ['skills'],
      status: 'partial',
    };

    const built = buildProfileFromIdentityAndHeuristic(identitySemantic, heuristicResult);
    expect(built.profile.userIdentity.workEnjoyMost).toContain('Solving');
    expect(built.profile.userIdentity.workEnjoyMost).not.toContain('Should not appear');
    expect(built.profile.structuredUserInfo.skills).toEqual([]);
  });

  test('mergeStructuredSemanticIntoProfile preserves existing identity answers', () => {
    const existingProfile = {
      userIdentity: {
        workEnjoyMost: 'User edited identity',
        topicsIndustriesInterest: 'Topics',
        naturallyGoodAt: 'Strengths',
        workEnvironmentFit: 'Style',
        workingLifeAchievement: 'Goals',
      },
      structuredUserInfo: { skills: [{ name: 'OldSkill' }] },
      seniority: { yearsOfExperience: 1 },
    };
    const structuredSemantic = normalizeInterpretationShape({
      structuredProfile: {
        skills: [{ name: 'Node.js', confidence: 0.9, evidence: [] }],
        skillDomains: [{ name: 'Execution', confidence: 0.8, evidence: [] }],
        domains: [{ name: 'Healthcare', confidence: 0.9, evidence: [] }],
        responsibilities: [{ description: 'Leading cross-functional delivery', confidence: 0.9, evidence: [] }],
        learningGoals: [{ name: 'AI discovery', confidence: 0.5, evidence: [] }],
      },
      seniority: {
        yearsOfExperience: { value: '8 years', confidence: 0.9, evidence: [] },
        currentStatus: { value: 'employed', confidence: 0.9, evidence: [] },
        highestDegree: { value: 'Master of Science', confidence: 0.8, evidence: [] },
        mostSeniorRole: { value: 'Director', confidence: 0.8, evidence: [] },
      },
    });
    const heuristicResult = {
      profile: {
        structuredUserInfo: { skills: [{ name: 'JavaScript' }] },
        seniority: { yearsOfExperience: 2 },
      },
    };

    const merged = mergeStructuredSemanticIntoProfile(
      existingProfile,
      structuredSemantic,
      heuristicResult
    );

    expect(merged.userIdentity.workEnjoyMost).toBe('User edited identity');
    expect(merged.structuredUserInfo.skills.map((s) => s.name)).toContain('Node.js');
    expect(merged.seniority.yearsOfExperience).toBe(8);
  });

  test('mergeStructuredSemanticIntoProfile prefers semantic good-at lists over heuristics', () => {
    const structuredSemantic = normalizeInterpretationShape({
      structuredProfile: {
        skills: [{ name: 'Node.js', confidence: 0.9, evidence: [] }],
        skillDomains: [{ name: 'Execution', confidence: 0.8, evidence: [] }],
        domains: [{ name: 'Healthcare', confidence: 0.9, evidence: [] }],
        responsibilities: [{ description: 'Leading cross-functional delivery', confidence: 0.9, evidence: [] }],
        learningGoals: [{ name: 'AI discovery', confidence: 0.5, evidence: [] }],
      },
    });
    const heuristicResult = {
      profile: {
        structuredUserInfo: {
          skills: [{ name: 'JavaScript' }, { name: 'TypeScript' }, { name: 'React' }],
          skillDomains: ['Execution', 'Analysis'],
          domains: ['Healthcare', 'Finance'],
          keyResponsibilities: ['Built customer-facing dashboards'],
          skillsInDevelopment: [],
        },
      },
    };

    const merged = mergeStructuredSemanticIntoProfile({}, structuredSemantic, heuristicResult);

    expect(merged.structuredUserInfo.skills.map((s) => s.name)).toEqual(['Node.js']);
    expect(merged.structuredUserInfo.skillDomains).toEqual(['Execution']);
    expect(merged.structuredUserInfo.domains).toEqual(['Healthcare']);
    expect(merged.structuredUserInfo.keyResponsibilities).toEqual(['Leading cross-functional delivery']);
    expect(merged.structuredUserInfo.skillsInDevelopment).toEqual(['AI discovery']);
  });

  test('buildCombinedSemanticExtraction merges identity and structured in one payload', () => {
    const identitySemantic = normalizeInterpretationShape({
      userIdentity: {
        workEnjoyment: { bullets: ['Solving problems'], confidence: 0.9, evidence: [] },
        interests: { bullets: ['Healthcare'], confidence: 0.8, evidence: [] },
        strengths: { bullets: ['Communication'], confidence: 0.8, evidence: [] },
        workStyle: { bullets: ['Collaborative'], confidence: 0.7, evidence: [] },
        careerGoals: { bullets: ['Lead teams'], confidence: 0.6, evidence: [] },
      },
    });
    const structuredSemantic = normalizeInterpretationShape({
      structuredProfile: {
        skillDomains: [{ name: 'Leadership', confidence: 0.9, evidence: [] }],
        domains: [{ name: 'Healthcare', confidence: 0.9, evidence: [] }],
        responsibilities: [{ description: 'Driving product strategy across clinical stakeholders', confidence: 0.9, evidence: [] }],
        skills: [{ name: 'Product Management', level: 'advanced', confidence: 0.9, evidence: [] }],
        learningGoals: [{ name: 'Regulatory affairs', confidence: 0.5, evidence: [] }],
      },
      seniority: {
        yearsOfExperience: { value: '10 years', confidence: 0.9, evidence: [] },
        currentStatus: { value: 'employed', confidence: 0.9, evidence: [] },
        highestDegree: { value: 'Master of Science', confidence: 0.8, evidence: [] },
        mostSeniorRole: { value: 'Director', confidence: 0.8, evidence: [] },
      },
    });
    const heuristicResult = {
      profile: {
        structuredUserInfo: {
          skills: [{ name: 'JavaScript' }],
          skillDomains: ['Execution'],
          domains: [],
          keyResponsibilities: ['Raw job description paragraph from heuristic fallback'],
          skillsInDevelopment: [],
        },
        seniority: { yearsOfExperience: 2 },
      },
      extractedFields: ['skills'],
      status: 'partial',
    };

    const combined = buildCombinedSemanticExtraction(
      heuristicResult,
      identitySemantic,
      structuredSemantic
    );

    expect(combined.semanticEnrichmentStatus).toBe('complete');
    expect(combined.profile.userIdentity.workEnjoyMost).toContain('Solving');
    expect(combined.profile.structuredUserInfo.skillDomains).toEqual(['Leadership']);
    expect(combined.profile.structuredUserInfo.domains).toEqual(['Healthcare']);
    expect(combined.profile.structuredUserInfo.keyResponsibilities[0]).toContain('product strategy');
    expect(combined.profile.structuredUserInfo.skillsInDevelopment).toEqual(['Regulatory affairs']);
    expect(combined.profile.seniority.yearsOfExperience).toBe(10);
  });
});
