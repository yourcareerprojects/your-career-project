import { useLayoutEffect, useState } from 'react';

/**
 * Pins swipe UI to a panel's viewport rect while a gesture is active so the
 * card and cues are not clipped by nested overflow containers.
 */
export function useSwipePanelExpansion({ active, stageRef, measureRef }) {
  const [panelFrame, setPanelFrame] = useState(null);

  useLayoutEffect(() => {
    if (!active || !stageRef?.current) {
      setPanelFrame(null);
      return undefined;
    }

    const updateFrame = () => {
      const stageEl = stageRef.current;
      if (!stageEl) return;

      const stageRect = stageEl.getBoundingClientRect();
      const measuredHeight = measureRef?.current?.offsetHeight;

      setPanelFrame({
        top: stageRect.top,
        left: stageRect.left,
        width: stageRect.width,
        height: measuredHeight && measuredHeight > 0 ? measuredHeight : undefined,
      });
    };

    updateFrame();
    window.addEventListener('resize', updateFrame);
    window.addEventListener('scroll', updateFrame, true);

    return () => {
      window.removeEventListener('resize', updateFrame);
      window.removeEventListener('scroll', updateFrame, true);
    };
  }, [active, stageRef, measureRef]);

  return panelFrame;
}
