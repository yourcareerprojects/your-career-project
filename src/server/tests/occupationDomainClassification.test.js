/**
 * Unit tests for occupation domain classification validation + prompt helpers.
 */

const {
  validateClassificationResponse,
  parseJsonObject,
  resolveAllowedDomain,
  MANUAL_REVIEW_CONFIDENCE_THRESHOLD,
} = require('../services/occupationDomainClassification/domainClassificationValidation');
const {
  buildOccupationClassificationInput,
  buildClassificationChatMessages,
} = require('../services/occupationDomainClassification/domainClassificationPrompt');
const { INDUSTRY_CANONICAL_LABELS } = require('../../constants/industries');

describe('occupation domain classification validation', () => {
  test('accepts valid JSON with taxonomy domain', () => {
    const result = validateClassificationResponse(
      JSON.stringify({
        domain: 'Software',
        confidence: 0.97,
        reason: 'Develops software systems.',
      }),
      { model: 'gpt-test', escoId: 'esco-1' }
    );
    expect(result.domain).toBe('Software');
    expect(result.confidence).toBe(0.97);
    expect(result.needsManualReview).toBe(false);
    expect(result.model).toBe('gpt-test');
  });

  test('maps aliases to canonical labels', () => {
    const result = validateClassificationResponse(
      JSON.stringify({ domain: 'fintech', confidence: 0.8, reason: 'Banking systems' }),
      { model: 'gpt-test' }
    );
    expect(result.domain).toBe('Finance');
    expect(result.needsManualReview).toBe(false);
  });

  test('flags low confidence for manual review but still accepts', () => {
    const result = validateClassificationResponse(
      JSON.stringify({
        domain: 'Healthcare',
        confidence: MANUAL_REVIEW_CONFIDENCE_THRESHOLD - 0.01,
        reason: 'Ambiguous clinical vs admin role',
      }),
      { model: 'gpt-test' }
    );
    expect(result.domain).toBe('Healthcare');
    expect(result.needsManualReview).toBe(true);
  });

  test('rejects invented domains', () => {
    expect(() =>
      validateClassificationResponse(
        JSON.stringify({ domain: 'IT & Software', confidence: 0.9, reason: 'x' }),
        { model: 'gpt-test' }
      )
    ).toThrow(/not in allowed list/i);
  });

  test('rejects UNASSIGNED as a classification result', () => {
    expect(() => resolveAllowedDomain('UNASSIGNED')).toThrow(/not in allowed list/i);
  });

  test('rejects invalid JSON', () => {
    expect(() => validateClassificationResponse('not-json', { model: 'gpt-test' })).toThrow(
      /Invalid JSON/i
    );
  });

  test('parses fenced JSON', () => {
    const parsed = parseJsonObject('```json\n{"domain":"Software","confidence":1,"reason":"ok"}\n```');
    expect(parsed.domain).toBe('Software');
  });

  test('allowed list matches industry taxonomy (no invented labels)', () => {
    expect(INDUSTRY_CANONICAL_LABELS).not.toContain('IT & Software');
    expect(INDUSTRY_CANONICAL_LABELS).toContain('Software');
  });
});

describe('occupation domain classification prompt', () => {
  test('builds input from career path fields', () => {
    const input = buildOccupationClassificationInput({
      escoId: 'http://data.europa.eu/esco/occupation/x',
      title: { en: 'software developer', de: 'Softwareentwickler' },
      altTitles: ['programmer'],
      description: { en: 'Develops applications.', de: null },
      iscoGroup: '25',
      requiredSkills: ['Java'],
      skillModel: {
        core_skills: ['Java', 'Git'],
        optional_skills: ['Docker'],
      },
      keyResponsibilities: {
        responsibilities: ['Design software components'],
      },
      skillDomains: {
        skill_domains: [{ domain: { en: 'Software Engineering', de: null }, importance: 'core' }],
      },
    });

    expect(input.title).toBe('software developer');
    expect(input.alternativeTitles).toEqual(['programmer']);
    expect(input.requiredSkills).toEqual(['Java', 'Git']);
    expect(input.optionalSkills).toEqual(['Docker']);
    expect(input.responsibilities).toEqual(['Design software components']);
    expect(input.skillDomains).toEqual(['Software Engineering']);
    expect(input.iscoGroup).toBe('25');
    expect(input.iscoGroupLabels.length).toBeGreaterThan(0);
  });

  test('chat messages include allowed domain list', () => {
    const messages = buildClassificationChatMessages({
      title: { en: 'nurse', de: null },
      description: { en: 'Provides patient care', de: null },
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Healthcare');
    expect(messages[0].content).toContain('Animals and Veterinary');
    expect(messages[0].content).toContain('Software');
    expect(messages[0].content).toMatch(/PRIMARY WORK CONTEXT/i);
  });
});
