/**
 * Unit tests for semantic-aware trait confidence scoring.
 */

const {
  calculateTraitConfidence,
  calculateConnectionStrength,
  confidenceToRadialDistance,
  evidenceSignal,
  MAX_CONFIDENCE,
} = require('../services/careerIdentity/traitConfidenceCalculator');

function evidence(sourceType, weight, matchStrength) {
  return { sourceType, weight, matchStrength };
}

describe('traitConfidenceCalculator', () => {
  it('returns 0 for empty evidence', () => {
    expect(calculateTraitConfidence([])).toBe(0);
  });

  it('incorporates semantic match strength and weight', () => {
    const weakSemantic = calculateTraitConfidence([
      evidence('reflection', 0.7, 0.35),
    ]);
    const strongSemantic = calculateTraitConfidence([
      evidence('reflection', 0.7, 0.85),
    ]);
    expect(strongSemantic).toBeGreaterThan(weakSemantic);
  });

  it('rewards independent evidence from multiple source types', () => {
    const singleSource = calculateTraitConfidence([
      evidence('reflection', 0.75, 0.7),
    ]);
    const threeSources = calculateTraitConfidence([
      evidence('reflection', 0.75, 0.7),
      evidence('career', 0.8, 0.72),
      evidence('simulation', 0.78, 0.68),
    ]);

    expect(threeSources).toBeGreaterThan(singleSource * 1.35);
    expect(threeSources).toBeLessThanOrEqual(MAX_CONFIDENCE);
  });

  it('reflects repeated confirmations within the same source with diminishing returns', () => {
    const oneItem = calculateTraitConfidence([evidence('reflection', 0.8, 0.8)]);
    const threeSameSource = calculateTraitConfidence([
      evidence('reflection', 0.8, 0.8),
      evidence('reflection', 0.75, 0.75),
      evidence('reflection', 0.7, 0.7),
    ]);
    expect(threeSameSource).toBeGreaterThan(oneItem);
    expect(threeSameSource).toBeLessThan(oneItem * 2.5);
  });

  it('prefers cross-source confirmation over many items from one source', () => {
    const manyReflections = calculateTraitConfidence([
      evidence('reflection', 0.8, 0.8),
      evidence('reflection', 0.78, 0.78),
      evidence('reflection', 0.76, 0.76),
    ]);
    const crossSource = calculateTraitConfidence([
      evidence('reflection', 0.75, 0.7),
      evidence('career', 0.8, 0.72),
      evidence('simulation', 0.78, 0.68),
    ]);

    expect(crossSource).toBeGreaterThan(manyReflections);
  });

  it('never reaches 100% confidence', () => {
    const heavy = calculateTraitConfidence([
      evidence('reflection', 0.9, 0.95),
      evidence('profile', 0.9, 0.95),
      evidence('cv', 0.9, 0.95),
      evidence('career', 0.9, 0.95),
      evidence('simulation', 0.9, 0.95),
      evidence('reflection', 0.85, 0.9),
    ]);
    expect(heavy).toBeLessThan(1);
    expect(heavy).toBeLessThanOrEqual(MAX_CONFIDENCE);
  });

  it('falls back when matchStrength is missing (legacy evidence)', () => {
    const withStrength = calculateTraitConfidence([{ sourceType: 'cv', weight: 0.7, matchStrength: 0.6 }]);
    const legacy = calculateTraitConfidence([{ sourceType: 'cv', weight: 0.7 }]);
    expect(withStrength).toBeGreaterThan(0);
    expect(legacy).toBeGreaterThan(0);
  });

  it('combines weight and match strength in evidenceSignal', () => {
    expect(evidenceSignal({ weight: 0.8, matchStrength: 0.9 })).toBeGreaterThan(
      evidenceSignal({ weight: 0.8, matchStrength: 0.4 })
    );
  });

  it('downgrades confidence for negative polarity evidence', () => {
    const supporting = [
      evidence('reflection', 0.75, 0.7),
      evidence('career', 0.8, 0.72),
      evidence('simulation', 0.78, 0.68),
    ];
    const withReject = [
      ...supporting,
      { sourceType: 'assessment', weight: 0.48, matchStrength: 0.52, polarity: 'negative' },
    ];
    const before = calculateTraitConfidence(supporting);
    const after = calculateTraitConfidence(withReject);
    expect(after).toBeLessThan(before);
    expect(before - after).toBeLessThan(0.18);
  });

  it('maps high confidence toward the center', () => {
    expect(confidenceToRadialDistance(0.9)).toBeLessThan(confidenceToRadialDistance(0.2));
  });

  it('strengthens connections as both traits grow', () => {
    const weak = calculateConnectionStrength(0.2, 0.2);
    const strong = calculateConnectionStrength(0.8, 0.8);
    expect(strong).toBeGreaterThan(weak);
  });
});
