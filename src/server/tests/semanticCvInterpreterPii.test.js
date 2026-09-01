jest.mock('../services/jobAnalysis/roleIdentityComposer', () => ({
  openaiProvider: jest.fn(),
}));

const { openaiProvider } = require('../services/jobAnalysis/roleIdentityComposer');
const {
  interpretCvIdentityText,
  interpretCvStructuredText,
  __testables,
} = require('../services/documents/semanticCvInterpreter');
const { PLACEHOLDER } = require('../services/cv/redactCvContactPii');

const identityJson = JSON.stringify({
  userIdentity: {
    workEnjoyment: { bullets: ['Building products'], confidence: 0.9, evidence: [] },
    interests: { bullets: ['Healthcare'], confidence: 0.8, evidence: [] },
    strengths: { bullets: ['Communication'], confidence: 0.8, evidence: [] },
    workStyle: { bullets: ['Collaborative teams'], confidence: 0.7, evidence: [] },
    careerGoals: { bullets: ['Lead teams'], confidence: 0.6, evidence: [] },
  },
});

const structuredJson = JSON.stringify({
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
    highestDegree: { value: 'masters', confidence: 0.8, evidence: [] },
    mostSeniorRole: { value: 'Director', confidence: 0.8, evidence: [] },
  },
});

function userMessageContent() {
  const messages = openaiProvider.mock.calls[0][0];
  const user = messages.find((m) => m.role === 'user');
  return String(user?.content || '');
}

describe('semanticCvInterpreter OpenAI PII redaction', () => {
  const prevKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    __testables.resetResultCache();
    openaiProvider.mockReset();
  });

  afterAll(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });

  test('identity interpretation sends redacted CV text, not contact PII', async () => {
    openaiProvider.mockResolvedValue(identityJson);
    const cv = 'Jane Doe\njane.doe@example.com\n+49 176 12345678\n123 Main Street\nSoftware Engineer at Acme';

    await interpretCvIdentityText(cv, { documentLanguage: 'en' });

    expect(openaiProvider).toHaveBeenCalledTimes(1);
    const sent = userMessageContent();
    expect(sent).toContain(PLACEHOLDER.EMAIL);
    expect(sent).toContain(PLACEHOLDER.PHONE);
    expect(sent).toContain(PLACEHOLDER.ADDRESS);
    expect(sent).not.toContain('jane.doe@example.com');
    expect(sent).not.toContain('176 12345678');
    expect(sent).not.toContain('123 Main Street');
    expect(sent).toContain('Software Engineer at Acme');
    expect(sent).toContain('Jane Doe');
  });

  test('structured interpretation sends redacted CV text, not contact PII', async () => {
    openaiProvider.mockResolvedValue(structuredJson);
    const cv = 'Max Mustermann\nmax@example.org\nMusterstraße 8, 80331 München\nProduct Manager';

    await interpretCvStructuredText(cv, { documentLanguage: 'de' });

    expect(openaiProvider).toHaveBeenCalledTimes(1);
    const sent = userMessageContent();
    expect(sent).toContain(PLACEHOLDER.EMAIL);
    expect(sent).toContain(PLACEHOLDER.ADDRESS);
    expect(sent).not.toContain('max@example.org');
    expect(sent).not.toContain('Musterstraße 8');
    expect(sent).toContain('Product Manager');
  });
});
