/**
 * Unit tests for exploration candidate ranking.
 */

const { rankExplorationCandidates } = require('../services/careerIdentity/explorationRankingService');

function match(id, delta, newScore = 0.5) {
  return { role: { escoId: id }, oldScore: 0.2, newScore, delta };
}

describe('explorationRankingService', () => {
  it('sorts by delta descending and excludes previously shown jobs', () => {
    const { ranked, excludedCount } = rankExplorationCandidates(
      [match('b', 0.2), match('a', 0.4), match('c', 0.35)],
      { previouslyShownJobIds: ['a'] }
    );

    expect(ranked.map((m) => m.role.escoId)).toEqual(['c', 'b']);
    expect(excludedCount).toBe(1);
  });

  it('drops non-positive deltas', () => {
    const { ranked } = rankExplorationCandidates([
      match('a', 0.1),
      match('b', 0),
      match('c', -0.05),
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].role.escoId).toBe('a');
  });
});
