/**
 * Tunable knobs for the identity exploration pipeline (role pool, gating, async).
 */

const IDENTITY_PIPELINE_CONFIG = Object.freeze({
  /**
   * Max CareerPath docs loaded for delta matching.
   * Prefer identity_vector-ready, non-excluded paths.
   * Kept modest — identity pass is O(n); profile grounding only scores a shortlist.
   */
  ROLE_POOL_LIMIT: 280,

  /**
   * When true, first identity (no prior snapshot) also runs initial exploration.
   * Keep false: profile fill + first simulation establish the baseline only;
   * Discover unlocks after post-onboarding identity change.
   */
  FIRST_EXPLORATION_ENABLED: false,

  /** Minimum scorable puzzle pieces before first exploration can trigger. */
  FIRST_EXPLORATION_MIN_PIECES: 1,

  /**
   * When true, puzzle_updated handlers run the pipeline without blocking the emitter
   * (setImmediate). Explicit API runs remain awaited.
   */
  RUN_EVENT_HANDLERS_ASYNC: true,

  /** Include identity change reasons in stored exploration sessions. */
  STORE_CHANGE_REASONS: true,

  /** Max title length stored on exploration job snapshots. */
  STORED_TITLE_MAX_LENGTH: 120,
});

module.exports = {
  IDENTITY_PIPELINE_CONFIG,
};
