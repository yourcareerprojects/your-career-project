/**
 * Unit tests for semantic trait matching playground utility.
 */

const {
  rankTraitScores,
  rankTraitsByVector,
  DEFAULT_TOP_K,
} = require('../services/careerIdentity/semanticTraitMatcher');
const {
  listPlaygroundExamples,
  getPlaygroundExample,
} = require('../services/careerIdentity/semanticTraitPlaygroundExamples');
const { l2Normalize, EMBEDDING_DIMS } = require('../services/embedding/embeddingService');
const { getTraitDefinition } = require('../../constants/identityTraitCatalog');

function unitVector(dim) {
  const vec = new Float32Array(EMBEDDING_DIMS);
  vec[dim] = 1;
  return vec;
}

describe('semanticTraitMatcher', () => {
  it('ranks identical vectors highest', () => {
    const query = unitVector(3);
    const traitEmbeddings = new Map([
      ['trait_a', unitVector(3)],
      ['trait_b', unitVector(7)],
      ['trait_c', unitVector(11)],
    ]);

    const results = rankTraitsByVector(query, traitEmbeddings, { topK: 3 });
    expect(results[0].traitId).toBe('trait_a');
    expect(results[0].similarity).toBeCloseTo(1, 5);
    expect(results[1].similarity).toBeLessThan(results[0].similarity);
  });

  it('respects minSimilarity threshold', () => {
    const query = unitVector(1);
    const traitEmbeddings = new Map([
      ['high', unitVector(1)],
      ['low', unitVector(50)],
    ]);

    const results = rankTraitsByVector(query, traitEmbeddings, {
      topK: 10,
      minSimilarity: 0.9,
    });
    expect(results).toHaveLength(1);
    expect(results[0].traitId).toBe('high');
  });

  it('returns at most topK results', () => {
    const query = l2Normalize(new Float32Array(EMBEDDING_DIMS).fill(0.01));
    const traitEmbeddings = new Map();
    for (let i = 0; i < 20; i += 1) {
      traitEmbeddings.set(`trait_${i}`, l2Normalize(new Float32Array(EMBEDDING_DIMS).fill(i + 1)));
    }

    const results = rankTraitsByVector(query, traitEmbeddings, { topK: 5 });
    expect(results).toHaveLength(5);
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
    }
  });

  it('enriches matches with catalog metadata', () => {
    const trait = getTraitDefinition('helping_others');
    const query = unitVector(2);
    const traitEmbeddings = new Map([['helping_others', query]]);

    const results = rankTraitsByVector(query, traitEmbeddings, { topK: 1 });
    expect(results[0].name.en).toBe(trait.name.en);
    expect(results[0].category).toBe(trait.category);
    expect(results[0].description.en).toBe(trait.description.en);
  });

  it('uses default top K of 10', () => {
    expect(DEFAULT_TOP_K).toBe(10);
  });

  it('rankTraitScores avoids catalog lookups', () => {
    const query = unitVector(4);
    const index = {
      traitIds: ['trait_a', 'trait_b'],
      vectors: [unitVector(4), unitVector(8)],
    };
    const results = rankTraitScores(query, index, { topK: 2, minSimilarity: 0 });
    expect(results[0].traitId).toBe('trait_a');
    expect(results[0].similarity).toBeCloseTo(1, 5);
    expect(results[0].name).toBeUndefined();
  });
});

describe('semanticTraitPlaygroundExamples', () => {
  it('includes representative source types', () => {
    const examples = listPlaygroundExamples();
    expect(examples.length).toBeGreaterThanOrEqual(8);

    const sourceTypes = new Set(examples.map((ex) => ex.sourceType));
    expect(sourceTypes.has('reflection')).toBe(true);
    expect(sourceTypes.has('cv')).toBe(true);
    expect(sourceTypes.has('career')).toBe(true);
    expect(sourceTypes.has('simulation')).toBe(true);
  });

  it('resolves examples by id', () => {
    const ex = getPlaygroundExample('reflection_helping');
    expect(ex).toBeTruthy();
    expect(ex.text.toLowerCase()).toContain('support');
    expect(getPlaygroundExample('does_not_exist')).toBeNull();
  });
});
