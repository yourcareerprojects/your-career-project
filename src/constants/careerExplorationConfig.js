/**
 * Tunable configuration for Career Exploration after identity evolution.
 *
 * Mix ratios must sum to 1. Result size is clamped to [MIN_JOBS, MAX_JOBS].
 * All knobs are overridable via generateCareerExploration({ config }).
 */

/**
 * Selection mix — share of the final list drawn from each bucket.
 * @type {Readonly<{
 *   HIGHEST_DELTA: number,
 *   NEW_DOMAIN: number,
 *   UNEXPECTED: number,
 *   WILDCARD: number,
 * }>}
 */
const CAREER_EXPLORATION_MIX = Object.freeze({
  /** Highest identity-fit delta jobs. */
  HIGHEST_DELTA: 0.4,
  /** Jobs aligned with newly discovered identity / occupation domains. */
  NEW_DOMAIN: 0.3,
  /** Unexpected but still plausible mid-range fits. */
  UNEXPECTED: 0.2,
  /** Serendipitous leftovers for breadth. */
  WILDCARD: 0.1,
});

/**
 * @type {Readonly<{
 *   MIN_JOBS: number,
 *   MAX_JOBS: number,
 *   DEFAULT_JOBS: number,
 *   TRIGGER_NONE_BELOW: number,
 *   TRIGGER_MILD_BELOW: number,
 *   TRIGGER_MODERATE_BELOW: number,
 *   UNEXPECTED_DELTA_MIN: number,
 *   UNEXPECTED_DELTA_MAX: number,
 *   UNEXPECTED_NEW_SCORE_MIN: number,
 *   UNEXPECTED_NEW_SCORE_MAX: number,
 *   NEW_DOMAIN_AFFINITY_MIN: number,
 *   MMR_LAMBDA: number,
 *   MMR_MIN_NOVELTY: number,
 *   USE_MMR_FOR_HIGHEST_DELTA: boolean,
 *   USE_MMR_FOR_NEW_DOMAIN: boolean,
 *   USE_MMR_FOR_UNEXPECTED: boolean,
 *   USE_MMR_FOR_WILDCARD: boolean,
 * }>}
 */
const CAREER_EXPLORATION_THRESHOLDS = Object.freeze({
  MIN_JOBS: 3,
  MAX_JOBS: 10,
  DEFAULT_JOBS: 5,

  /**
   * Identity changeScore (0–100) → triggerLevel (display / analytics).
   * Pipeline gating uses adaptiveEvolutionGate instead of these alone.
   * none < MILD ≤ mild < MODERATE ≤ moderate < STRONG ≤ strong
   */
  TRIGGER_NONE_BELOW: 30,
  TRIGGER_MILD_BELOW: 50,
  TRIGGER_MODERATE_BELOW: 70,

  /** Unexpected bucket: mid-range deltas (absolute cosine units). */
  UNEXPECTED_DELTA_MIN: 0.03,
  UNEXPECTED_DELTA_MAX: 0.18,
  UNEXPECTED_NEW_SCORE_MIN: 0.28,
  UNEXPECTED_NEW_SCORE_MAX: 0.72,

  /** Min affinity for a job to count as “from” a new domain (0–1). */
  NEW_DOMAIN_AFFINITY_MIN: 0.15,

  /** MMR diversity knobs (used when embeddings are available). */
  MMR_LAMBDA: 0.7,
  MMR_MIN_NOVELTY: 0.05,

  USE_MMR_FOR_HIGHEST_DELTA: true,
  USE_MMR_FOR_NEW_DOMAIN: true,
  USE_MMR_FOR_UNEXPECTED: true,
  USE_MMR_FOR_WILDCARD: false,
});

/** Stable bucket ids used on exploration job metadata. */
const CAREER_EXPLORATION_SOURCES = Object.freeze({
  HIGHEST_DELTA: 'highest_delta',
  NEW_DOMAIN: 'new_domain',
  UNEXPECTED: 'unexpected',
  WILDCARD: 'wildcard',
});

/** triggerLevel vocabulary. */
const CAREER_EXPLORATION_TRIGGER_LEVELS = Object.freeze({
  NONE: 'none',
  MILD: 'mild',
  MODERATE: 'moderate',
  STRONG: 'strong',
});

module.exports = {
  CAREER_EXPLORATION_MIX,
  CAREER_EXPLORATION_THRESHOLDS,
  CAREER_EXPLORATION_SOURCES,
  CAREER_EXPLORATION_TRIGGER_LEVELS,
};
