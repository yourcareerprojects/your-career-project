/**
 * Presentation bands for identity exploration.
 *
 * changeScore magnitude → how many careers to surface and how prominently.
 * Exploration computation runs for any meaningful change (≥ MEANINGFUL floor).
 */

/** Minimum changeScore before any exploration computation runs. */
const EXPLORATION_MEANINGFUL_CHANGE_SCORE = 5;

/**
 * Bands evaluated highest minChangeScore first.
 * @type {ReadonlyArray<{
 *   id: string,
 *   minChangeScore: number,
 *   minJobs: number,
 *   maxJobs: number,
 *   prominence: 'subtle'|'standard'|'featured'|'full',
 *   notify: boolean,
 *   intensity: number,
 * }>}
 */
const EXPLORATION_PRESENTATION_BANDS = Object.freeze([
  {
    id: 'full',
    minChangeScore: 30,
    minJobs: 7,
    maxJobs: 10,
    prominence: 'full',
    notify: true,
    intensity: 1,
  },
  {
    id: 'substantial',
    minChangeScore: 20,
    minJobs: 4,
    maxJobs: 6,
    prominence: 'featured',
    notify: true,
    intensity: 0.85,
  },
  {
    id: 'moderate',
    minChangeScore: 10,
    minJobs: 2,
    maxJobs: 4,
    prominence: 'standard',
    notify: true,
    intensity: 0.7,
  },
  {
    id: 'light',
    minChangeScore: 5,
    minJobs: 1,
    maxJobs: 2,
    prominence: 'subtle',
    notify: true,
    intensity: 0.5,
  },
]);

/** Fatigue dampens size/intensity — never suppresses the discovery toast. */
const EXPLORATION_PRESENTATION_FATIGUE = Object.freeze({
  /** Lookback for session / job-count fatigue dampening. */
  WINDOW_DAYS: 14,
  RECENT_HOURS: 48,
  RECENT_JOB_REDUCTION: 1,
  RECENT_INTENSITY_MULTIPLIER: 0.85,
  SESSION_SOFT_CAP: 2,
  REDUCE_SIZE_BELOW_BAND_SCORE: 20,
  SESSION_INTENSITY_MULTIPLIER: 0.9,
  JOBS_SOFT_CAP: 12,
  /**
   * Roles surfaced in completed exploration sessions within this window
   * are excluded from new suggestions.
   */
  PREVIOUSLY_SHOWN_WINDOW_DAYS: 90,
});

module.exports = {
  EXPLORATION_MEANINGFUL_CHANGE_SCORE,
  EXPLORATION_PRESENTATION_BANDS,
  EXPLORATION_PRESENTATION_FATIGUE,
};
