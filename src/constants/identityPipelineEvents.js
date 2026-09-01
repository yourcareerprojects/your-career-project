/**
 * Event names for the Career Identity exploration pipeline.
 * Emitted after puzzle pieces are recomputed; handlers run the evolution flow.
 */

const IDENTITY_PIPELINE_EVENTS = Object.freeze({
  /** Puzzle traits were recomputed and persisted (not a cache hit). */
  PUZZLE_UPDATED: 'identity:puzzle_updated',
  /**
   * Change score crossed the meaningful-change floor — role matching is starting.
   * Clients can flip the progress card to "preparing" before jobs are stored.
   */
  EXPLORATION_THRESHOLD_REACHED: 'identity:exploration_threshold_reached',
  /** Pipeline finished (explored, skipped, seeded, or failed). */
  PIPELINE_COMPLETED: 'identity:exploration_pipeline_completed',
  /** Pipeline failed unexpectedly. */
  PIPELINE_FAILED: 'identity:exploration_pipeline_failed',
});

module.exports = {
  IDENTITY_PIPELINE_EVENTS,
};
