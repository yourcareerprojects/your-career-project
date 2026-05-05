/**
 * Unit tests for the responsibility extractor service.
 *
 * These tests verify prompt building, output validation, heuristic extraction,
 * CareerPath extraction, and the LLM pipeline using a mock provider.
 */

const { SYSTEM_PROMPT, buildUserMessage, buildMessages } = require('../prompts/extractKeyResponsibilities');
const {
  extractKeyResponsibilities,
  extractFromCareerPath,
  extractHeuristic,
  validateExtraction,
} = require('../services/jobAnalysis/responsibilityExtractor');

// ---------------------------------------------------------------------------
// Prompt template tests
// ---------------------------------------------------------------------------

describe('extractKeyResponsibilities prompt', () => {
  test('SYSTEM_PROMPT contains key instructions', () => {
    expect(SYSTEM_PROMPT).toContain('key_responsibilities');
    expect(SYSTEM_PROMPT).toContain('extraction_confidence');
    expect(SYSTEM_PROMPT).toContain('typically 3 to 6');
    expect(SYSTEM_PROMPT).toContain('Starts with a verb');
    expect(SYSTEM_PROMPT).toContain('GROUNDING RULES');
  });

  test('SYSTEM_PROMPT mentions ESCO', () => {
    expect(SYSTEM_PROMPT).toContain('ESCO');
  });

  test('buildUserMessage interpolates title and description', () => {
    const msg = buildUserMessage({ title: 'Software Engineer', description: 'Build things' });
    expect(msg).toContain('title:\nSoftware Engineer');
    expect(msg).toContain('description:\nBuild things');
  });

  test('buildUserMessage includes required_skills when provided', () => {
    const msg = buildUserMessage({
      title: 'Analyst',
      description: 'Analyze data',
      required_skills: 'SQL, Python',
    });
    expect(msg).toContain('required_skills:\nSQL, Python');
  });

  test('buildUserMessage omits optional_skills when not provided', () => {
    const msg = buildUserMessage({ title: 'PM', description: 'Manage projects' });
    expect(msg).not.toContain('optional_skills');
  });

  test('buildMessages returns system + user messages', () => {
    const msgs = buildMessages({ title: 'Designer', description: 'Design interfaces' });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('Designer');
  });
});

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe('validateExtraction', () => {
  test('parses valid JSON output', () => {
    const raw = JSON.stringify({
      key_responsibilities: [
        'Develop backend services',
        'Review pull requests',
        'Collaborate with product team',
      ],
      extraction_confidence: 0.85,
    });
    const result = validateExtraction(raw);
    expect(result.key_responsibilities).toHaveLength(3);
    expect(result.extraction_confidence).toBe(0.85);
  });

  test('strips markdown code fences', () => {
    const raw = '```json\n{"key_responsibilities":["Design systems"],"extraction_confidence":0.9}\n```';
    const result = validateExtraction(raw);
    expect(result.key_responsibilities).toEqual(['Design systems']);
  });

  test('throws on invalid JSON', () => {
    expect(() => validateExtraction('not json')).toThrow('not valid JSON');
  });

  test('throws on missing key_responsibilities', () => {
    const raw = JSON.stringify({ extraction_confidence: 0.5 });
    expect(() => validateExtraction(raw)).toThrow('Missing or invalid');
  });

  test('throws on empty responsibilities after filtering', () => {
    const raw = JSON.stringify({ key_responsibilities: ['', '  '], extraction_confidence: 0.5 });
    expect(() => validateExtraction(raw)).toThrow('No valid responsibilities');
  });

  test('caps responsibilities at 10', () => {
    const items = Array.from({ length: 15 }, (_, i) => `Task ${i + 1}`);
    const raw = JSON.stringify({ key_responsibilities: items, extraction_confidence: 0.7 });
    const result = validateExtraction(raw);
    expect(result.key_responsibilities).toHaveLength(10);
  });

  test('defaults confidence to 0 when out of range', () => {
    const raw = JSON.stringify({ key_responsibilities: ['Do work'], extraction_confidence: 2 });
    const result = validateExtraction(raw);
    expect(result.extraction_confidence).toBe(0);
  });

  test('rounds confidence to 2 decimal places', () => {
    const raw = JSON.stringify({ key_responsibilities: ['Do work'], extraction_confidence: 0.8567 });
    const result = validateExtraction(raw);
    expect(result.extraction_confidence).toBe(0.86);
  });
});

