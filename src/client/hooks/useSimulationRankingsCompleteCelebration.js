import { useCallback, useEffect, useRef, useState } from 'react';
import { areBothSimulationRankingsComplete } from '../utils/simulationRoleRanking';

/**
 * Opens a one-time celebration when both simulation category rankings become visible.
 * Skips the initial mount if rankings were already complete (e.g. page reload).
 */
export function useSimulationRankingsCompleteCelebration(evaluationFlow) {
  const [open, setOpen] = useState(false);
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
      setOpen(true);
    }
    prevCompleteRef.current = bothComplete;
  }, [bothComplete]);

  const close = useCallback(() => setOpen(false), []);

  return { open, close, bothComplete };
}
