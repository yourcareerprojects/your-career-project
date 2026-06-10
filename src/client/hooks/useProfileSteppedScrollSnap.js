import { useEffect } from 'react';
import {
  PROFILE_SCROLL_PADDING_TOP_PX,
  PROFILE_SNAP_ATTR,
  PROFILE_SNAP_ANIMATION_MS,
  animateProfileScrollTo,
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

/**
 * Mobile stepped scrolling driven by swipe gestures:
 * swipe up → next sub-section, swipe down → previous sub-section.
 */
export function useProfileSteppedScrollSnap(active) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return undefined;
    }

    let isProgrammatic = false;
    let touchStartY = 0;
    let touchStartTime = 0;
    let touchStartIndex = 0;
    let cancelAnimation = null;

    const snapTo = (top) => {
      cancelAnimation?.();
      isProgrammatic = true;
      // Halt touch momentum before the slide animation starts.
      window.scrollTo(0, window.scrollY);

      cancelAnimation = animateProfileScrollTo(top, {
        durationMs: PROFILE_SNAP_ANIMATION_MS,
        onComplete: () => {
          isProgrammatic = false;
          cancelAnimation = null;
        },
      });
    };

    const onTouchStart = (event) => {
      if (isProgrammatic || isProfileSteppedScrollLocked()) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;

      touchStartY = touch.clientY;
      touchStartTime = Date.now();
      const tops = getSnapTops();
      touchStartIndex = findNearestIndex(window.scrollY, tops);
    };

    const onTouchEnd = (event) => {
      if (isProgrammatic || isProfileSteppedScrollLocked()) {
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

      const targetTop = tops[targetIndex];
      if (Math.abs(window.scrollY - targetTop) > 2) {
        snapTo(targetTop);
      }
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
    };
  }, [active]);
}
