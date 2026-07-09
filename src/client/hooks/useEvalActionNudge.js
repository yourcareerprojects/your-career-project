import { useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { useIdleNudge } from './useIdleNudge';
import { CTA_NUDGE_DURATION_MS, ctaNudgeKeyframes } from './useCtaNudgeAnimation';

/** Rating actions that receive sequential idle nudges (one at a time). */
export const EVAL_RATING_NUDGE_BUTTON_KEYS = ['keep', 'skip', 'dislike'];

/** Includes the More button used in the inline (non-wizard) evaluation grid. */
export const EVAL_NUDGE_BUTTON_KEYS = [...EVAL_RATING_NUDGE_BUTTON_KEYS, 'more'];

const DEFAULT_IDLE_MS = 2250;
const DEFAULT_REPEAT_MS = 5500;
const DEFAULT_MAX_NUDGES = 16;

/**
 * Cycles idle nudges across evaluation buttons so only one jumps per idle pulse.
 */
export function useEvalActionNudge({
  enabled = true,
  buttonKeys = EVAL_NUDGE_BUTTON_KEYS,
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
    () => buttonKeys[nudgeCount % buttonKeys.length],
    [buttonKeys, nudgeCount]
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
