import { useEffect, useRef } from 'react';
import { areBothSimulationRankingsComplete } from '../utils/simulationRoleRanking';
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
 * Fires a one-time star burst when both simulation category rankings become visible.
 * Skips celebration when opening a simulation that already had both rankings complete.
 */
export function useSimulationRankingsCompleteCelebration(evaluationFlow) {
  const flowKeyRef = useRef(null);
  const initializedRef = useRef(false);
  const wasCompleteRef = useRef(false);

  const flowKey = evaluationFlow ? normalizeFlowKey(evaluationFlow) : null;
  const bothComplete = areBothSimulationRankingsComplete(evaluationFlow);

  useEffect(() => {
    if (!evaluationFlow || flowKey == null) return;

    if (
      flowKeyRef.current != null &&
      !isSameFlowSession(flowKeyRef.current, flowKey)
    ) {
      flowKeyRef.current = flowKey;
      initializedRef.current = false;
      wasCompleteRef.current = false;
    } else {
      flowKeyRef.current = flowKey;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      wasCompleteRef.current = bothComplete;
      return;
    }

    if (bothComplete && !wasCompleteRef.current) {
      fireStarBurstConfetti();
    }
    wasCompleteRef.current = bothComplete;
  }, [bothComplete, evaluationFlow, flowKey]);
}
