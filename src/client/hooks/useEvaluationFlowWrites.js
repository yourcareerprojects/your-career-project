import { useCallback } from 'react';
import {
  commitEvaluationFlowRole,
  promoteEvaluationFlowCategory,
  unlockEvaluationFlowOutsideTheBox,
  skipEvaluationFlowOutsideTheBox,
  resumeEvaluationFlowOutsideTheBox,
  resumeEvaluationFlowWizard,
  reorderEvaluationFlowCombined,
  reorderEvaluationFlowRanked,
} from '../utils/evaluationFlowWrites';

/**
 * Shared evaluate / promote / reorder / OOTB handlers for Simulation pages.
 *
 * @param {object} options
 * @param {(updater: (prev: any) => any) => void} options.setState
 * @param {(prev: any) => object | null | undefined} options.getFlow
 * @param {(prev: any, nextFlow: object) => any} options.putFlow
 * @param {(nextState: any) => void} [options.onCommitted] — called inside the state updater after a real write
 * @param {() => void} [options.onWrite] — called after scheduling a write (e.g. mark dirty)
 */
export function useEvaluationFlowWrites({
  setState,
  getFlow,
  putFlow,
  onCommitted,
  onWrite,
}) {
  const applyFlowWrite = useCallback(
    (mutate) => {
      setState((prev) => {
        const flow = getFlow(prev);
        if (!flow) return prev;
        const nextFlow = mutate(flow);
        if (!nextFlow || nextFlow === flow) return prev;
        const next = putFlow(prev, nextFlow);
        onCommitted?.(next);
        return next;
      });
      onWrite?.();
    },
    [setState, getFlow, putFlow, onCommitted, onWrite]
  );

  const handleEvaluationCommit = useCallback(
    (categoryKey, stepId, evaluation) => {
      applyFlowWrite((flow) => commitEvaluationFlowRole(flow, categoryKey, stepId, evaluation));
    },
    [applyFlowWrite]
  );

  const handleSeeRoleRanking = useCallback(
    (categoryKey) => {
      applyFlowWrite((flow) => promoteEvaluationFlowCategory(flow, categoryKey));
    },
    [applyFlowWrite]
  );

  const handleUnlockMobileOutsideTheBox = useCallback(() => {
    applyFlowWrite((flow) => unlockEvaluationFlowOutsideTheBox(flow));
  }, [applyFlowWrite]);

  const handleSkipOutsideTheBox = useCallback(() => {
    applyFlowWrite((flow) => skipEvaluationFlowOutsideTheBox(flow));
  }, [applyFlowWrite]);

  const handleResumeOutsideTheBox = useCallback(() => {
    applyFlowWrite((flow) => resumeEvaluationFlowOutsideTheBox(flow));
  }, [applyFlowWrite]);

  const handleResumeWizard = useCallback(() => {
    applyFlowWrite((flow) => resumeEvaluationFlowWizard(flow));
  }, [applyFlowWrite]);

  const handleReorderCombinedRankedRoles = useCallback(
    (reorderedRows) => {
      applyFlowWrite((flow) => reorderEvaluationFlowCombined(flow, reorderedRows));
    },
    [applyFlowWrite]
  );

  const handleReorderRankedRoles = useCallback(
    (categoryKey, reorderedRows) => {
      applyFlowWrite((flow) => reorderEvaluationFlowRanked(flow, categoryKey, reorderedRows));
    },
    [applyFlowWrite]
  );

  return {
    handleEvaluationCommit,
    handleSeeRoleRanking,
    handleUnlockMobileOutsideTheBox,
    handleSkipOutsideTheBox,
    handleResumeOutsideTheBox,
    handleResumeWizard,
    handleReorderCombinedRankedRoles,
    handleReorderRankedRoles,
  };
}
