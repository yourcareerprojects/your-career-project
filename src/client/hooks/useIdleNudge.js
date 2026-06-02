import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_IDLE_MS = 5000;
const DEFAULT_REPEAT_MS = 14000;
const DEFAULT_MAX_NUDGES = 4;

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

/**
 * Fires a monotonically increasing nudge counter after idle time, with repeats while
 * the user stays inactive. Meaningful interaction resets the idle timer (mousemove
 * is intentionally excluded so readers still get a gentle CTA hint).
 */
export function useIdleNudge({
  enabled = true,
  idleMs = DEFAULT_IDLE_MS,
  repeatMs = DEFAULT_REPEAT_MS,
  maxNudges = DEFAULT_MAX_NUDGES,
} = {}) {
  const [nudgeCount, setNudgeCount] = useState(0);
  const nudgesSentRef = useRef(0);
  const timerRef = useRef(null);
  const pausedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (delayMs) => {
      clearTimer();
      if (!enabled || pausedRef.current || nudgesSentRef.current >= maxNudges) {
        return;
      }
      timerRef.current = setTimeout(() => {
        nudgesSentRef.current += 1;
        setNudgeCount((c) => c + 1);
        schedule(repeatMs);
      }, delayMs);
    },
    [clearTimer, enabled, maxNudges, repeatMs]
  );

  const resetIdleTimer = useCallback(() => {
    schedule(idleMs);
  }, [idleMs, schedule]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimer();
  }, [clearTimer]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    resetIdleTimer();
  }, [resetIdleTimer]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return undefined;
    }

    schedule(idleMs);

    const onActivity = () => resetIdleTimer();
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, onActivity, { passive: true });
    });

    return () => {
      clearTimer();
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, onActivity);
      });
    };
  }, [clearTimer, enabled, idleMs, resetIdleTimer, schedule]);

  return { nudgeCount, pause, resume };
}
