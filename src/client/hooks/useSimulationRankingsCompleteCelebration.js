import { useEffect, useRef } from 'react';
import { areBothSimulationRankingsComplete } from '../utils/simulationRoleRanking';
import { fireStarBurstConfetti } from '../utils/profileCreatedConfetti';

/**
 * Fires a one-time star burst when both simulation category rankings become visible.
 * Skips celebration when opening a simulation that already had both rankings complete.
 */
export function useSimulationRankingsCompleteCelebration(evaluationFlow) {
  const prevCompleteRef = useRef(false);
  const hasShownRef = useRef(false);
  const flowKeyRef = useRef(null);

  const flowKey = evaluationFlow?.simulationId ?? null;
  const bothComplete = areBothSimulationRankingsComplete(evaluationFlow);

  useEffect(() => {
    if (!evaluationFlow) return;

    if (flowKeyRef.current !== flowKey) {
      flowKeyRef.current = flowKey;
      prevCompleteRef.current = bothComplete;
      hasShownRef.current = false;
      return;
    }

    if (bothComplete && !prevCompleteRef.current && !hasShownRef.current) {
      hasShownRef.current = true;
      fireStarBurstConfetti();
    }
    prevCompleteRef.current = bothComplete;
  }, [bothComplete, evaluationFlow, flowKey]);
}
