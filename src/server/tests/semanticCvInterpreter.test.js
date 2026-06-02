const { normalizeInterpretationShape } = require('../services/documents/semanticCvInterpreter');
const { __testables: cvExtractionTestables } = require('../services/cv/cvExtractionProcessor');

describe('semanticCvInterpreter.normalizeInterpretationShape', () => {
  test('normalizes malformed and partial values safely', () => {
    const raw = {
      userIdentity: {
        workEnjoyment: { bullets: [' Building products ', 'Leading launches'], confidence: '0.88', evidence: ['led launches', null] },
        interests: { bullets: ['FinTech', '  AI '], confidence: 0.9, evidence: ['industry projects'] },
        strengths: { bullets: ['Leadership'], confidence: 1.2, evidence: ['managed team'] },
        workStyle: { bullets: [], confidence: -1, evidence: 'bad' },
        careerGoals: { bullets: ['Grow into product leadership'], confidence: 0.61, evidence: ['promotion trajectory'] }
      },
      structuredProfile: {
        skillDomains: [{ name: 'Leadership', confidence: 0.85, evidence: ['managed team'] }],
        domains: [
          { name: 'Product Management', confidence: '0.8', evidence: ['roadmap ownership'] },
          { name: 'fintech', confidence: '0.9', evidence: ['fintech projects'] },
          { name: 'financial services', confidence: '0.7', evidence: ['banking clients'] }
        ],
        responsibilities: [{ description: 'Coordinating cross-functional collaboration across design and engineering teams', confidence: 0.7, evidence: ['partnered with design'] }],
        skills: [{ name: 'Stakeholder Management', level: 'ADVANCED', confidence: '0.82', evidence: ['executive presentations'] }],
        learningGoals: [{ name: 'AI Product Strategy', confidence: 0.5, evidence: [] }]
      },
      seniority: {
        currentStatus: { value: 'employed', confidence: 0.95, evidence: ['current role listed'] },
        yearsOfExperience: { value: '7', confidence: 0.9, evidence: ['timeline'] },
        highestDegree: { value: 'masters', confidence: 0.8, evidence: ['education section'] },
        mostSeniorRole: { value: 'Senior Product Manager', confidence: 0.8, evidence: ['role progression'] }
      }
    };

    const normalized = normalizeInterpretationShape(raw);
    expect(normalized.userIdentity.workEnjoyment.bullets).toEqual(['Building products', 'Leading launches']);
    expect(normalized.userIdentity.workEnjoyment.confidence).toBe(0.88);
    expect(normalized.userIdentity.workStyle.confidence).toBe(0);
    expect(normalized.userIdentity.strengths.confidence).toBe(1);
    expect(normalized.structuredProfile.skillDomains).toEqual([
      { name: 'Leadership', confidence: 0.85, evidence: ['managed team'] }
    ]);
    expect(normalized.structuredProfile.domains).toEqual([
      { name: 'Finance', confidence: 0.9, evidence: ['fintech projects'] }
    ]);
    expect(normalized.structuredProfile.skills[0].level).toBe('advanced');
    expect(normalized.seniority.currentStatus.value).toBe('employed');
  });
});

describe('cvExtractionProcessor semantic mapping', () => {
  test('maps semantic schema into profile payload shape', () => {
    const semantic = normalizeInterpretationShape({
      userIdentity: {
        workEnjoyment: { bullets: ['Solving customer problems'], confidence: 0.9, evidence: ['customer interviews'] },
        interests: { bullets: ['SaaS', 'Healthcare'], confidence: 0.8, evidence: ['project domain'] },
        strengths: { bullets: ['Communication', 'Prioritization'], confidence: 0.85, evidence: ['led planning'] },
        workStyle: { bullets: ['Collaborative and structured'], confidence: 0.78, evidence: ['cross-functional team'] },
        careerGoals: { bullets: ['Move into head of product roles'], confidence: 0.66, evidence: ['promotion history'] }
      },
      structuredProfile: {
        skillDomains: [{ name: 'Stakeholder Management', confidence: 0.88, evidence: ['executive alignment'] }],
        domains: [{ name: 'Healthcare', confidence: 0.92, evidence: ['hospital clients'] }],
        responsibilities: [{ description: 'Planning and prioritizing product roadmaps across multiple stakeholder groups', confidence: 0.9, evidence: ['owned roadmap'] }],
        skills: [{ name: 'Stakeholder Management', level: 'advanced', confidence: 0.9, evidence: ['executive alignment'] }],
        learningGoals: [{ name: 'AI Product Discovery', confidence: 0.55, evidence: ['recent coursework'] }]
      },
      seniority: {
        currentStatus: { value: 'employed', confidence: 0.95, evidence: ['current role'] },
        yearsOfExperience: { value: '8 years', confidence: 0.9, evidence: ['timeline'] },
        highestDegree: { value: 'Master of Science', confidence: 0.85, evidence: ['education'] },
        mostSeniorRole: { value: 'Director of Product', confidence: 0.8, evidence: ['leadership scope'] }
      }
    });

    const mapped = cvExtractionTestables.mapSemanticExtractionToProfile(semantic);
    expect(mapped.status).toBe('success');
    expect(mapped.profile.userIdentity.workEnjoyMost).toBe('Solving customer problems');
    expect(mapped.profile.userIdentity.topicsIndustriesInterest).toBe('SaaS Healthcare');
    expect(mapped.profile.userIdentity.naturallyGoodAt).toBe('Communication Prioritization');
    expect(mapped.profile.structuredUserInfo.skillDomains).toEqual(['Stakeholder Management']);
    expect(mapped.profile.structuredUserInfo.domains).toEqual(['Healthcare']);
    expect(mapped.profile.structuredUserInfo.keyResponsibilities).toEqual(['Planning and prioritizing product roadmaps across multiple stakeholder groups']);
    expect(mapped.profile.structuredUserInfo.skills).toEqual([{ name: 'Stakeholder Management' }]);
    expect(mapped.profile.structuredUserInfo.skillsInDevelopment).toEqual(['AI Product Discovery']);
    expect(mapped.profile.seniority.currentStatus).toBe('employed');
    expect(mapped.profile.seniority.yearsOfExperience).toBe(8);
    expect(mapped.profile.seniority.highestDegree).toBe('masters');
    expect(mapped.profile.seniority.mostSeniorWorkExperience).toBe('director');
  });
});

