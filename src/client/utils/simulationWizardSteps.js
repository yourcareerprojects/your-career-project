import {
  EVALUATION_ROLES_TARGET,
  countEvaluatedRoles,
  isEvaluationComplete,
  isMobileOutsideTheBoxUnlocked,
  isOutsideTheBoxDeferred,
} from './simulationRoleRanking';

export const NEXT_SIMULATION_WIZARD_TOTAL = 12;
export const OOTB_SIMULATION_WIZARD_TOTAL = 10;

export const NEXT_WIZARD_LOADING_STEP = 1;
export const NEXT_WIZARD_FIRST_ROLE_STEP = 2;
export const NEXT_WIZARD_LAST_ROLE_STEP = 11;
export const NEXT_WIZARD_OOTB_CHOICE_STEP = 12;

/**
 * @param {number} step — 2–11
 * @returns {number | null} zero-based role index
 */
export function getRoleIndexForNextWizardStep(step) {
  if (step < NEXT_WIZARD_FIRST_ROLE_STEP || step > NEXT_WIZARD_LAST_ROLE_STEP) return null;
  return step - NEXT_WIZARD_FIRST_ROLE_STEP;
}

/**
 * @param {number} evaluatedCount
 * @returns {number}
 */
export function getNextWizardStepForEvaluatedCount(evaluatedCount) {
  if (evaluatedCount >= EVALUATION_ROLES_TARGET) return NEXT_WIZARD_OOTB_CHOICE_STEP;
  return NEXT_WIZARD_FIRST_ROLE_STEP + evaluatedCount;
}

/**
 * @param {number} step — 1–10
 * @returns {number} zero-based OOTB role index
 */
export function getRoleIndexForOotbWizardStep(step) {
  return Math.max(0, Math.min(EVALUATION_ROLES_TARGET - 1, step - 1));
}

/**
 * Whether step-by-step wizard evaluation is still in progress (rankings not yet revealed).
 *
 * @param {object | null | undefined} evaluationFlow
 * @returns {boolean}
 */
export function isSimulationWizardEvaluationInProgress(evaluationFlow) {
  if (!evaluationFlow) return false;

  const nextRanked = evaluationFlow.phases?.nextSteps === 'ranked';
  const ootbRanked = evaluationFlow.phases?.outsideTheBox === 'ranked';
  const ootbDeferred = isOutsideTheBoxDeferred(evaluationFlow);

  if (nextRanked && (ootbRanked || ootbDeferred)) return false;

  if (!isEvaluationComplete(evaluationFlow.nextSteps)) return true;

  if (!isMobileOutsideTheBoxUnlocked(evaluationFlow) && !ootbDeferred) return true;

  if (isMobileOutsideTheBoxUnlocked(evaluationFlow) && !ootbDeferred) {
    if (!isEvaluationComplete(evaluationFlow.outsideTheBox)) return true;
    if (!ootbRanked) return true;
  }

  return false;
}

/**
 * Whether the user paused the wizard and can resume later.
 *
 * @param {object | null | undefined} evaluationFlow
 * @returns {boolean}
 */
export function canResumeSimulationWizard(evaluationFlow) {
  return Boolean(evaluationFlow?.wizardPaused)
    && isSimulationWizardEvaluationInProgress(evaluationFlow);
}

/**
 * Whether the step-by-step evaluation wizard should be shown instead of inline evaluation.
 *
 * @param {{ simLoading?: boolean, evaluationFlow?: object | null, simulationWizardIntent?: boolean }} params
 * @returns {boolean}
 */
export function isSimulationWizardActive({
  simLoading = false,
  evaluationFlow = null,
  simulationWizardIntent = false,
  hasSimulationResults = false,
}) {
  if (simLoading && simulationWizardIntent) return true;
  if (simulationWizardIntent && hasSimulationResults && !evaluationFlow) return true;
  if (!evaluationFlow) return false;
  if (evaluationFlow.wizardPaused && !simulationWizardIntent) return false;
  return isSimulationWizardEvaluationInProgress(evaluationFlow);
}

/**
 * @param {{ simLoading?: boolean, evaluationFlow?: object | null }} params
 * @returns {{ phase: 'next' | 'ootb', step: number } | null}
 */
export function deriveSimulationWizardStep({ simLoading = false, evaluationFlow = null }) {
  if (simLoading || !evaluationFlow) {
    return { phase: 'next', step: NEXT_WIZARD_LOADING_STEP };
  }

  const nextComplete = isEvaluationComplete(evaluationFlow.nextSteps);
  if (!nextComplete) {
    const evaluated = countEvaluatedRoles(evaluationFlow.nextSteps);
    return { phase: 'next', step: getNextWizardStepForEvaluatedCount(evaluated) };
  }

  const ootbUnlocked = isMobileOutsideTheBoxUnlocked(evaluationFlow);
  const ootbDeferred = isOutsideTheBoxDeferred(evaluationFlow);

  if (!ootbUnlocked && !ootbDeferred) {
    return { phase: 'next', step: NEXT_WIZARD_OOTB_CHOICE_STEP };
  }

  if (ootbDeferred) return null;

  const ootbComplete = isEvaluationComplete(evaluationFlow.outsideTheBox);
  if (!ootbComplete) {
    const evaluated = countEvaluatedRoles(evaluationFlow.outsideTheBox);
    return {
      phase: 'ootb',
      step: Math.min(Math.max(1, evaluated + 1), OOTB_SIMULATION_WIZARD_TOTAL),
    };
  }

  return null;
}
