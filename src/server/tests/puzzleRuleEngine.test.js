/**
 * Unit tests for ESCO hybrid rule helpers and next-step merge.
 */

const {
  pieceKeyFromEscoId,
} = require('../services/careerPuzzle/puzzleEscoMaterializer');

const {
  mergeNextSteps,
  mergeNextStepsByCategory,
  NEXT_STEPS_FETCH_CEILING,
  NEXT_STEPS_PER_CATEGORY,
  edgeSource,
} = require('../services/careerPuzzle/puzzleGraphService');

const {
  iscoFamilyPrefix,
  allowedSeniorityStepLevels,
  getRuleHints,
  RULE_HINTS_BY_KEY,
  buildIscoPrefixRegex,
} = require('../services/careerPuzzle/puzzleRuleEngine');

describe('pieceKeyFromEscoId', () => {
  it('builds a stable esco.* key from a URI', () => {
    const key = pieceKeyFromEscoId(
      'http://data.europa.eu/esco/occupation/123-abc'
    );
    expect(key).toBe('esco.data_europa_eu_esco_occupation_123_abc');
  });

  it('is idempotent for the same escoId', () => {
    const a = pieceKeyFromEscoId('http://data.europa.eu/esco/occupation/x');
    const b = pieceKeyFromEscoId('http://data.europa.eu/esco/occupation/x');
    expect(a).toBe(b);
  });

  it('throws without escoId', () => {
    expect(() => pieceKeyFromEscoId('')).toThrow(/escoId/i);
  });
});

describe('edgeSource / mergeNextSteps', () => {
  it('treats missing metadata.source as curated', () => {
    expect(edgeSource({})).toBe('curated');
    expect(edgeSource({ metadata: { source: 'rule' } })).toBe('rule');
  });

  it('puts curated before rule and hard-caps at fetch ceiling', () => {
    const curated = [1, 2, 3].map((n) => ({
      piece: { id: `c${n}`, category: 'occupation' },
      source: 'curated',
      edge: { weight: 10 - n, metadata: { source: 'curated' } },
    }));
    const rules = Array.from({ length: NEXT_STEPS_FETCH_CEILING }, (_, i) => ({
      piece: { id: `r${i + 1}`, category: 'occupation' },
      source: 'rule',
      ruleId: 'apprenticeship_to_occupation',
      edge: {
        weight: 40,
        metadata: { source: 'rule', ruleId: 'apprenticeship_to_occupation' },
      },
    }));

    const merged = mergeNextSteps(curated, rules, NEXT_STEPS_FETCH_CEILING);
    expect(merged).toHaveLength(NEXT_STEPS_FETCH_CEILING);
    expect(merged.map((s) => s.piece.id).slice(0, 3)).toEqual(['c1', 'c2', 'c3']);
    expect(merged.slice(0, 3).every((s) => s.source === 'curated')).toBe(true);
    expect(merged.slice(3).every((s) => s.source === 'rule')).toBe(true);
  });

  it('dedupes by piece id across curated and rule', () => {
    const curated = [
      { piece: { id: 'same', category: 'occupation' }, source: 'curated', edge: {} },
    ];
    const rules = [
      { piece: { id: 'same', category: 'occupation' }, source: 'rule', edge: {} },
      { piece: { id: 'other', category: 'occupation' }, source: 'rule', edge: {} },
    ];
    const merged = mergeNextSteps(curated, rules, 5);
    expect(merged.map((s) => s.piece.id)).toEqual(['same', 'other']);
  });
});

describe('mergeNextStepsByCategory', () => {
  it('keeps at most three steps per category and prefers curated', () => {
    expect(NEXT_STEPS_PER_CATEGORY).toBe(3);

    const curated = [
      { piece: { id: 'c1', category: 'occupation' }, source: 'curated', edge: {} },
      { piece: { id: 'c2', category: 'occupation' }, source: 'curated', edge: {} },
      { piece: { id: 'c3', category: 'university' }, source: 'curated', edge: {} },
      { piece: { id: 'c4', category: 'occupation' }, source: 'curated', edge: {} },
    ];
    const rules = [
      { piece: { id: 'r1', category: 'occupation' }, source: 'rule', edge: {} },
      { piece: { id: 'r2', category: 'university' }, source: 'rule', edge: {} },
      { piece: { id: 'r3', category: 'university' }, source: 'rule', edge: {} },
      { piece: { id: 'r4', category: 'university' }, source: 'rule', edge: {} },
      { piece: { id: 'r5', category: 'apprenticeship' }, source: 'rule', edge: {} },
    ];

    const merged = mergeNextStepsByCategory(curated, rules);
    const byCategory = merged.reduce((acc, step) => {
      const cat = step.piece.category;
      acc[cat] = acc[cat] || [];
      acc[cat].push(step.piece.id);
      return acc;
    }, {});

    expect(byCategory.occupation).toEqual(['c1', 'c2', 'c4']);
    expect(byCategory.university).toEqual(['c3', 'r2', 'r3']);
    expect(byCategory.apprenticeship).toEqual(['r5']);
    expect(merged.every((s) => (byCategory[s.piece.category] || []).length <= 3)).toBe(
      true
    );
  });

  it('normalizes legacy categories before capping', () => {
    const curated = [
      { piece: { id: 'p1', category: 'promotion' }, source: 'curated', edge: {} },
      { piece: { id: 'p2', category: 'occupation' }, source: 'curated', edge: {} },
    ];
    const merged = mergeNextStepsByCategory(curated, []);
    expect(merged).toHaveLength(2);
    expect(merged.map((s) => s.piece.id)).toEqual(['p1', 'p2']);
    expect(merged.every((s) => s.piece.category === 'occupation')).toBe(true);
  });
});

describe('rule engine pure helpers', () => {
  it('exposes hints for electrician apprenticeship', () => {
    expect(RULE_HINTS_BY_KEY['appr.electrician'].iscoPrefix).toBe('74');
    expect(getRuleHints({ key: 'appr.electrician' }).iscoPrefix).toBe('74');
  });

  it('computes ISCO family prefix', () => {
    expect(iscoFamilyPrefix('7412')).toBe('741');
    expect(iscoFamilyPrefix('74')).toBe('74');
    expect(iscoFamilyPrefix('')).toBe('');
  });

  it('allows only +1 seniority step', () => {
    expect(allowedSeniorityStepLevels(2)).toEqual([3]);
    expect(allowedSeniorityStepLevels(6)).toEqual([]);
    expect(allowedSeniorityStepLevels(0)).toEqual([1]);
  });

  it('builds anchored ISCO regex', () => {
    const re = buildIscoPrefixRegex('74');
    expect(re.test('7412')).toBe(true);
    expect(re.test('2512')).toBe(false);
  });
});
