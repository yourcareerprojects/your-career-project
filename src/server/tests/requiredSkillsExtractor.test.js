/**
 * Unit tests for the required skills extractor service.
 */

const { SYSTEM_PROMPT, buildUserMessage, buildMessages } = require('../prompts/extractRequiredSkills');
const {
  extractRequiredSkills,
  extractFromCareerPath,
  validateExtraction,
  buildSkillModelFromExtraction,
  MIN_CORE,
} = require('../services/jobAnalysis/requiredSkillsExtractor');

describe('extractRequiredSkills prompt', () => {
  test('SYSTEM_PROMPT contains key instructions', () => {
    expect(SYSTEM_PROMPT).toContain('core_skills');
    expect(SYSTEM_PROMPT).toContain('optional_skills');
    expect(SYSTEM_PROMPT).toContain('extraction_confidence');
    expect(SYSTEM_PROMPT).toContain('GROUNDING RULES');
    expect(SYSTEM_PROMPT).toContain('Ignore any existing "current_skills"');
  });

  test('buildUserMessage interpolates title and description', () => {
    const msg = buildUserMessage({ title: 'Welder', description: 'Join metal parts' });
    expect(msg).toContain('title:\nWelder');
    expect(msg).toContain('description:\nJoin metal parts');
  });

  test('buildUserMessage includes key_responsibilities when provided', () => {
    const msg = buildUserMessage({
      title: 'Welder',
      description: 'Join metal parts',
      key_responsibilities: 'Perform arc welding\nInspect weld seams',
    });
    expect(msg).toContain('key_responsibilities:\nPerform arc welding');
  });

  test('buildMessages returns system + user messages', () => {
    const msgs = buildMessages({ title: 'Baker', description: 'Bake bread' });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });
});

describe('validateExtraction', () => {
  test('parses valid JSON output', () => {
    const raw = JSON.stringify({
      core_skills: ['Pipe welding', 'Blueprint reading', 'Metal cutting'],
      optional_skills: ['CNC operation'],
      extraction_confidence: 0.9,
    });
    const result = validateExtraction(raw);
    expect(result.core_skills).toHaveLength(3);
    expect(result.optional_skills).toEqual(['CNC operation']);
    expect(result.extraction_confidence).toBe(0.9);
  });

  test('dedupes core and optional overlap', () => {
    const raw = JSON.stringify({
      core_skills: ['Sewing', 'Pattern making', 'Fabric cutting'],
      optional_skills: ['Sewing', 'Embroidery'],
      extraction_confidence: 0.8,
    });
    const result = validateExtraction(raw);
    expect(result.optional_skills).toEqual(['Embroidery']);
  });

  test('rejects too few core skills', () => {
    const raw = JSON.stringify({
      core_skills: ['Sewing', 'Cutting'],
      optional_skills: [],
      extraction_confidence: 0.5,
    });
    expect(() => validateExtraction(raw)).toThrow(`at least ${MIN_CORE} core skills`);
  });

  test('strips markdown fences', () => {
    const raw = '```json\n' + JSON.stringify({
      core_skills: ['A', 'B', 'C'],
      optional_skills: [],
      extraction_confidence: 0.7,
    }) + '\n```';
    const result = validateExtraction(raw);
    expect(result.core_skills).toEqual(['A', 'B', 'C']);
  });
});

describe('buildSkillModelFromExtraction', () => {
  test('builds weighted skill model', () => {
    const model = buildSkillModelFromExtraction({
      core_skills: ['Welding', 'Assembly', 'Inspection'],
      optional_skills: ['CAD'],
      extraction_confidence: 0.85,
    });
    expect(model.built_with).toBe('llm');
    expect(model.core_skills).toHaveLength(3);
    expect(model.skill_weights.Welding).toBeGreaterThan(model.skill_weights.Inspection);
    expect(model.skill_weights.CAD).toBeLessThanOrEqual(0.5);
  });
});

describe('extractRequiredSkills with mock provider', () => {
  test('calls LLM provider and validates output', async () => {
    const mockResponse = JSON.stringify({
      core_skills: [
        'Garment alteration',
        'Sewing machine operation',
        'Pattern adjustment',
        'Fabric repair',
      ],
      optional_skills: ['Customer fitting'],
      extraction_confidence: 0.92,
    });

    const llmProvider = jest.fn().mockResolvedValue(mockResponse);
    const result = await extractRequiredSkills(
      { title: 'Tailor', description: 'Alter garments for customers.' },
      { llmProvider }
    );

    expect(llmProvider).toHaveBeenCalledTimes(1);
    expect(result.core_skills).toHaveLength(4);
    expect(result.extraction_confidence).toBe(0.92);
  });
});

describe('extractFromCareerPath', () => {
  test('maps CareerPath fields and returns DB-ready payload', async () => {
    const mockResponse = JSON.stringify({
      core_skills: ['Heating installation', 'Pipe fitting', 'System maintenance'],
      optional_skills: ['Energy efficiency'],
      extraction_confidence: 0.88,
    });

    const result = await extractFromCareerPath(
      {
        title: { en: 'SHK Mechanic' },
        description: { en: 'Installs heating and plumbing systems.' },
        keyResponsibilities: {
          responsibilities: ['Install pipe networks', 'Service heating systems'],
        },
        requiredSkills: ['Maintenance', 'Quality control'],
      },
      { llmProvider: jest.fn().mockResolvedValue(mockResponse) }
    );

    expect(result.requiredSkills).toHaveLength(3);
    expect(result.requiredSkillKeys).toContain('heating_installation');
    expect(result.skillModel.built_with).toBe('llm');
    expect(result.extraction_confidence).toBe(0.88);
  });
});