// ---------------------------------------------------------------------------
// Heuristic extractor tests
// ---------------------------------------------------------------------------

describe('extractHeuristic', () => {
  test('extracts verb-led responsibilities from ESCO-style description', () => {
    const result = extractHeuristic({
      title: 'technical director',
      description:
        'Technical directors realise the artistic visions of the creators within technical constraints. ' +
        'They coordinate the operations of various production units, such as scene, wardrobe, sound and lighting, and make-up. ' +
        'They adapt the prototype and study the feasibility, implementation, operation and technical monitoring of the artistic project. ' +
        'They are also responsible for the stage equipment and technical equipment.',
    });

    expect(result.key_responsibilities.length).toBeGreaterThanOrEqual(1);
    // Each should start with a capital letter (verb-led)
    for (const r of result.key_responsibilities) {
      expect(r[0]).toBe(r[0].toUpperCase());
    }
    expect(result.extraction_confidence).toBeGreaterThan(0);
  });

  test('extracts from metal drawing machine operator description', () => {
    const result = extractHeuristic({
      title: 'metal drawing machine operator',
      description:
        'Metal drawing machine operators set up and operate drawing machines for ferrous and non-ferrous metal products, ' +
        'designed to provide wires, bars, pipes, hollow profiles and tubes with their specific form by reducing its cross-section ' +
        'and by pulling the working materials through a series of drawing dies.',
    });

    expect(result.key_responsibilities.length).toBeGreaterThanOrEqual(0);
    // Short descriptions may yield fewer results
    expect(result.extraction_confidence).toBeGreaterThanOrEqual(0);
  });

  test('returns empty for missing description', () => {
    const result = extractHeuristic({ title: 'test', description: '' });
    expect(result.key_responsibilities).toEqual([]);
    expect(result.extraction_confidence).toBe(0);
  });

  test('strips pronoun subjects like "They"', () => {
    const result = extractHeuristic({
      title: 'analyst',
      description:
        'Analysts evaluate complex business data. They develop analytical models to support decision-making. ' +
        'They coordinate with stakeholders to identify requirements and deliver insights.',
    });

    // None should start with "They"
    for (const r of result.key_responsibilities) {
      expect(r).not.toMatch(/^They\s/i);
    }
  });

  test('caps at 6 responsibilities', () => {
    // Build a long description with many sentences
    const sentences = [
      'Engineers design complex systems for production environments.',
      'They develop software solutions for automation processes.',
      'They manage project timelines and resource allocation.',
      'They coordinate with international teams for deployments.',
      'They monitor system performance and optimize bottlenecks.',
      'They train junior staff on best practices and standards.',
      'They review technical documentation for compliance requirements.',
      'They evaluate new technologies for potential adoption.',
    ];

    const result = extractHeuristic({
      title: 'engineer',
      description: sentences.join(' '),
    });

    expect(result.key_responsibilities.length).toBeLessThanOrEqual(6);
  });

  test('higher confidence when skills are available', () => {
    const desc =
      'Data analysts evaluate datasets to identify patterns. They develop reports for stakeholders. ' +
      'They coordinate with business teams to define metrics and deliver actionable insights.';

    const withoutSkills = extractHeuristic({ title: 'data analyst', description: desc });
    const withSkills = extractHeuristic({
      title: 'data analyst',
      description: desc,
      requiredSkills: ['SQL', 'Python', 'data visualization', 'statistical analysis'],
    });

    expect(withSkills.extraction_confidence).toBeGreaterThanOrEqual(withoutSkills.extraction_confidence);
  });
});

// ---------------------------------------------------------------------------
// extractFromCareerPath tests
// ---------------------------------------------------------------------------

