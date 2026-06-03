jest.mock('../services/documents/semanticCvInterpreter', () => {
  const actual = jest.requireActual('../services/documents/semanticCvInterpreter');
  return {
    ...actual,
    interpretCvIdentityText: jest.fn(),
    interpretCvStructuredText: jest.fn(),
  };
});

const {
  interpretCvIdentityText,
  interpretCvStructuredText,
  normalizeInterpretationShape,
} = require('../services/documents/semanticCvInterpreter');
const { extractProfileDataFromDocumentText } = require('../services/cv/cvExtractionOrchestrator');

const identityFixture = {
  userIdentity: {
    workEnjoyment: { bullets: ['Building products'], confidence: 0.9, evidence: [] },
    interests: { bullets: ['Healthcare'], confidence: 0.8, evidence: [] },
    strengths: { bullets: ['Communication'], confidence: 0.8, evidence: [] },
    workStyle: { bullets: ['Collaborative teams'], confidence: 0.7, evidence: [] },
    careerGoals: { bullets: ['Lead teams'], confidence: 0.6, evidence: [] },
  },
};

const structuredFixture = {
  structuredProfile: {
    skillDomains: [{ name: 'Leadership', confidence: 0.9, evidence: [] }],
    domains: [{ name: 'Healthcare', confidence: 0.9, evidence: [] }],
    responsibilities: [{ description: 'Leading product delivery across clinical teams', confidence: 0.9, evidence: [] }],
    skills: [{ name: 'Product Management', level: 'advanced', confidence: 0.9, evidence: [] }],
    learningGoals: [{ name: 'Regulatory affairs', confidence: 0.5, evidence: [] }],
  },
  seniority: {
    currentStatus: { value: 'employed', confidence: 0.9, evidence: [] },
    yearsOfExperience: { value: '8 years', confidence: 0.9, evidence: [] },
    highestDegree: { value: 'Master of Science', confidence: 0.8, evidence: [] },
    mostSeniorRole: { value: 'Director', confidence: 0.8, evidence: [] },
  },
};

describe('fan-out CV extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    interpretCvIdentityText.mockResolvedValue(normalizeInterpretationShape(identityFixture));
    interpretCvStructuredText.mockResolvedValue(normalizeInterpretationShape(structuredFixture));
  });

  test('starts identity and structured in parallel; structured stays pending in initial bundle', async () => {
    const result = await extractProfileDataFromDocumentText('John Smith\nProduct Manager', {
      uiLanguage: 'en',
      skipLocalization: true,
    });

    expect(interpretCvIdentityText).toHaveBeenCalledTimes(1);
    expect(interpretCvStructuredText).toHaveBeenCalledTimes(1);
    expect(result.semanticEnrichmentStatus).toBe('pending');
    expect(result.profile.structuredUserInfo.skills).toEqual([]);
    expect(result.profile.userIdentity.workEnjoyMost).toContain('Building products');
  });

  test('marks enrichment pending and omits skills-only structured output', async () => {
    interpretCvStructuredText.mockResolvedValue(
      normalizeInterpretationShape({
        structuredProfile: {
          skillDomains: [],
          domains: [],
          responsibilities: [],
          skills: [
            { name: 'Senior PM at Acme Corp 2019 - Present Led cross-functional teams', confidence: 0.5, evidence: [] },
            { name: 'MBA Harvard Business School', confidence: 0.5, evidence: [] },
          ],
          learningGoals: [],
        },
      })
    );

    const result = await extractProfileDataFromDocumentText('John Smith\nProduct Manager', {
      uiLanguage: 'en',
      skipLocalization: true,
    });

    expect(result.semanticEnrichmentStatus).toBe('pending');
    expect(result.profile.structuredUserInfo.skills).toEqual([]);
    expect(result.profile.userIdentity.workEnjoyMost).toContain('Building products');
  });

  test('falls back to heuristics when AI interpretation fails but omits good-at fields', async () => {
    interpretCvIdentityText.mockResolvedValue(null);
    interpretCvStructuredText.mockResolvedValue(null);

    const cvText = `
John Doe
Skills: JavaScript, React, Node.js
Experience
Software Engineer at ExampleCorp
`;

    const result = await extractProfileDataFromDocumentText(cvText, {
      uiLanguage: 'en',
      skipLocalization: true,
    });

    expect(result.semanticEnrichmentStatus).toBe('skipped');
    expect(result.status).toBe('partial');
    expect(result.messageKey).toBe('documentUpload.extraction.heuristicFallback');
    expect(result.profile.structuredUserInfo.skills).toEqual([]);
  });

  test('returns empty structured fields when AI and heuristics both fail', async () => {
    interpretCvIdentityText.mockResolvedValue(null);
    interpretCvStructuredText.mockResolvedValue(null);

    const result = await extractProfileDataFromDocumentText('   ', {
      uiLanguage: 'en',
      skipLocalization: true,
    });

    expect(result.semanticEnrichmentStatus).toBe('skipped');
    expect(result.profile.structuredUserInfo.skills).toEqual([]);
  });
});
