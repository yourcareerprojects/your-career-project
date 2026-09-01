/**
 * Tunable weights and thresholds for the Identity Evolution Engine.
 *
 * All scoring knobs live here so the algorithm in identityEvolutionService.js
 * stays readable and product can retune “how much change is enough” without
 * hunting through scorer logic.
 *
 * Score scale: contributions sum toward a 0–100 changeScore (soft-capped).
 * Confidence inputs remain 0–1 (same as Career Identity engine).
 */

/**
 * Per-event / per-unit contributions to changeScore.
 * @type {Readonly<{
 *   NEW_PIECE: number,
 *   REMOVED_PIECE: number,
 *   NEW_DOMAIN: number,
 *   REMOVED_DOMAIN: number,
 *   CONFIDENCE_INCREASE_PER_UNIT: number,
 *   CONFIDENCE_DECREASE_PER_UNIT: number,
 *   LAYER_PROMOTION: number,
 *   LAYER_DEMOTION: number,
 *   SEMANTIC_SHIFT_PER_UNIT: number,
 *   CATEGORY_MASS_SHIFT_PER_UNIT: number,
 * }>}
 */
const IDENTITY_EVOLUTION_WEIGHTS = Object.freeze({
  /** Each trait that appears in the new snapshot but not the previous one. */
  NEW_PIECE: 12,
  /** Each trait that disappeared from the puzzle (dropped below emerging). */
  REMOVED_PIECE: 10,
  /** First appearance of an identity category (domain) that had no pieces before. */
  NEW_DOMAIN: 18,
  /** Category that no longer has any puzzle pieces. */
  REMOVED_DOMAIN: 14,
  /**
   * Multiplied by confidence delta in [0, 1] when a shared trait gains confidence.
   * Example: +0.2 confidence × 40 = +8 points.
   */
  CONFIDENCE_INCREASE_PER_UNIT: 40,
  /** Same scale as increases; slightly softer so noise drops hurt less than gains help. */
  CONFIDENCE_DECREASE_PER_UNIT: 32,
  /** Trait moved from emerging → confirmed. */
  LAYER_PROMOTION: 8,
  /** Trait moved from confirmed → emerging. */
  LAYER_DEMOTION: 10,
  /**
   * Multiplied by semantic-shift magnitude in [0, 1]
   * (Jaccard distance over top-K trait ids).
   */
  SEMANTIC_SHIFT_PER_UNIT: 35,
  /**
   * Multiplied by L1 distance / 2 of category confidence mass distributions
   * (range ≈ [0, 1]). Captures “energy moved across domains” even when trait
   * ids overlap.
   */
  CATEGORY_MASS_SHIFT_PER_UNIT: 22,
});

/**
 * Noise filters and exploration defaults.
 * @type {Readonly<{
 *   MIN_CONFIDENCE_DELTA: number,
 *   SEMANTIC_TOP_K: number,
 *   MIN_SEMANTIC_SHIFT: number,
 *   MIN_CATEGORY_MASS_SHIFT: number,
 *   MAX_CHANGE_SCORE: number,
 *   EXPLORATION_TRIGGER_SCORE: number,
 *   MAX_REASON_TRAITS_LISTED: number,
 * }>}
 */
const IDENTITY_EVOLUTION_THRESHOLDS = Object.freeze({
  /** Ignore confidence wobble smaller than this (absolute, 0–1 scale). */
  MIN_CONFIDENCE_DELTA: 0.05,
  /** How many highest-confidence traits define the “identity core” for Jaccard. */
  SEMANTIC_TOP_K: 5,
  /** Jaccard distance must exceed this before semantic-shift points apply. */
  MIN_SEMANTIC_SHIFT: 0.25,
  /** Category mass L1/2 must exceed this before mass-shift points apply. */
  MIN_CATEGORY_MASS_SHIFT: 0.12,
  /** Soft cap for the aggregated changeScore. */
  MAX_CHANGE_SCORE: 100,
  /**
   * Fixed fallback bar for shouldTriggerExploration() only.
   * Production pipeline uses adaptiveEvolutionGate + adaptiveEvolutionConfig.js.
   */
  EXPLORATION_TRIGGER_SCORE: 5,
  /** Cap how many trait names appear in a single reason string. */
  MAX_REASON_TRAITS_LISTED: 3,
});

module.exports = {
  IDENTITY_EVOLUTION_WEIGHTS,
  IDENTITY_EVOLUTION_THRESHOLDS,
};
