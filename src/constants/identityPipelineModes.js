/**
 * Exploration pipeline modes — explicit first vs subsequent behavior.
 */

const IDENTITY_PIPELINE_MODES = Object.freeze({
  /** No prior snapshot: seed baseline only (initial Discover is disabled). */
  FIRST: 'first',
  /** Prior snapshot exists: delta comparison + adaptive gate (unchanged). */
  SUBSEQUENT: 'subsequent',
});

module.exports = {
  IDENTITY_PIPELINE_MODES,
};
