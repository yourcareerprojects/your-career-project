import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ROLE_EVAL_SCROLL_SELECTOR,
  SWIPE_ACTIVATION_PX,
  SWIPE_EXIT_MS,
  resolveSwipeCommitDirection,
  shouldAbortForVerticalSwipe,
  shouldCommitToHorizontalSwipe,
} from '../utils/roleEvaluationSwipeGestures';

export {
  SWIPE_ACTIVATION_PX,
  SWIPE_COMMIT_MIN_PX,
  SWIPE_COMMIT_RATIO,
  SWIPE_EXIT_MS,
  resolveSwipeCommitDirection,
  shouldAbortForVerticalSwipe,
  shouldCommitToHorizontalSwipe,
} from '../utils/roleEvaluationSwipeGestures';

const INTERACTIVE_SELECTOR = 'button, a, [role="button"], input, textarea, select, label';

/**
 * Pointer-driven horizontal swipe for role evaluation (right = cool, left = uncool).
 * Uses document-level move/end listeners and only calls preventDefault once the
 * gesture is clearly horizontal, so nested scroll areas keep working.
 */
export function useRoleEvaluationSwipe({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  onInteractionStart,
  onInteractionEnd,
}) {
  const containerRef = useRef(null);
  const trackingRef = useRef(null);
  const listenersRef = useRef({ move: null, up: null, cancel: null });
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState(null);

  const resetGesture = useCallback(() => {
    trackingRef.current = null;
    setDragging(false);
  }, []);

  const stopTracking = useCallback(() => {
    const { move, up, cancel } = listenersRef.current;
    if (move) window.removeEventListener('pointermove', move);
    if (up) window.removeEventListener('pointerup', up);
    if (cancel) window.removeEventListener('pointercancel', cancel);
    trackingRef.current = null;
  }, []);

  const finishSwipe = useCallback(
    (direction) => {
      const width = containerRef.current?.getBoundingClientRect?.().width || 320;
      const exitDistance = Math.max(width * 1.15, 280);
      setExiting(direction);
      setOffsetX(direction === 'right' ? exitDistance : -exitDistance);
      setDragging(false);
      stopTracking();

      window.setTimeout(() => {
        if (direction === 'right') onSwipeRight?.();
        else onSwipeLeft?.();
        setExiting(null);
        setOffsetX(0);
        resetGesture();
        onInteractionEnd?.();
      }, SWIPE_EXIT_MS);
    },
    [onSwipeLeft, onSwipeRight, onInteractionEnd, resetGesture, stopTracking]
  );

  useEffect(() => {
    const onPointerMove = (event) => {
      const tracking = trackingRef.current;
      if (!enabled || exiting || !tracking || tracking.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - tracking.startX;
      const deltaY = event.clientY - tracking.startY;

      if (!tracking.committed) {
        if (shouldAbortForVerticalSwipe(deltaX, deltaY)) {
          stopTracking();
          resetGesture();
          onInteractionEnd?.();
          return;
        }
        if (!shouldCommitToHorizontalSwipe(deltaX, deltaY)) return;

        tracking.committed = true;
        setDragging(true);
      }

      event.preventDefault();
      setOffsetX(deltaX);
    };

    const onPointerUp = (event) => {
      const tracking = trackingRef.current;
      if (!enabled || !tracking || tracking.pointerId !== event.pointerId) return;

      const deltaX = tracking.committed ? event.clientX - tracking.startX : 0;
      const width = containerRef.current?.getBoundingClientRect?.().width || 320;
      const direction = tracking.committed
        ? resolveSwipeCommitDirection(deltaX, width)
        : null;

      stopTracking();

      if (direction) {
        finishSwipe(direction);
        return;
      }

      setOffsetX(0);
      resetGesture();
      onInteractionEnd?.();
    };

    const onPointerCancel = (event) => {
      const tracking = trackingRef.current;
      if (!tracking || tracking.pointerId !== event.pointerId) return;
      stopTracking();
      setOffsetX(0);
      resetGesture();
      onInteractionEnd?.();
    };

    listenersRef.current = {
      move: onPointerMove,
      up: onPointerUp,
      cancel: onPointerCancel,
    };

    return () => stopTracking();
  }, [enabled, exiting, finishSwipe, onInteractionEnd, resetGesture, stopTracking]);

  const handlePointerDown = useCallback(
    (event) => {
      if (!enabled || exiting || trackingRef.current) return;
      if (event.button != null && event.button !== 0) return;
      if (event.target?.closest?.(INTERACTIVE_SELECTOR)) return;

      const scrollEl = event.target?.closest?.(ROLE_EVAL_SCROLL_SELECTOR);
      if (scrollEl && scrollEl.scrollTop > 0) return;

      const { move, up, cancel } = listenersRef.current;
      if (!move || !up || !cancel) return;

      trackingRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        committed: false,
      };
      onInteractionStart?.();

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    [enabled, exiting, onInteractionStart]
  );

  const swipeDirection =
    offsetX > SWIPE_ACTIVATION_PX ? 'right' : offsetX < -SWIPE_ACTIVATION_PX ? 'left' : null;

  return {
    containerRef,
    offsetX,
    dragging,
    exiting,
    swipeDirection,
    bind: {
      onPointerDown: handlePointerDown,
    },
  };
}
