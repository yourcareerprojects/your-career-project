/** Manual profile fill: optional CV → seniority → five coaching chats → tasks → skills → learning goals. */
const MANUAL_FILL_REVIEW_STEPS = {
  OPTIONAL_CV: 1,
  SENIORITY: 5,
  WORK_ENJOY_COACHING: 6,
  TOPICS_COACHING: 7,
  STRENGTHS_COACHING: 8,
  WORK_ENVIRONMENT_COACHING: 9,
  WORKING_LIFE_ACHIEVEMENT_COACHING: 10,
  TASKS_RESPONSIBILITIES: 12,
  SKILLS_SELECTION: 11,
  SKILLS_TO_LEARN: 13,
};

const MANUAL_FILL_STEP_ORDER = [
  MANUAL_FILL_REVIEW_STEPS.OPTIONAL_CV,
  MANUAL_FILL_REVIEW_STEPS.SENIORITY,
  MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING,
  MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING,
  MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING,
  MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING,
  MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING,
  MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES,
  MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION,
  MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN,
];

const MANUAL_FILL_STEP_COUNT = MANUAL_FILL_STEP_ORDER.length;

function manualFillProgressIndex(reviewStep) {
  const idx = MANUAL_FILL_STEP_ORDER.indexOf(reviewStep);
  return idx >= 0 ? idx + 1 : 1;
}

function nextManualFillStep(reviewStep) {
  const idx = MANUAL_FILL_STEP_ORDER.indexOf(reviewStep);
  if (idx < 0 || idx >= MANUAL_FILL_STEP_ORDER.length - 1) return null;
  return MANUAL_FILL_STEP_ORDER[idx + 1];
}

function prevManualFillStep(reviewStep) {
  const idx = MANUAL_FILL_STEP_ORDER.indexOf(reviewStep);
  if (idx <= 0) return null;
  return MANUAL_FILL_STEP_ORDER[idx - 1];
}

function isManualFillFirstStep(reviewStep) {
  return reviewStep === MANUAL_FILL_STEP_ORDER[0];
}

function isManualFillLastStep(reviewStep) {
  return reviewStep === MANUAL_FILL_STEP_ORDER[MANUAL_FILL_STEP_ORDER.length - 1];
}

module.exports = {
  MANUAL_FILL_REVIEW_STEPS,
  MANUAL_FILL_STEP_ORDER,
  MANUAL_FILL_STEP_COUNT,
  manualFillProgressIndex,
  nextManualFillStep,
  prevManualFillStep,
  isManualFillFirstStep,
  isManualFillLastStep,
};
