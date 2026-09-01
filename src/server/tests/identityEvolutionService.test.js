/**
 * Unit tests for the Identity Evolution Engine.
 */

const {
  calculateIdentityChangeScore,
  shouldTriggerExploration,
  IDENTITY_EVOLUTION_WEIGHTS,
  IDENTITY_EVOLUTION_THRESHOLDS,
} = require('../services/careerIdentity/identityEvolutionService');

function piece(traitId, confidence, extras = {}) {
  return { traitId, confidence, ...extras };
}

describe('identityEvolutionService', () => {
  it('returns zero change for identical snapshots', () => {
    const traits = [
      piece('leadership', 0.7, { category: 'leadership', layer: 'confirmed' }),
      piece('teamwork', 0.45, { category: 'social_orientation', layer: 'emerging' }),
    ];
    const result = calculateIdentityChangeScore(traits, traits);
    expect(result.changeScore).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it('scores newly discovered puzzle pieces', () => {
    const previous = [piece('teamwork', 0.5, { category: 'social_orientation' })];
    const current = [
      piece('teamwork', 0.5, { category: 'social_orientation' }),
      piece('leadership', 0.6, { category: 'leadership' }),
      piece('empathy', 0.4, { category: 'social_orientation' }),
      piece('creativity', 0.35, { category: 'interests' }),
    ];

    const result = calculateIdentityChangeScore(previous, current);
    expect(result.changeScore).toBeGreaterThanOrEqual(
      3 * IDENTITY_EVOLUTION_WEIGHTS.NEW_PIECE
    );
    expect(result.reasons.some((r) => /3 new puzzle pieces/.test(r))).toBe(true);
  });

  it('scores confidence increases with named reasons', () => {
    const previous = [piece('leadership', 0.4, { category: 'leadership', layer: 'emerging' })];
    const current = [piece('leadership', 0.75, { category: 'leadership', layer: 'confirmed' })];

    const result = calculateIdentityChangeScore(previous, current);
    expect(result.changeScore).toBeGreaterThan(0);
    expect(result.reasons.some((r) => /confidence increased/i.test(r))).toBe(true);
  });

  it('ignores confidence noise below MIN_CONFIDENCE_DELTA', () => {
    const previous = [piece('leadership', 0.5, { category: 'leadership' })];
    const current = [
      piece('leadership', 0.5 + IDENTITY_EVOLUTION_THRESHOLDS.MIN_CONFIDENCE_DELTA - 0.01, {
        category: 'leadership',
      }),
    ];

    const result = calculateIdentityChangeScore(previous, current);
    expect(result.reasons.some((r) => /confidence increased/i.test(r))).toBe(false);
  });

  it('scores confidence decreases', () => {
    const previous = [piece('teamwork', 0.8, { category: 'social_orientation' })];
    const current = [piece('teamwork', 0.4, { category: 'social_orientation' })];

    const result = calculateIdentityChangeScore(previous, current);
    expect(result.changeScore).toBeGreaterThan(0);
    expect(result.reasons.some((r) => /Teamwork confidence decreased/i.test(r))).toBe(true);
  });

  it('detects completely new domains', () => {
    const previous = [piece('teamwork', 0.5, { category: 'social_orientation' })];
    const current = [
      piece('teamwork', 0.5, { category: 'social_orientation' }),
      piece('leadership', 0.55, { category: 'leadership' }),
    ];

    const result = calculateIdentityChangeScore(previous, current);
    expect(result.reasons.some((r) => /New Leadership domain/i.test(r))).toBe(true);
  });

  it('scores removed puzzle pieces', () => {
    const previous = [
      piece('leadership', 0.7, { category: 'leadership' }),
      piece('teamwork', 0.5, { category: 'social_orientation' }),
    ];
    const current = [piece('teamwork', 0.5, { category: 'social_orientation' })];

    const result = calculateIdentityChangeScore(previous, current);
    expect(result.changeScore).toBeGreaterThanOrEqual(IDENTITY_EVOLUTION_WEIGHTS.REMOVED_PIECE);
    expect(result.reasons.some((r) => /Removed puzzle piece/i.test(r))).toBe(true);
  });

  it('detects major semantic shifts when the core trait set turns over', () => {
    const previous = [
      piece('leadership', 0.9, { category: 'leadership' }),
      piece('teamwork', 0.85, { category: 'social_orientation' }),
      piece('empathy', 0.8, { category: 'social_orientation' }),
      piece('helping_others', 0.75, { category: 'values' }),
      piece('communication', 0.7, { category: 'communication' }),
    ];
    const current = [
      piece('analytical_thinking', 0.9, { category: 'thinking_style' }),
      piece('technology', 0.85, { category: 'interests' }),
      piece('precision', 0.8, { category: 'work_style' }),
      piece('working_independently', 0.75, { category: 'work_style' }),
      piece('continuous_learning', 0.7, { category: 'learning' }),
    ];

    const result = calculateIdentityChangeScore(previous, current);
    expect(result.changeScore).toBeGreaterThan(IDENTITY_EVOLUTION_THRESHOLDS.EXPLORATION_TRIGGER_SCORE);
    expect(result.reasons.some((r) => /semantic shift/i.test(r))).toBe(true);
  });

  it('accepts API node shape with id instead of traitId', () => {
    const previous = [{ id: 'leadership', confidence: 0.4, category: 'leadership' }];
    const current = [{ id: 'leadership', confidence: 0.7, category: 'leadership' }];
    const result = calculateIdentityChangeScore(previous, current);
    expect(result.changeScore).toBeGreaterThan(0);
  });

  it('caps changeScore at MAX_CHANGE_SCORE', () => {
    const previous = [];
    const current = Array.from({ length: 20 }, (_, i) =>
      piece(`trait_${i}`, 0.8, { category: `cat_${i}` })
    );
    const result = calculateIdentityChangeScore(previous, current);
    expect(result.changeScore).toBeLessThanOrEqual(IDENTITY_EVOLUTION_THRESHOLDS.MAX_CHANGE_SCORE);
  });

  it('shouldTriggerExploration respects the default threshold', () => {
    expect(shouldTriggerExploration(IDENTITY_EVOLUTION_THRESHOLDS.EXPLORATION_TRIGGER_SCORE)).toBe(
      true
    );
    expect(
      shouldTriggerExploration(IDENTITY_EVOLUTION_THRESHOLDS.EXPLORATION_TRIGGER_SCORE - 1)
    ).toBe(false);
    expect(shouldTriggerExploration({ changeScore: 50 }, 40)).toBe(true);
  });

  it('supports weight overrides for tuning experiments', () => {
    const previous = [];
    const current = [piece('leadership', 0.6, { category: 'leadership' })];

    const defaultResult = calculateIdentityChangeScore(previous, current);
    const boosted = calculateIdentityChangeScore(previous, current, {
      weights: { NEW_PIECE: IDENTITY_EVOLUTION_WEIGHTS.NEW_PIECE * 2 },
    });

    expect(boosted.changeScore).toBeGreaterThan(defaultResult.changeScore);
  });

  it('includeDebug exposes per-scorer contributions', () => {
    const previous = [];
    const current = [piece('leadership', 0.6, { category: 'leadership' })];
    const result = calculateIdentityChangeScore(previous, current, { includeDebug: true });
    expect(Array.isArray(result.debug)).toBe(true);
    expect(result.debug.some((d) => d.id === 'new_pieces' && d.score > 0)).toBe(true);
  });
});