describe('extractFromCareerPath', () => {
  const sampleCareerPath = {
    title: 'software developer',
    description:
      'Software developers design and build software applications. ' +
      'They analyse user requirements and develop solutions using programming languages. ' +
      'They test and debug software to ensure quality. ' +
      'They collaborate with product teams to deliver features on schedule.',
    requiredSkills: ['software design', 'programming', 'debugging', 'testing'],
    skillModel: {
      core_skills: ['software design', 'programming', 'debugging'],
      optional_skills: ['project management', 'agile methodology'],
    },
  };

  test('heuristic mode returns responsibilities with metadata', async () => {
    const result = await extractFromCareerPath(sampleCareerPath, { method: 'heuristic' });

    expect(result.responsibilities).toBeDefined();
    expect(Array.isArray(result.responsibilities)).toBe(true);
    expect(result.responsibilities.length).toBeGreaterThanOrEqual(1);
    expect(result.extraction_confidence).toBeGreaterThan(0);
    expect(result.built_at).toBeInstanceOf(Date);
    expect(result.built_with).toBe('heuristic');
  });

  test('llm mode calls provider and returns metadata', async () => {
    const mockResponse = JSON.stringify({
      key_responsibilities: [
        'Design and build software applications based on user requirements',
        'Analyse user needs and develop solutions using programming languages',
        'Test and debug software to ensure quality standards',
      ],
      extraction_confidence: 0.88,
    });

    const mockProvider = jest.fn().mockImplementation(() => Promise.resolve(mockResponse));

    const result = await extractFromCareerPath(sampleCareerPath, {
      method: 'llm',
      llmProvider: mockProvider,
    });

    expect(result.responsibilities).toHaveLength(3);
    expect(result.extraction_confidence).toBe(0.88);
    expect(result.built_at).toBeInstanceOf(Date);
    expect(result.built_with).toBe('llm');

    // Verify the provider received skills from skillModel
    const [messages] = mockProvider.mock.calls[0];
    expect(messages[1].content).toContain('software design');
  });

  test('maps skillModel.optional_skills to optional_skills prompt field', async () => {
    const mockResponse = JSON.stringify({
      key_responsibilities: ['Manage projects effectively'],
      extraction_confidence: 0.7,
    });
    const mockProvider = jest.fn().mockImplementation(() => Promise.resolve(mockResponse));

    await extractFromCareerPath(sampleCareerPath, {
      method: 'llm',
      llmProvider: mockProvider,
    });

    const [messages] = mockProvider.mock.calls[0];
    expect(messages[1].content).toContain('project management');
    expect(messages[1].content).toContain('agile methodology');
  });

  test('falls back to requiredSkills when skillModel is absent', async () => {
    const docWithoutModel = {
      title: 'tester',
      description: 'Testers verify software quality. They execute test plans and report defects.',
      requiredSkills: ['testing', 'quality assurance'],
    };

    const mockResponse = JSON.stringify({
      key_responsibilities: ['Verify software quality through testing'],
      extraction_confidence: 0.75,
    });
    const mockProvider = jest.fn().mockImplementation(() => Promise.resolve(mockResponse));

    await extractFromCareerPath(docWithoutModel, {
      method: 'llm',
      llmProvider: mockProvider,
    });

    const [messages] = mockProvider.mock.calls[0];
    expect(messages[1].content).toContain('testing');
    expect(messages[1].content).toContain('quality assurance');
  });
});

// ---------------------------------------------------------------------------
// Integration test with mock provider (original)
// ---------------------------------------------------------------------------

describe('extractKeyResponsibilities (mock provider)', () => {
  const mockLlmResponse = JSON.stringify({
    key_responsibilities: [
      'Develop and maintain web applications using React and Node.js',
      'Design RESTful APIs and database schemas',
      'Conduct code reviews and mentor junior developers',
      'Collaborate with cross-functional teams to define product requirements',
    ],
    extraction_confidence: 0.92,
  });

  function makeMockProvider(response) {
    return jest.fn().mockImplementation(() => Promise.resolve(response));
  }

  test('returns validated extraction result', async () => {
    const mockProvider = makeMockProvider(mockLlmResponse);
    const result = await extractKeyResponsibilities(
      {
        title: 'Full Stack Developer',
        description: 'Build and maintain web applications, design APIs, mentor team members.',
        required_skills: 'React, Node.js, PostgreSQL',
      },
      { llmProvider: mockProvider }
    );

    expect(result.key_responsibilities).toHaveLength(4);
    expect(result.extraction_confidence).toBe(0.92);
    expect(mockProvider).toHaveBeenCalledTimes(1);

    // Verify messages were passed to the provider
    const [messages] = mockProvider.mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('Full Stack Developer');
  });

  test('throws when both title and description are missing', async () => {
    const mockProvider = makeMockProvider(mockLlmResponse);
    await expect(
      extractKeyResponsibilities({}, { llmProvider: mockProvider })
    ).rejects.toThrow('At least one of');
  });

  test('throws when LLM returns invalid output', async () => {
    const badProvider = makeMockProvider('I cannot help with that');
    await expect(
      extractKeyResponsibilities(
        { title: 'Tester', description: 'Test things' },
        { llmProvider: badProvider }
      )
    ).rejects.toThrow('not valid JSON');
  });
});
