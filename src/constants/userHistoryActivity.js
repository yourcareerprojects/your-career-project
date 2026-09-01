/**
 * Shared activity / milestone type codes for the user History timeline.
 */

const ACTIVITY_TYPES = Object.freeze({
  PROFILE_SECTION_UPDATED: 'profile_section_updated',
  DOCUMENT_UPLOADED: 'document_uploaded',
  SIMULATION_COMPLETED: 'simulation_completed',
  SIMULATION_SAVED: 'simulation_saved',
  // Retained for rendering historical timeline entries created before saved-step removal.
  CAREER_STEP_SAVED: 'career_step_saved',
  CAREER_STEP_EVALUATED: 'career_step_evaluated',
  TRAIT_VOTED: 'trait_voted',
  ROLES_UNLOCKED: 'roles_unlocked',
  PROFILE_FILLED: 'profile_filled',
  FIRST_SIMULATION: 'first_simulation',
});

const MILESTONE_TYPES = Object.freeze({
  PROFILE_CREATED: 'profile_created',
  PROFILE_FILLED: 'profile_filled',
  FIRST_SIMULATION: 'first_simulation',
  ROLES_UNLOCKED: 'roles_unlocked',
});

/** Activity types that are themselves milestones — omit from intervening activity lists. */
const MILESTONE_ACTIVITY_TYPES = new Set([
  ACTIVITY_TYPES.PROFILE_FILLED,
  ACTIVITY_TYPES.FIRST_SIMULATION,
  ACTIVITY_TYPES.ROLES_UNLOCKED,
]);

module.exports = {
  ACTIVITY_TYPES,
  MILESTONE_TYPES,
  MILESTONE_ACTIVITY_TYPES,
};
