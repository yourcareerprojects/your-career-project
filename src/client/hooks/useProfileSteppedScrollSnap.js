import { useEffect } from 'react';
import {
  PROFILE_SCROLL_PADDING_TOP_PX,
  PROFILE_SNAP_ATTR,
  animateProfileScrollTo,
  computeProfileSnapDuration,
  isProfileSteppedScrollLocked,
} from '../utils/profileSnapScroll';

/** Minimum finger travel (px) to count as a deliberate swipe. */
const SWIPE_DISTANCE_PX = 32;
/** Quick flick can count with less distance when velocity is high (px/ms). */
const FLICK_VELOCITY_PX_MS = 0.35;
const FLICK_DISTANCE_PX = 12;

function getSnapTops() {
  const selector = `[${PROFILE_SNAP_ATTR}="true"]`;
  const padding = PROFILE_SCROLL_PADDING_TOP_PX;
  return Array.from(document.querySelectorAll(selector))
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return Math.max(0, window.scrollY + rect.top - padding);
    })
    .sort((a, b) => a - b);
}

function findNearestIndex(scrollY, tops) {
  if (!tops.length) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < tops.length; i += 1) {
    const dist = Math.abs(tops[i] - scrollY);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function haltScrollMomentum() {
  const y = window.scrollY;
  window.scrollTo(0, y);
}

/**
 * Mobile stepped scrolling driven by swipe gestures:
 * swipe up → next sub-section, swipe down → previous sub-section.
 */
export function useProfileSteppedScrollSnap(active) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return undefined;
    }

    let touchStartY = 0;
    let touchStartTime = 0;
    let touchStartIndex = 0;
    /** Logical snap index (stable while animating so fast chained swipes work). */
    let activeSnapIndex = null;
    let cancelAnimation = null;

    const snapToTop = (top, velocityPxMs = 0) => {
      cancelAnimation?.();

      haltScrollMomentum();

      const beginAnimation = () => {
        const fromY = window.scrollY;
        const durationMs = computeProfileSnapDuration(top - fromY, velocityPxMs);

        cancelAnimation = animateProfileScrollTo(top, {
          durationMs,
          onComplete: () => {
            cancelAnimation = null;
          },
        });
      };

      // Two frames after halting momentum so the slide starts from a stable position.
      requestAnimationFrame(() => {
        haltScrollMomentum();
        requestAnimationFrame(beginAnimation);
      });
    };

    const snapToIndex = (index, tops, velocityPxMs = 0) => {
      if (!tops.length) return;
      const clamped = Math.max(0, Math.min(index, tops.length - 1));
      activeSnapIndex = clamped;
      const targetTop = tops[clamped];
      if (Math.abs(window.scrollY - targetTop) > 2) {
        snapToTop(targetTop, velocityPxMs);
      }
    };

    const onTouchStart = (event) => {
      if (isProfileSteppedScrollLocked()) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;

      touchStartY = touch.clientY;
      touchStartTime = Date.now();
      const tops = getSnapTops();
      touchStartIndex = activeSnapIndex ?? findNearestIndex(window.scrollY, tops);
    };

    const onTouchEnd = (event) => {
      if (isProfileSteppedScrollLocked()) {
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) return;

      const tops = getSnapTops();
      if (!tops.length) return;

      const fingerDelta = touchStartY - touch.clientY;
      const elapsedMs = Math.max(Date.now() - touchStartTime, 1);
      const velocity = fingerDelta / elapsedMs;

      const isSwipeUp =
        fingerDelta > SWIPE_DISTANCE_PX
        || (fingerDelta > FLICK_DISTANCE_PX && velocity > FLICK_VELOCITY_PX_MS);
      const isSwipeDown =
        fingerDelta < -SWIPE_DISTANCE_PX
        || (fingerDelta < -FLICK_DISTANCE_PX && velocity < -FLICK_VELOCITY_PX_MS);

      let targetIndex = touchStartIndex;
      if (isSwipeUp) {
        targetIndex = Math.min(touchStartIndex + 1, tops.length - 1);
      } else if (isSwipeDown) {
        targetIndex = Math.max(touchStartIndex - 1, 0);
      }

      snapToIndex(targetIndex, tops, velocity);
    };

    const onTouchCancel = () => {
      touchStartY = 0;
      touchStartTime = 0;
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
      cancelAnimation?.();
      activeSnapIndex = null;
    };
  }, [active]);
}
