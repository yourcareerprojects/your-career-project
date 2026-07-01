const {
  isManualFillFirstStep,
  isManualFillLastStep,
  MANUAL_FILL_REVIEW_STEPS,
  MANUAL_FILL_STEP_COUNT,
  manualFillProgressIndex,
  nextManualFillStep,
  prevManualFillStep,
} = require('../utils/manualFillStepOrder');

describe('manualFillStepOrder', () => {
  it('starts with optional CV and includes ten manual steps', () => {
    expect(MANUAL_FILL_STEP_COUNT).toBe(10);
    expect(MANUAL_FILL_REVIEW_STEPS.OPTIONAL_CV).toBe(1);
    expect(manualFillProgressIndex(1)).toBe(1);
    expect(manualFillProgressIndex(5)).toBe(2);
    expect(manualFillProgressIndex(6)).toBe(3);
    expect(manualFillProgressIndex(7)).toBe(4);
    expect(manualFillProgressIndex(8)).toBe(5);
    expect(manualFillProgressIndex(9)).toBe(6);
    expect(manualFillProgressIndex(10)).toBe(7);
    expect(manualFillProgressIndex(12)).toBe(8);
    expect(manualFillProgressIndex(11)).toBe(9);
    expect(manualFillProgressIndex(13)).toBe(10);
  });

  it('navigates forward and backward through manual steps', () => {
    expect(nextManualFillStep(1)).toBe(5);
    expect(nextManualFillStep(5)).toBe(6);
    expect(nextManualFillStep(6)).toBe(7);
    expect(nextManualFillStep(7)).toBe(8);
    expect(nextManualFillStep(8)).toBe(9);
    expect(nextManualFillStep(9)).toBe(10);
    expect(nextManualFillStep(10)).toBe(12);
    expect(nextManualFillStep(12)).toBe(11);
    expect(nextManualFillStep(11)).toBe(13);
    expect(nextManualFillStep(13)).toBeNull();

    expect(prevManualFillStep(13)).toBe(11);
    expect(prevManualFillStep(11)).toBe(12);
    expect(prevManualFillStep(12)).toBe(10);
    expect(prevManualFillStep(10)).toBe(9);
    expect(prevManualFillStep(9)).toBe(8);
    expect(prevManualFillStep(8)).toBe(7);
    expect(prevManualFillStep(7)).toBe(6);
    expect(prevManualFillStep(6)).toBe(5);
    expect(prevManualFillStep(5)).toBe(1);
    expect(prevManualFillStep(1)).toBeNull();
  });

  it('identifies first and last manual steps', () => {
    expect(isManualFillFirstStep(1)).toBe(true);
    expect(isManualFillFirstStep(5)).toBe(false);
    expect(isManualFillLastStep(4)).toBe(false);
    expect(isManualFillLastStep(13)).toBe(true);
    expect(isManualFillLastStep(3)).toBe(false);
  });

  it('exposes dedicated review steps for coaching chats, tasks, and skill selection', () => {
    expect(MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING).toBe(6);
    expect(MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING).toBe(7);
    expect(MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING).toBe(8);
    expect(MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING).toBe(9);
    expect(MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING).toBe(10);
    expect(MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES).toBe(12);
    expect(MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION).toBe(11);
    expect(MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN).toBe(13);
  });
});
