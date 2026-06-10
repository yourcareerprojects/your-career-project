import { useEffect, useRef } from 'react';
import { areBothSimulationRankingsComplete } from '../utils/simulationRoleRanking';
import { fireStarBurstConfetti } from '../utils/profileCreatedConfetti';

/**
 * Fires a one-time star burst when both simulation category rankings become visible.
 * Skips the initial mount if rankings were already complete (e.g. page reload).
 */
export function useSimulationRankingsCompleteCelebration(evaluationFlow) {
  const prevCompleteRef = useRef(null);
  const hasShownRef = useRef(false);

  const bothComplete = areBothSimulationRankingsComplete(evaluationFlow);

  useEffect(() => {
    if (prevCompleteRef.current === null) {
      prevCompleteRef.current = bothComplete;
      return;
    }
    if (bothComplete && !prevCompleteRef.current && !hasShownRef.current) {
      hasShownRef.current = true;
      fireStarBurstConfetti();
    }
    prevCompleteRef.current = bothComplete;
  }, [bothComplete]);
}
