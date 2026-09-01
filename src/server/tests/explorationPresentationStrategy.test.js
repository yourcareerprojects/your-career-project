/**
 * Unit tests for exploration presentation strategy.
 */

const {
  resolveExplorationPresentation,
  resolvePresentationBand,
} = require('../services/careerIdentity/explorationPresentationStrategy');

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

describe('explorationPresentationStrategy', () => {
  it('maps changeScore bands to job counts', () => {
    expect(resolvePresentationBand(32).id).toBe('full');
    expect(resolvePresentationBand(22).id).toBe('substantial');
    expect(resolvePresentationBand(12).id).toBe('moderate');
    expect(resolvePresentationBand(6).id).toBe('light');
    expect(resolvePresentationBand(3)).toBeNull();
  });

  it('explores for any meaningful change (score ≥ 5)', () => {
    const light = resolveExplorationPresentation(6, baseSignals());
    expect(light.shouldExplore).toBe(true);
    expect(light.minJobs).toBe(1);
    expect(light.maxJobs).toBe(2);
    expect(light.prominence).toBe('subtle');

    const moderate = resolveExplorationPresentation(15, baseSignals());
    expect(moderate.shouldExplore).toBe(true);
    expect(moderate.minJobs).toBe(2);
    expect(moderate.maxJobs).toBe(4);

    const full = resolveExplorationPresentation(35, baseSignals());
    expect(full.shouldExplore).toBe(true);
    expect(full.maxJobs).toBe(10);
    expect(full.prominence).toBe('full');
  });

  it('does not explore below the meaningful-change floor', () => {
    const result = resolveExplorationPresentation(3, baseSignals());
    expect(result.shouldExplore).toBe(false);
    expect(result.targetJobCount).toBe(0);
  });

  it('dampens size under fatigue without suppressing discovery toasts', () => {
    const result = resolveExplorationPresentation(12, baseSignals({
      hoursSinceLastExploration: 6,
      recentExplorationSessions: 2,
      recentExplorationJobs: 14,
    }));

    expect(result.shouldExplore).toBe(true);
    expect(result.notify).toBe(true);
    expect(result.maxJobs).toBeLessThanOrEqual(4);
  });
});
