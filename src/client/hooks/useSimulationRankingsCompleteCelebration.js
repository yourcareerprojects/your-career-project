import { useEffect, useRef } from 'react';
import { isSimulationRankingOverviewCelebrationEligible } from '../utils/simulationRoleRanking';
import { fireStarBurstConfetti } from '../utils/profileCreatedConfetti';

function normalizeFlowKey(evaluationFlow) {
  return evaluationFlow?.simulationId ?? 'local';
}

/** Flow may start as "local" before results.simulationId is assigned — same session. */
function isSameFlowSession(previousKey, nextKey) {
  if (previousKey === nextKey) return true;
  if (previousKey === 'local' && nextKey && nextKey !== 'local') return true;
  return false;
}

/**
 * Fires a one-time star burst when a simulation ranking overview becomes visible —
 * either both categories are ranked, or next-role ranking after skipping OOTB for now.
 * Skips celebration when opening a simulation that already reached that state.
 */
export function useSimulationRankingsCompleteCelebration(evaluationFlow) {
  const flowKeyRef = useRef(null);
  const initializedRef = useRef(false);
  const wasCelebrationEligibleRef = useRef(false);

  const flowKey = evaluationFlow ? normalizeFlowKey(evaluationFlow) : null;
  const celebrationEligible = isSimulationRankingOverviewCelebrationEligible(evaluationFlow);

  useEffect(() => {
    if (!evaluationFlow || flowKey == null) return;

    if (
      flowKeyRef.current != null &&
      !isSameFlowSession(flowKeyRef.current, flowKey)
    ) {
      flowKeyRef.current = flowKey;
      initializedRef.current = false;
      wasCelebrationEligibleRef.current = false;
    } else {
      flowKeyRef.current = flowKey;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      wasCelebrationEligibleRef.current = celebrationEligible;
      return;
    }

    if (celebrationEligible && !wasCelebrationEligibleRef.current) {
      fireStarBurstConfetti();
    }
    wasCelebrationEligibleRef.current = celebrationEligible;
  }, [celebrationEligible, evaluationFlow, flowKey]);
}
