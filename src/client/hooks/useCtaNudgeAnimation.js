import { useEffect, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { useIdleNudge } from './useIdleNudge';

export const CTA_NUDGE_DURATION_MS = 580;

export const ctaNudgeKeyframes = {
  '@keyframes ctaNudge': {
    '0%, 100%': { transform: 'translateY(0) scale(1)' },
    '28%': { transform: 'translateY(-8px) scale(1.02)' },
    '52%': { transform: 'translateY(2px) scale(1)' },
    '76%': { transform: 'translateY(-4px) scale(1.01)' },
  },
};

/**
 * Idle-timed bounce animation shared by primary CTAs (home "Let's go", profile simulation, etc.).
 */
export function useCtaNudgeAnimation({ enabled = true } = {}) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const nudgeEnabled = enabled && !prefersReducedMotion;
  const { nudgeCount, pause, resume } = useIdleNudge({ enabled: nudgeEnabled });
  const [isNudging, setIsNudging] = useState(false);

  useEffect(() => {
    if (!nudgeEnabled || nudgeCount === 0) {
      return undefined;
    }
    setIsNudging(true);
    const timer = setTimeout(() => setIsNudging(false), CTA_NUDGE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [nudgeCount, nudgeEnabled]);

  return {
    nudgeInteractionHandlers: {
      onMouseEnter: pause,
      onMouseLeave: resume,
      onFocus: pause,
      onBlur: resume,
    },
    nudgeSx: {
      willChange: 'transform',
      ...ctaNudgeKeyframes,
      ...(isNudging
        ? {
            animation: `ctaNudge ${CTA_NUDGE_DURATION_MS}ms cubic-bezier(0.34, 1.45, 0.64, 1)`,
          }
        : {}),
    },
  };
}
