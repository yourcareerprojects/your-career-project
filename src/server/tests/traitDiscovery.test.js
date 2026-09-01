/**
 * Unit tests for semantic trait discovery (strength mapping + batch helper).
 */

const {
  similarityToStrength,
  semanticMatchesToStrengthMap,
  resolveDiscoveryConfig,
  createTraitDiscovery,
  DEFAULT_MIN_SIMILARITY,
} = require('../services/careerIdentity/traitDiscovery');

describe('traitDiscovery', () => {
  it('maps similarity at threshold to legacy keyword floor strength', () => {
    expect(similarityToStrength(DEFAULT_MIN_SIMILARITY, DEFAULT_MIN_SIMILARITY)).toBeCloseTo(0.35, 5);
    expect(similarityToStrength(1, DEFAULT_MIN_SIMILARITY)).toBeCloseTo(1, 5);
  });

  it('returns zero strength below threshold', () => {
    expect(similarityToStrength(DEFAULT_MIN_SIMILARITY - 0.01, DEFAULT_MIN_SIMILARITY)).toBe(0);
  });

  it('converts semantic matches to strength map', () => {
    const scores = semanticMatchesToStrengthMap(
      [
        { traitId: 'helping_others', similarity: 0.5 },
        { traitId: 'teamwork', similarity: 0.2 },
      ],
      { minSimilarity: 0.38, relativeGap: 0.06 }
    );
    expect(scores.has('helping_others')).toBe(true);
    expect(scores.has('teamwork')).toBe(false);
    expect(scores.get('helping_others')).toBeGreaterThan(0.35);
  });

  it('drops trailing matches far below the best similarity', () => {
    const {
      filterMatchesByRelativeGap,
    } = require('../services/careerIdentity/traitDiscovery');
    const filtered = filterMatchesByRelativeGap(
      [
        { traitId: 'teamwork', similarity: 0.52 },
        { traitId: 'creativity', similarity: 0.5 },
        { traitId: 'fast_paced_work', similarity: 0.39 },
      ],
      0.06
    );
    expect(filtered.map((m) => m.traitId)).toEqual(['teamwork', 'creativity']);
  });

  it('reads config overrides and env defaults', () => {
    const config = resolveDiscoveryConfig({ minSimilarity: 0.4, topK: 5 });
    expect(config.minSimilarity).toBe(0.4);
    expect(config.topK).toBe(5);
  });

  it('supports injectable discovery for deterministic tests', async () => {
    const discovery = createTraitDiscovery({
      discoverTraitsFromText: async (text) => {
        const scores = new Map();
        if (text.includes('help')) scores.set('helping_others', 0.8);
        if (text.includes('team')) scores.set('teamwork', 0.7);
        return scores;
      },
    });

    const result = await discovery.discoverTraitsForTexts([
      'I help people',
      'team collaboration',
      'I help people',
    ]);

    expect(result.get('I help people').has('helping_others')).toBe(true);
    expect(result.get('team collaboration').has('teamwork')).toBe(true);
    expect(result.size).toBe(2);
  });
});
