/**
 * Adaptive Identity Evolution — tuning parameters
 * ================================================
 *
 * All knobs for dynamic exploration gating live here so experiments stay
 * data-driven (change a constant, re-run) without touching algorithm code.
 *
 * Score scale: identity changeScore is 0–100 (see identityEvolutionWeights.js).
 *
 * High-level model (presentation-driven)
 * ----------------
 *   meaningful change = changeScore ≥ EXPLORATION_MEANINGFUL_CHANGE_SCORE (5)
 *   exploration always computed when meaningful
 *   size / prominence / notify = f(changeScore) with fatigue dampening
 *
 * Legacy threshold fields below are retained for signal collection only.
 */

/** @type {Readonly<Record<string, number>>} */
const ADAPTIVE_EVOLUTION_BASE = Object.freeze({
  /** Starting exploration bar before signal adjustments (changeScore 0–100). */
  BASE_THRESHOLD: 28,

  /** Hard floor — never explore below this changeScore. */
  MIN_THRESHOLD: 18,

  /** Hard ceiling — always explore at/above this changeScore. */
  MAX_THRESHOLD: 72,

  /** Decimal places for returned threshold. */
  THRESHOLD_PRECISION: 1,
});

/**
 * Interaction-volume adjustments.
 * “Interactions” ≈ evidence touches + saved-step ratings + trait votes + sims.
 * @type {Readonly<Record<string, number>>}
 */
const ADAPTIVE_EVOLUTION_INTERACTIONS = Object.freeze({
  /** Below this count, treat the user as early-stage. */
  EARLY_MAX: 8,
  /** Above this count, treat the user as mature. */
  MATURE_MIN: 40,

  /** Added to threshold when interactionCount <= EARLY_MAX (negative = easier trigger). */
  EARLY_ADJUSTMENT: -6,
  /** Added when EARLY_MAX < count < MATURE_MIN. */
  MID_ADJUSTMENT: 0,
  /** Added when interactionCount >= MATURE_MIN. */
  MATURE_ADJUSTMENT: 5,
});

/**
 * Average puzzle-piece confidence (0–1) adjustments.
 * @type {Readonly<Record<string, number>>}
 */
const ADAPTIVE_EVOLUTION_CONFIDENCE = Object.freeze({
  /** Avg confidence at/below this → identity still forming. */
  LOW_MAX: 0.45,
  /** Avg confidence at/above this → identity looks established. */
  HIGH_MIN: 0.7,

  LOW_ADJUSTMENT: -4,
  MID_ADJUSTMENT: 0,
  HIGH_ADJUSTMENT: 6,
});

/**
 * Identity stability (0–1): trait-set Jaccard overlap previous↔current,
 * blended with recent historical calmness.
 * @type {Readonly<Record<string, number>>}
 */
const ADAPTIVE_EVOLUTION_STABILITY = Object.freeze({
  /** How much weight trait-overlap gets vs historical calmness. */
  OVERLAP_WEIGHT: 0.65,
  HISTORICAL_WEIGHT: 0.35,

  /** How many prior pipeline changeScores to average for historical calmness. */
  HISTORY_WINDOW: 5,

  /** Stability at/below → volatile identity, explore more readily. */
  LOW_MAX: 0.45,
  /** Stability at/above → settled identity. */
  HIGH_MIN: 0.8,

  LOW_ADJUSTMENT: -5,
  MID_ADJUSTMENT: 0,
  HIGH_ADJUSTMENT: 7,
});

/**
 * Exploration fatigue — recent completed explorations raise the bar.
 * @type {Readonly<Record<string, number>>}
 */
const ADAPTIVE_EVOLUTION_FATIGUE = Object.freeze({
  /** Look-back window in days for “recent” explorations. */
  WINDOW_DAYS: 14,

  /** Completed sessions in window that start applying fatigue. */
  SESSION_SOFT_CAP: 1,
  /** Sessions at/above this count apply full session fatigue. */
  SESSION_HARD_CAP: 3,

  /** Jobs shown in window that start applying fatigue. */
  JOBS_SOFT_CAP: 8,
  /** Jobs at/above this count apply full job fatigue. */
  JOBS_HARD_CAP: 24,

  /** Max threshold points from session-count fatigue. */
  MAX_SESSION_FATIGUE: 10,
  /** Max threshold points from jobs-shown fatigue. */
  MAX_JOBS_FATIGUE: 8,

  /** Extra flat bump when a completed exploration happened within this many hours. */
  RECENT_HOURS: 48,
  RECENT_COMPLETION_BUMP: 4,
});

/**
 * Map changeScore (amount of evolution) → exploration list size.
 * Bands are evaluated in order; first match wins.
 * @type {ReadonlyArray<{ id: string, minChangeScore: number, size: number }>}
 */
const ADAPTIVE_EVOLUTION_SIZE_BANDS = Object.freeze([
  { id: 'major', minChangeScore: 70, size: 10 },
  { id: 'large', minChangeScore: 55, size: 8 },
  { id: 'medium', minChangeScore: 40, size: 5 },
  { id: 'small', minChangeScore: 0, size: 3 },
]);

/** Allowed exploration sizes (must align with careerExplorationService clamps). */
const ADAPTIVE_EVOLUTION_SIZE_LIMITS = Object.freeze({
  MIN: 3,
  MAX: 10,
});

module.exports = {
  ADAPTIVE_EVOLUTION_BASE,
  ADAPTIVE_EVOLUTION_INTERACTIONS,
  ADAPTIVE_EVOLUTION_CONFIDENCE,
  ADAPTIVE_EVOLUTION_STABILITY,
  ADAPTIVE_EVOLUTION_FATIGUE,
  ADAPTIVE_EVOLUTION_SIZE_BANDS,
  ADAPTIVE_EVOLUTION_SIZE_LIMITS,
};
