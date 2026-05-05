/**
 * Score Calibration Layer for career matching.
 *
 * Post-processes raw scores to increase separation between strong and weak matches
 * while preserving ranking order. Calibration is modular and reversible.
 *
 * Input/output: scores in [0, 1] (normalize from 0–10 before calling, scale back after).
 *
 * @module services/scoring/scoreCalibration
 */

const { SCORING_CONFIG } = require('../../config/scoringConfig');

/** Power calibration exponent (default) */
const CALIBRATION_EXPONENT = 1.3;

/**
 * Power calibration: increases separation between strong and weak matches.
 * Scores < 1 shrink slightly; high scores shrink less relative to mid scores.
 * Ranking order is preserved (monotonic).
 *
 * @param {number} rawScore - Score in [0, 1]
 * @returns {number} Calibrated score in [0, 1]
 */
function powerCalibration(rawScore) {
  if (!Number.isFinite(rawScore)) return 0;
  const exponent = SCORING_CONFIG.calibrationExponent ?? CALIBRATION_EXPONENT;
  const calibrated = Math.pow(Math.max(0, rawScore), exponent);
  return Math.min(1, Math.max(0, calibrated));
}

/**
 * Sigmoid calibration: alternative nonlinear curve.
 * Steepness (k) and midpoint control the shape.
 *
 * @param {number} rawScore - Score in [0, 1]
 * @returns {number} Calibrated score in [0, 1]
 */
function sigmoidCalibration(rawScore) {
  if (!Number.isFinite(rawScore)) return 0;
  const k = SCORING_CONFIG.sigmoidSteepness ?? 6;
  const midpoint = SCORING_CONFIG.sigmoidMidpoint ?? 0.7;
  const x = Math.max(0, Math.min(1, rawScore));
  const calibrated = 1 / (1 + Math.exp(-k * (x - midpoint)));
  return Math.min(1, Math.max(0, calibrated));
}

/**
 * Main calibration function. Dispatches based on SCORING_CONFIG.calibrationMode.
 * Options override allows per-call mode (e.g. for tests).
 *
 * @param {number} rawScore - Score in [0, 1] (caller must normalize if using 0–10 scale)
 * @param {{ calibrationMode?: 'power'|'sigmoid'|'none' }} [options] - Override calibration mode
 * @returns {number} Calibrated score in [0, 1], clamped
 */
function calibrateScore(rawScore, options = {}) {
  const mode = options.calibrationMode ?? SCORING_CONFIG.calibrationMode ?? 'power';

  if (mode === 'none') {
    const x = Number.isFinite(rawScore) ? rawScore : 0;
    return Math.min(1, Math.max(0, x));
  }

  if (mode === 'sigmoid') {
    return sigmoidCalibration(rawScore);
  }

  return powerCalibration(rawScore);
}

/**
 * Analyze score distribution for validation and tuning.
 *
 * @param {number[]} scores - Array of scores
 * @returns {{ min: number, max: number, mean: number, stdDev: number }}
 */
function analyzeScoreDistribution(scores) {
  const arr = Array.isArray(scores) ? scores.filter((s) => Number.isFinite(s)) : [];

  if (arr.length === 0) {
    return { min: 0, max: 0, mean: 0, stdDev: 0 };
  }

  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const sum = arr.reduce((acc, s) => acc + s, 0);
  const mean = sum / arr.length;
  const variance = arr.reduce((acc, s) => acc + (s - mean) ** 2, 0) / arr.length;
  const stdDev = Math.sqrt(variance);

  return {
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    mean: Number(mean.toFixed(4)),
    stdDev: Number(stdDev.toFixed(4))
  };
}

/**
 * Get current calibration mode for logging.
 *
 * @param {{ calibrationMode?: string }} [options] - Override for mode
 * @returns {string}
 */
function getCalibrationMode(options = {}) {
  return options.calibrationMode ?? SCORING_CONFIG.calibrationMode ?? 'power';
}

module.exports = {
  calibrateScore,
  powerCalibration,
  sigmoidCalibration,
  analyzeScoreDistribution,
  getCalibrationMode,
  CALIBRATION_EXPONENT
};
