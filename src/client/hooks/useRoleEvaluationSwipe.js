import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ROLE_EVAL_SCROLL_SELECTOR,
  SWIPE_ACTIVATION_PX,
  SWIPE_EXIT_MS,
  resolveSwipeCommitDirection,
  shouldAbortForVerticalSwipe,
  shouldCommitToHorizontalSwipe,
  shouldPreferVerticalScroll,
} from '../utils/roleEvaluationSwipeGestures';

export {
  SWIPE_ACTIVATION_PX,
  SWIPE_COMMIT_MIN_PX,
  SWIPE_COMMIT_RATIO,
  SWIPE_EXIT_MS,
  resolveSwipeCommitDirection,
  shouldAbortForVerticalSwipe,
  shouldCommitToHorizontalSwipe,
  shouldPreferVerticalScroll,
} from '../utils/roleEvaluationSwipeGestures';

const INTERACTIVE_SELECTOR = 'button, a, [role="button"], input, textarea, select, label';

/**
 * Pointer-driven horizontal swipe for role evaluation (right = keep, left = dislike).
 * Uses passive move listeners until the gesture is clearly horizontal so nested
 * scroll areas keep working; only then captures the pointer and prevents default.
 */
export function useRoleEvaluationSwipe({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  onInteractionStart,
  onInteractionEnd,
  onExitStart,
  /** When true, commit the swipe immediately and let the parent animate the exit overlay. */
  handoffExitToParent = false,
}) {
  const containerRef = useRef(null);
  const trackingRef = useRef(null);
  const offsetXRef = useRef(0);
  const listenersRef = useRef({
    passiveMove: null,
    activeMove: null,
    up: null,
    cancel: null,
  });
  const callbacksRef = useRef({
    onSwipeLeft,
    onSwipeRight,
    onInteractionStart,
    onInteractionEnd,
    onExitStart,
    handoffExitToParent,
  });
  const enabledRef = useRef(enabled);
  const exitingRef = useRef(null);
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState(null);

  const updateOffsetX = useCallback((next) => {
    offsetXRef.current = next;
    setOffsetX(next);
  }, []);

  callbacksRef.current = {
    onSwipeLeft,
    onSwipeRight,
    onInteractionStart,
    onInteractionEnd,
    onExitStart,
    handoffExitToParent,
  };
  enabledRef.current = enabled;
  exitingRef.current = exiting;

  const releasePointerCapture = useCallback((tracking) => {
    if (!tracking) return;
    try {
      containerRef.current?.releasePointerCapture?.(tracking.pointerId);
    } catch {
      /* ignore if capture was not set */
    }
  }, []);

  const stopTracking = useCallback(() => {
    const container = containerRef.current;
    const { passiveMove, activeMove, up, cancel } = listenersRef.current;
    if (container && passiveMove) {
      container.removeEventListener('pointermove', passiveMove);
    }
    if (container && activeMove) {
      container.removeEventListener('pointermove', activeMove);
    }
    if (up) {
      window.removeEventListener('pointerup', up);
      container?.removeEventListener('pointerup', up);
    }
    if (cancel) {
      window.removeEventListener('pointercancel', cancel);
      container?.removeEventListener('pointercancel', cancel);
    }
    releasePointerCapture(trackingRef.current);
    trackingRef.current = null;
  }, [releasePointerCapture]);

  const resetGesture = useCallback(() => {
    trackingRef.current = null;
    setDragging(false);
  }, []);

  const finishSwipe = useCallback(
    (direction) => {
      const {
        onSwipeRight: swipeRight,
        onSwipeLeft: swipeLeft,
        onInteractionEnd: end,
        onExitStart: exitStart,
        handoffExitToParent: handoff,
      } = callbacksRef.current;

      setDragging(false);
      stopTracking();

      if (handoff) {
        exitStart?.({ direction, offsetX: offsetXRef.current });
        if (direction === 'right') swipeRight?.();
        else swipeLeft?.();
        updateOffsetX(0);
        setExiting(null);
        resetGesture();
        end?.();
        return;
      }

      const width = containerRef.current?.getBoundingClientRect?.().width || 320;
      const exitDistance = Math.max(width * 1.15, 280);
      setExiting(direction);
      updateOffsetX(direction === 'right' ? exitDistance : -exitDistance);

      window.setTimeout(() => {
        if (direction === 'right') swipeRight?.();
        else swipeLeft?.();
        setExiting(null);
        updateOffsetX(0);
        resetGesture();
        end?.();
      }, SWIPE_EXIT_MS);
    },
    [resetGesture, stopTracking, updateOffsetX]
  );

  useEffect(() => {
    const shouldDeferToScroll = (tracking, deltaX, deltaY) => {
      if (shouldPreferVerticalScroll(deltaX, deltaY, tracking.scrollEl)) return true;
      return shouldAbortForVerticalSwipe(deltaX, deltaY);
    };

    const upgradeToActiveSwipe = (event, tracking) => {
      const container = containerRef.current;
      const { passiveMove, activeMove } = listenersRef.current;
      if (!container || !passiveMove || !activeMove) return;

      tracking.committed = true;
      setDragging(true);
      container.removeEventListener('pointermove', passiveMove);
      container.addEventListener('pointermove', activeMove, { passive: false });
      try {
        container.setPointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onPassivePointerMove = (event) => {
      const tracking = trackingRef.current;
      if (!enabledRef.current || exitingRef.current || !tracking || tracking.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - tracking.startX;
      const deltaY = event.clientY - tracking.startY;

      if (shouldDeferToScroll(tracking, deltaX, deltaY)) {
        stopTracking();
        resetGesture();
        callbacksRef.current.onInteractionEnd?.();
        return;
      }
      if (!shouldCommitToHorizontalSwipe(deltaX, deltaY)) return;

      upgradeToActiveSwipe(event, tracking);
      updateOffsetX(deltaX);
    };

    const onActivePointerMove = (event) => {
      const tracking = trackingRef.current;
      if (!enabledRef.current || exitingRef.current || !tracking || tracking.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - tracking.startX;
      event.preventDefault();
      updateOffsetX(deltaX);
    };

    const onPointerUp = (event) => {
      const tracking = trackingRef.current;
      if (!enabledRef.current || !tracking || tracking.pointerId !== event.pointerId) return;

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

      updateOffsetX(0);
      resetGesture();
      callbacksRef.current.onInteractionEnd?.();
    };

    const onPointerCancel = (event) => {
      const tracking = trackingRef.current;
      if (!tracking || tracking.pointerId !== event.pointerId) return;
      stopTracking();
      updateOffsetX(0);
      resetGesture();
      callbacksRef.current.onInteractionEnd?.();
    };

    listenersRef.current = {
      passiveMove: onPassivePointerMove,
      activeMove: onActivePointerMove,
      up: onPointerUp,
      cancel: onPointerCancel,
    };

    return () => stopTracking();
  }, [finishSwipe, resetGesture, stopTracking, updateOffsetX]);

  const handlePointerDown = useCallback(
    (event) => {
      if (!enabledRef.current || exitingRef.current || trackingRef.current) return;
      if (event.button != null && event.button !== 0) return;
      if (event.target?.closest?.(INTERACTIVE_SELECTOR)) return;

      const container = containerRef.current;
      const { passiveMove, up, cancel } = listenersRef.current;
      if (!container || !passiveMove || !up || !cancel) return;

      const scrollEl = event.target?.closest?.(ROLE_EVAL_SCROLL_SELECTOR) || null;

      trackingRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        committed: false,
        scrollEl,
      };
      callbacksRef.current.onInteractionStart?.();

      container.addEventListener('pointermove', passiveMove, { passive: true });
      container.addEventListener('pointerup', up);
      container.addEventListener('pointercancel', cancel);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    []
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
};
