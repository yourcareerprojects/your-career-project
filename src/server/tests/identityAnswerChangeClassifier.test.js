const {
  isMinorTextEdit,
  classifyIdentityAnswerChanges,
  isMinorStructuredListEdit,
} = require('../services/profile/identityAnswerChangeClassifier');

describe('identityAnswerChangeClassifier', () => {
  test('treats typo-level edits as minor', () => {
    expect(isMinorTextEdit(
      'Solving practical product problems',
      'Solving practical product problem'
    )).toBe(true);
    expect(isMinorTextEdit(
      'Health tech and education sectors',
      'Health tech and education sector'
    )).toBe(true);
  });

  test('treats rewrites as major', () => {
    expect(isMinorTextEdit(
      'Solving practical product problems',
      'I lead platform strategy for growth-stage SaaS companies.'
    )).toBe(false);
  });

  test('classifies mixed identity answer changes', () => {
    const previous = [
      'Line one stays',
      'Line two old',
      'Line three',
      'Line four',
      'Line five',
    ];
    const next = [
      'Line one stays',
      'Line two with a tiny wording tweak',
      'Completely different third answer about another topic entirely.',
      'Line four',
      'Line five',
    ];
    const result = classifyIdentityAnswerChanges(previous, next);
    expect(result.hasChanges).toBe(true);
    expect(result.minorIndices).toEqual([]);
    expect(result.majorIndices.sort()).toEqual([1, 2]);
    expect(result.hasMajorChange).toBe(true);
    expect(result.onlyMinorChanges).toBe(false);
  });

  test('classifies all-minor identity edits', () => {
    const previous = [
      'Solving practical product problems',
      'Health tech and education',
      'Turning ambiguity into clear plans',
      'Calm teams with shared ownership',
      'Build products that improve access',
    ];
    const next = [
      'Solving practical product problem',
      'Health tech and education',
      'Turning ambiguity into clearer plans',
      'Calm teams with shared ownership',
      'Build products that improve access',
    ];
    const result = classifyIdentityAnswerChanges(previous, next);
    expect(result.onlyMinorChanges).toBe(true);
    expect(result.hasMajorChange).toBe(false);
    expect(result.minorIndices.sort()).toEqual([0, 2]);
  });

  test('detects minor structured list edits without length changes', () => {
    expect(isMinorStructuredListEdit(
      ['Stakeholder management', 'Roadmapping'],
      ['Stakeholder management', 'Road-mapping']
    )).toBe(true);
    expect(isMinorStructuredListEdit(
      ['Stakeholder management'],
      ['Stakeholder management', 'Facilitation']
    )).toBe(false);
  });
});
