const { mmrSelect } = require('../services/embedding/embeddingService');

describe('embedding provider swap (MMR contract)', () => {
  test('MMR logic is embedFn-driven and does not depend on embedding implementation', async () => {
    const items = [
      { title: 'A', score: 10 },
      { title: 'B', score: 9 },
      { title: 'C', score: 8 }
    ];

    // Provider 1: trivial embeddings by title length (sync)
    const embedFn1 = (it) => new Float32Array([it.title.length]);
    // Provider 2: another trivial embedding (constant)
    const embedFn2 = (it) => new Float32Array([1]);

    const [sel1, sel2] = await Promise.all([
      mmrSelect(items, { k: 2, lambda: 0.9, minNovelty: 0, embedFn: embedFn1, scoreFn: (it) => it.score }),
      mmrSelect(items, { k: 2, lambda: 0.9, minNovelty: 0, embedFn: embedFn2, scoreFn: (it) => it.score }),
    ]);

    expect(sel1.map((x) => x.title)).toEqual(['A', 'B']);
    expect(sel2.map((x) => x.title)).toEqual(['A', 'B']);
  });
});

