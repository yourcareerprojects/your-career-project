/**
 * Tunable thresholds and weights for Delta Job Matching.
 *
 * Scores are identity-fit cosines on a 0–1 scale (same as roleMatchingScorer
 * identitySimilarity). Delta = newScore − oldScore.
 *
 * When a user profile is available, absolute scores blend puzzle identity fit
 * with simulation-style OUT_OF_THE_BOX hybrid profile fit so suggestions stay
 * grounded in skills / experience / preferences — not puzzle traits alone.
 *
 * Tune here — keep magic numbers out of deltaJobMatchingService.js.
 */

/**
 * @type {Readonly<{
 *   MIN_ABS_DELTA: number,
 *   REQUIRE_POSITIVE_DELTA: boolean,
 *   MIN_NEW_SCORE: number,
 *   MIN_OLD_SCORE_FOR_COMPARISON: number,
 *   MAX_RESULTS: number,
 *   SCORE_PRECISION: number,
 *   USE_PROFILE_GROUNDING: boolean,
 *   PROFILE_BLEND_WEIGHT: number,
 *   MIN_PROFILE_FIT: number,
 *   PROFILE_CANDIDATE_LIMIT: number,
 *   PROFILE_FIT_CONCURRENCY: number,
 * }>}
 */
const DELTA_JOB_MATCHING_THRESHOLDS = Object.freeze({
  /**
   * Ignore jobs whose |delta| is below this (barely changed).
   * Absolute cosine units on the 0–1 score scale.
   */
  MIN_ABS_DELTA: 0.03,

  /**
   * When true, only keep jobs that improved (delta > 0).
   * Set false to also surface jobs that became worse fits.
   */
  REQUIRE_POSITIVE_DELTA: true,

  /**
   * Drop jobs whose blended (or identity-only) new fit is still too weak.
   */
  MIN_NEW_SCORE: 0.2,

  /**
   * Reserved for future gates (e.g. require a prior signal). Unused by default filter.
   */
  MIN_OLD_SCORE_FOR_COMPARISON: 0,

  /** Cap result list length after sorting (0 = unlimited). */
  MAX_RESULTS: 50,

  /** Decimal places for oldScore / newScore / delta in the returned payload. */
  SCORE_PRECISION: 4,

  /**
   * When true and a profile fit scorer is supplied, blend profile hybrid fit
   * into absolute scores and enforce MIN_PROFILE_FIT.
   */
  USE_PROFILE_GROUNDING: true,

  /**
   * Share of OUT_OF_THE_BOX hybrid profile fit in the absolute combined score.
   * combined = (1 − w) * identityFit + w * profileFit
   * Delta between snapshots still reduces to (1 − w) * identityDelta.
   */
  PROFILE_BLEND_WEIGHT: 0.4,

  /**
   * Drop roles whose profile hybrid fit is below this when profile grounding
   * produced a finite score for that role.
   */
  MIN_PROFILE_FIT: 0.22,

  /**
   * Max roles that receive expensive profile (OOTB) scoring after the fast
   * identity-cosine pass. Ranked by identity delta / new fit first.
   */
  PROFILE_CANDIDATE_LIMIT: 96,

  /** Parallelism for profile-fit scoring over the candidate shortlist. */
  PROFILE_FIT_CONCURRENCY: 32,
});

/**
 * How puzzle-piece confidence and layer map into the identity vector.
 * @type {Readonly<{
 *   CONFIRMED_LAYER_MULTIPLIER: number,
 *   EMERGING_LAYER_MULTIPLIER: number,
 *   MIN_PIECE_CONFIDENCE: number,
 *   CONFIDENCE_WEIGHT_EXPONENT: number,
 * }>}
 */
const DELTA_JOB_MATCHING_WEIGHTS = Object.freeze({
  /** Extra weight for confirmed puzzle pieces in the identity centroid. */
  CONFIRMED_LAYER_MULTIPLIER: 1,
  /** Soften emerging pieces so they don't dominate the centroid. */
  EMERGING_LAYER_MULTIPLIER: 0.75,
  /** Pieces below this confidence are ignored when building the vector. */
  MIN_PIECE_CONFIDENCE: 0.3,
  /**
   * Exponent on confidence before layer multiplier.
   * 1 = linear; >1 emphasizes high-confidence traits.
   */
  CONFIDENCE_WEIGHT_EXPONENT: 1,
});

module.exports = {
  DELTA_JOB_MATCHING_THRESHOLDS,
  DELTA_JOB_MATCHING_WEIGHTS,
};
