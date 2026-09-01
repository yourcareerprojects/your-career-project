/**
 * Trait confidence from semantic evidence signals.
 *
 * Combines per-item semantic match strength, evidence weight, and cross-source
 * confirmation. Traits supported by reflection + career + simulation score higher
 * than traits detected from a single source.
 *
 * Confidence is always derived — never stored as an authoritative hand-edited value.
 */

const MAX_CONFIDENCE = 0.94;
const MAX_EFFECTIVE_WEIGHT = 3.8;
const WITHIN_SOURCE_DIMINISHING = 0.72;
const CROSS_SOURCE_DIMINISHING = 0.82;
/** Per additional independent source type (reflection, cv, career, …). */
const SOURCE_CONFIRMATION_BONUS = 0.14;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function roundConfidence(value) {
  return Math.round(Math.max(0, Math.min(MAX_CONFIDENCE, value)) * 1000) / 1000;
}

/**
 * Fallback when legacy evidence lacks matchStrength (pre-semantic profiles).
 * @param {number} weight
 * @returns {number}
 */
function inferMatchStrengthFromWeight(weight) {
  const w = clamp01(weight);
  if (w <= 0) return 0;
  return clamp01((w - 0.3) / 0.55);
}

/**
 * @param {{ polarity?: string|number }} item
 * @returns {boolean}
 */
function isNegativePolarity(item) {
  const polarity = item?.polarity;
  if (polarity == null) return false;
  if (typeof polarity === 'number') return polarity < 0;
  const value = String(polarity).toLowerCase().trim();
  return value === 'negative' || value === 'against' || value === '-1';
}

/**
 * Per-evidence signal blending semantic similarity and source weight.
 * Magnitude only — polarity is applied in calculateTraitConfidence.
 * @param {{ weight?: number, matchStrength?: number }} item
 * @returns {number}
 */
function evidenceSignal(item) {
  const weight = clamp01(item.weight);
  const strength = clamp01(
    item.matchStrength != null ? item.matchStrength : inferMatchStrengthFromWeight(weight)
  );
  if (weight <= 0 || strength <= 0) return 0;
  return weight * (0.35 + 0.65 * strength);
}

/**
 * Diminishing sum — strongest signals count most.
 * @param {number[]} values
 * @param {number} factor
 * @returns {number}
 */
function diminishingSum(values, factor) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => b - a);
  let total = 0;
  let multiplier = 1;
  for (const value of sorted) {
    total += value * multiplier;
    multiplier *= factor;
  }
  return total;
}

/**
 * Apply user reject / against-evidence as a mild downgrade on top of supporting signals.
 * Intentionally softer than a full veto — one vote should nudge, not dominate.
 * @param {number} positiveConfidence
 * @param {number} rejectForce
 * @returns {number}
 */
function applyNegativeEvidencePenalty(positiveConfidence, rejectForce) {
  const force = Math.max(0, Number(rejectForce) || 0);
  if (force <= 0) return positiveConfidence;
  const penalty = Math.min(0.35, (force / MAX_EFFECTIVE_WEIGHT) * 0.7);
  return Math.max(0, positiveConfidence * (1 - penalty) - 0.03);
}

/**
 * @param {Array<{ weight?: number, matchStrength?: number, sourceType?: string, polarity?: string|number }>} evidence
 * @returns {number} confidence in [0, 1]
 */
function calculateTraitConfidence(evidence) {
  const items = Array.isArray(evidence) ? evidence : [];
  if (items.length === 0) return 0;

  const bySource = new Map();
  const negativeSignals = [];

  for (const item of items) {
    const signal = evidenceSignal(item);
    if (signal <= 0) continue;
    if (isNegativePolarity(item)) {
      negativeSignals.push(signal);
      continue;
    }
    const sourceType = String(item.sourceType || 'unknown');
    if (!bySource.has(sourceType)) bySource.set(sourceType, []);
    bySource.get(sourceType).push(signal);
  }

  let positiveConfidence = 0;
  if (bySource.size > 0) {
    const sourceContributions = [];
    for (const signals of bySource.values()) {
      sourceContributions.push(diminishingSum(signals, WITHIN_SOURCE_DIMINISHING));
    }

    const crossSourceTotal = diminishingSum(sourceContributions, CROSS_SOURCE_DIMINISHING);
    const independentSourceCount = bySource.size;
    const confirmationMultiplier = 1 + (independentSourceCount - 1) * SOURCE_CONFIRMATION_BONUS;
    positiveConfidence = (crossSourceTotal * confirmationMultiplier) / MAX_EFFECTIVE_WEIGHT;
  }

  // Reject-only evidence should not invent a trait — confidence stays 0.
  if (negativeSignals.length === 0) {
    return roundConfidence(positiveConfidence);
  }

  const rejectForce = diminishingSum(negativeSignals, WITHIN_SOURCE_DIMINISHING);
  return roundConfidence(applyNegativeEvidencePenalty(positiveConfidence, rejectForce));
}

/**
 * Connection strength between two related traits based on their confidences.
 * @param {number} confidenceA
 * @param {number} confidenceB
 * @returns {number}
 */
function calculateConnectionStrength(confidenceA, confidenceB) {
  const a = clamp01(confidenceA);
  const b = clamp01(confidenceB);
  if (a <= 0 || b <= 0) return 0.12;
  const geometric = Math.sqrt(a * b);
  return Math.max(0.15, Math.min(0.95, Math.round((0.2 + geometric * 0.75) * 1000) / 1000));
}

/**
 * Radial distance for graph layout: high confidence → center, low → edge.
 * @param {number} confidence
 * @returns {number} 0 (center) … 1 (edge)
 */
function confidenceToRadialDistance(confidence) {
  const c = clamp01(confidence);
  return Math.round((1 - c) * 1000) / 1000;
}

module.exports = {
  calculateTraitConfidence,
  calculateConnectionStrength,
  confidenceToRadialDistance,
  evidenceSignal,
  inferMatchStrengthFromWeight,
  isNegativePolarity,
  applyNegativeEvidencePenalty,
  MAX_CONFIDENCE,
  MAX_EFFECTIVE_WEIGHT,
  WITHIN_SOURCE_DIMINISHING,
  CROSS_SOURCE_DIMINISHING,
  SOURCE_CONFIRMATION_BONUS,
  /** @deprecated use WITHIN_SOURCE_DIMINISHING */
  DIMINISHING_FACTOR: WITHIN_SOURCE_DIMINISHING,
};
