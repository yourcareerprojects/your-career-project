import { useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { useIdleNudge } from './useIdleNudge';
import { CTA_NUDGE_DURATION_MS, ctaNudgeKeyframes } from './useCtaNudgeAnimation';

/** Evaluation actions that receive sequential idle nudges (one at a time). */
export const EVAL_NUDGE_BUTTON_KEYS = ['keep', 'skip', 'dislike', 'more'];

const DEFAULT_IDLE_MS = 4500;
const DEFAULT_REPEAT_MS = 11000;
const DEFAULT_MAX_NUDGES = 16;

/**
 * Cycles idle nudges across evaluation buttons so only one jumps per idle pulse.
 */
export function useEvalActionNudge({
  enabled = true,
  idleMs = DEFAULT_IDLE_MS,
  repeatMs = DEFAULT_REPEAT_MS,
  maxNudges = DEFAULT_MAX_NUDGES,
} = {}) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const nudgeEnabled = enabled && !prefersReducedMotion;
  const { nudgeCount, pause, resume } = useIdleNudge({
    enabled: nudgeEnabled,
    idleMs,
    repeatMs,
    maxNudges,
  });
  const [isNudging, setIsNudging] = useState(false);

  const activeButtonKey = useMemo(
    () => EVAL_NUDGE_BUTTON_KEYS[nudgeCount % EVAL_NUDGE_BUTTON_KEYS.length],
    [nudgeCount]
  );

  useEffect(() => {
    if (!nudgeEnabled || nudgeCount === 0) {
      return undefined;
    }
    setIsNudging(true);
    const timer = setTimeout(() => setIsNudging(false), CTA_NUDGE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [nudgeCount, nudgeEnabled]);

  const interactionHandlers = {
    onMouseEnter: pause,
    onMouseLeave: resume,
    onFocus: pause,
    onBlur: resume,
  };

  const getButtonNudgeSx = (buttonKey) => ({
    willChange: 'transform',
    ...ctaNudgeKeyframes,
    ...(isNudging && activeButtonKey === buttonKey
      ? {
          animation: `ctaNudge ${CTA_NUDGE_DURATION_MS}ms cubic-bezier(0.34, 1.45, 0.64, 1)`,
        }
      : {}),
  });

  return {
    activeButtonKey,
    isNudging,
    interactionHandlers,
    getButtonNudgeSx,
    pause,
    resume,
  };
}
