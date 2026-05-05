/**
 * Scoring configuration for career matching.
 *
 * Calibration mode controls post-processing of raw scores:
 * - "power": Power calibration (default) – increases separation between strong and weak matches
 * - "sigmoid": Sigmoid calibration – alternative nonlinear curve
 * - "none": No calibration – pass-through (rawScore used as-is)
 *
 * @module config/scoringConfig
 */

const SCORING_CONFIG = {
  /** @type {'power'|'sigmoid'|'none'} */
  calibrationMode: 'power',

  /** Power calibration exponent (used when calibrationMode === 'power') */
  calibrationExponent: 1.3,

  /** Sigmoid parameters (used when calibrationMode === 'sigmoid') */
  sigmoidSteepness: 6,
  sigmoidMidpoint: 0.7
};

module.exports = {
  SCORING_CONFIG
};
