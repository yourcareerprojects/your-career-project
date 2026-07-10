import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ROLE_EVAL_SCROLL_SELECTOR,
  SWIPE_ACTIVATION_PX,
  SWIPE_COMMIT_MIN_PX,
  SWIPE_EXIT_MS,
  resolvePassiveGestureIntent,
  resolveSwipeCommitDirection,
} from '../utils/roleEvaluationSwipeGestures';

export {
  SWIPE_ACTIVATION_PX,
  SWIPE_COMMIT_MIN_PX,
  SWIPE_COMMIT_RATIO,
  SWIPE_EXIT_MS,
  resolvePassiveGestureIntent,
  resolveSwipeCommitDirection,
  shouldAbortForVerticalSwipe,
  shouldCommitToHorizontalSwipe,
  shouldPreferVerticalScroll,
} from '../utils/roleEvaluationSwipeGestures';

const TOUCH_SWIPE_ACTIVATION_PX = 8;
const TOUCH_SWIPE_COMMIT_MIN_PX = 48;
const TOUCH_SWIPE_COMMIT_RATIO = 0.22;

function isCoarsePointer() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

function getSwipeActivationPx() {
  return isCoarsePointer() ? TOUCH_SWIPE_ACTIVATION_PX : SWIPE_ACTIVATION_PX;
}

function getSwipeCommitMinPx() {
  return isCoarsePointer() ? TOUCH_SWIPE_COMMIT_MIN_PX : SWIPE_COMMIT_MIN_PX;
}

function getSwipeCommitRatio() {
  return isCoarsePointer() ? TOUCH_SWIPE_COMMIT_RATIO : undefined;
}

function setContainerTouchAction(container, value) {
  if (!container) return;
  container.style.touchAction = value;
}

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
    touchMove: null,
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
    const { passiveMove, activeMove, up, cancel, touchMove } = listenersRef.current;
    if (container && passiveMove) {
      container.removeEventListener('pointermove', passiveMove);
    }
    if (container && activeMove) {
      container.removeEventListener('pointermove', activeMove);
    }
    if (container && touchMove) {
      container.removeEventListener('touchmove', touchMove);
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
    setContainerTouchAction(container, '');
    trackingRef.current = null;
  }, [releasePointerCapture]);

  const resetGesture = useCallback(() => {
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
        end?.();
      }, SWIPE_EXIT_MS);
    },
    [stopTracking, updateOffsetX]
  );

  useEffect(() => {
    const resolveIntent = (tracking, deltaX, deltaY) =>
      resolvePassiveGestureIntent(deltaX, deltaY, {
        scrollEl: tracking.scrollEl,
        activationPx: tracking.activationPx,
        preferTouch: tracking.preferTouch,
      });

    const upgradeToActiveSwipe = (event, tracking) => {
      const container = containerRef.current;
      const { passiveMove, activeMove } = listenersRef.current;
      if (!container || !passiveMove || !activeMove || tracking.committed) return;

      tracking.committed = true;
      setDragging(true);
      setContainerTouchAction(container, 'none');
      container.removeEventListener('pointermove', passiveMove);
      container.addEventListener('pointermove', activeMove, { passive: false });
      try {
        container.setPointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    const processGestureSample = (event, tracking, clientX, clientY) => {
      const deltaX = clientX - tracking.startX;
      const deltaY = clientY - tracking.startY;
      const intent = resolveIntent(tracking, deltaX, deltaY);

      if (intent === 'pending') return;

      if (intent === 'vertical') {
        if (!tracking.preferTouch) {
          stopTracking();
          resetGesture();
          callbacksRef.current.onInteractionEnd?.();
        }
        return;
      }

      upgradeToActiveSwipe(event, tracking);
      updateOffsetX(deltaX);
    };

    const onPassivePointerMove = (event) => {
      const tracking = trackingRef.current;
      if (!enabledRef.current || exitingRef.current || !tracking || tracking.pointerId !== event.pointerId) {
        return;
      }

      processGestureSample(event, tracking, event.clientX, event.clientY);
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

    const onTouchMove = (event) => {
      const tracking = trackingRef.current;
      if (!enabledRef.current || exitingRef.current || !tracking) return;

      const touch = Array.from(event.touches).find((t) => t.identifier === tracking.pointerId);
      if (!touch) return;

      if (tracking.committed) {
        event.preventDefault();
        updateOffsetX(touch.clientX - tracking.startX);
        return;
      }

      const intent = resolveIntent(
        tracking,
        touch.clientX - tracking.startX,
        touch.clientY - tracking.startY
      );
      if (intent === 'horizontal') {
        event.preventDefault();
        processGestureSample(event, tracking, touch.clientX, touch.clientY);
      }
    };

    const finishFromRelease = (event, clientX) => {
      const tracking = trackingRef.current;
      if (!enabledRef.current || !tracking) return;

      const deltaX = tracking.committed ? clientX - tracking.startX : 0;
      const width = containerRef.current?.getBoundingClientRect?.().width || 320;
      const commitRatio = tracking.commitRatio;
      const direction = tracking.committed
        ? resolveSwipeCommitDirection(deltaX, width, tracking.commitMinPx, commitRatio)
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

    const onPointerUp = (event) => {
      const tracking = trackingRef.current;
      if (!tracking || tracking.pointerId !== event.pointerId) return;
      finishFromRelease(event, event.clientX);
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
      touchMove: onTouchMove,
    };

    return () => stopTracking();
  }, [finishSwipe, resetGesture, stopTracking, updateOffsetX]);

  const handlePointerDown = useCallback(
    (event) => {
      if (!enabledRef.current || exitingRef.current || trackingRef.current) return;
      if (event.button != null && event.button !== 0) return;
      if (event.target?.closest?.(INTERACTIVE_SELECTOR)) return;

      const container = containerRef.current;
      const { passiveMove, up, cancel, touchMove } = listenersRef.current;
      if (!container || !passiveMove || !up || !cancel || !touchMove) return;

      const scrollEl = event.target?.closest?.(ROLE_EVAL_SCROLL_SELECTOR) || null;
      const preferTouch = isCoarsePointer();

      trackingRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        committed: false,
        scrollEl,
        activationPx: getSwipeActivationPx(),
        preferTouch,
        commitMinPx: getSwipeCommitMinPx(),
        commitRatio: getSwipeCommitRatio(),
      };
      callbacksRef.current.onInteractionStart?.();

      container.addEventListener('pointermove', passiveMove, { passive: true });
      container.addEventListener('pointerup', up);
      container.addEventListener('pointercancel', cancel);
      container.addEventListener('touchmove', touchMove, { passive: false });
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
