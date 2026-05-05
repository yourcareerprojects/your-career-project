jest.mock('../services/ai/translateText', () => ({
  translateBetweenLocales: jest.fn(),
}));

const { translateBetweenLocales } = require('../services/ai/translateText');
const {
  normalizeForEmbedding,
  containsGerman,
  clearEmbeddingNormalizationCache,
} = require('../services/ai/normalizeForEmbedding');

describe('normalizeForEmbedding', () => {
  beforeEach(() => {
    clearEmbeddingNormalizationCache();
    translateBetweenLocales.mockImplementation(async (text, src, tgt) => {
      if (src === 'de' && tgt === 'en') {
        return 'Software development with teamwork';
      }
      return text;
    });
  });

  test('dedupes lines case-insensitively', async () => {
    const out = await normalizeForEmbedding(['React', 'react', 'TypeScript']);
    const lines = out.split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
  });

  test('calls translation when German markers are present', async () => {
    const out = await normalizeForEmbedding(['Kommunikationsfähigkeit', 'Projektarbeit']);
    expect(translateBetweenLocales).toHaveBeenCalled();
    expect(out).toBe('Software development with teamwork');
    expect(containsGerman(out)).toBe(false);
  });

  test('mixed German and English skill lines trigger normalization path', async () => {
    const out = await normalizeForEmbedding(['Python', 'Qualitätssicherung und Tests']);
    expect(translateBetweenLocales).toHaveBeenCalled();
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
