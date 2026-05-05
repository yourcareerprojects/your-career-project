const { embedTextSafe, cosineSimilarity, mmrSelect } = require('../services/embedding/embeddingService');

describe('embeddingService diversity', () => {
  test('cosine similarity is higher for similar text', async () => {
    const [a, b, c] = await Promise.all([
      embedTextSafe('software engineer javascript react'),
      embedTextSafe('frontend engineer react javascript'),
      embedTextSafe('chef kitchen cooking food'),
    ]);

    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  test('mmrSelect promotes diversity vs greedy relevance', async () => {
    const items = [
      { title: 'Frontend Engineer', description: 'react javascript ui', score: 9 },
      { title: 'React Developer', description: 'react javascript frontend', score: 8.8 },
      { title: 'Backend Engineer', description: 'node javascript api', score: 8.7 },
      { title: 'Chef', description: 'cooking kitchen food', score: 7.0 },
      { title: 'Data Analyst', description: 'data sql analysis', score: 7.5 }
    ];

    const byScore = items.slice().sort((a, b) => b.score - a.score);
    const greedyA = byScore[0];
    const greedyB = byScore[1];
    const [embGreedyA, embGreedyB] = await Promise.all([
      embedTextSafe(`${greedyA.title} ${greedyA.description}`),
      embedTextSafe(`${greedyB.title} ${greedyB.description}`),
    ]);
    const simGreedy = cosineSimilarity(embGreedyA, embGreedyB);

    const selected = await mmrSelect(items, {
      k: 3,
      lambda: 0.45,
      minNovelty: 0.15,
      embedFn: (it) => embedTextSafe(`${it.title} ${it.description}`),
      scoreFn: (it) => it.score
    });

    const selA = selected[0];
    const selB = selected[1];
    const [embSelA, embSelB] = await Promise.all([
      embedTextSafe(`${selA.title} ${selA.description}`),
      embedTextSafe(`${selB.title} ${selB.description}`),
    ]);
    const simSelected = cosineSimilarity(embSelA, embSelB);

    expect(simSelected).toBeLessThanOrEqual(simGreedy);
  });
});

