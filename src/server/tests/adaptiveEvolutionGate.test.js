/**
 * Unit tests for the adaptive evolution gate (presentation-backed).
 */

const {
  evaluateAdaptiveGateFromSignals,
  resolveExplorationSize,
} = require('../services/careerIdentity/adaptiveEvolutionGate');

function baseSignals(overrides = {}) {
  return {
    interactionCount: 20,
    averageConfidence: 0.55,
    stability: 0.6,
    traitOverlap: 0.6,
    historicalCalmness: 0.5,
    recentExplorationSessions: 0,
    recentExplorationJobs: 0,
    hoursSinceLastExploration: null,
    ...overrides,
  };
}

describe('adaptiveEvolutionGate', () => {
  it('returns the required explanation object shape', () => {
    const explanation = evaluateAdaptiveGateFromSignals(15, baseSignals());
    expect(explanation).toEqual(
      expect.objectContaining({
        trigger: expect.any(Boolean),
        triggerReason: expect.any(String),
        threshold: expect.any(Number),
        changeScore: 15,
        explorationSize: expect.any(Number),
        presentation: expect.any(Object),
      })
    );
  });

  it('scales exploration size by amount of change', () => {
    expect(resolveExplorationSize(6).maxJobs).toBe(2);
    expect(resolveExplorationSize(6).evolutionTier).toBe('light');
    expect(resolveExplorationSize(15).maxJobs).toBe(4);
    expect(resolveExplorationSize(15).evolutionTier).toBe('moderate');
    expect(resolveExplorationSize(25).maxJobs).toBe(6);
    expect(resolveExplorationSize(25).evolutionTier).toBe('substantial');
    expect(resolveExplorationSize(35).maxJobs).toBe(10);
    expect(resolveExplorationSize(35).evolutionTier).toBe('full');
  });

  it('triggers exploration for modest change scores', () => {
    const explanation = evaluateAdaptiveGateFromSignals(8, baseSignals({
      interactionCount: 50,
      averageConfidence: 0.8,
      stability: 0.9,
      recentExplorationSessions: 2,
      recentExplorationJobs: 16,
      hoursSinceLastExploration: 10,
    }));

    expect(explanation.trigger).toBe(true);
    expect(explanation.explorationSize).toBeGreaterThanOrEqual(1);
    expect(explanation.evolutionTier).toBe('light');
  });

  it('does not trigger below the meaningful-change floor', () => {
    const explanation = evaluateAdaptiveGateFromSignals(3, baseSignals());
    expect(explanation.trigger).toBe(false);
    expect(explanation.explorationSize).toBe(0);
    expect(explanation.triggerReason).toMatch(/below the meaningful exploration floor/i);
  });

  it('includes presentation metadata for downstream UI', () => {
    const explanation = evaluateAdaptiveGateFromSignals(22, baseSignals());
    expect(explanation.presentation).toEqual(
      expect.objectContaining({
        prominence: 'featured',
        minJobs: 4,
        maxJobs: 6,
        notify: expect.any(Boolean),
      })
    );
  });
});
