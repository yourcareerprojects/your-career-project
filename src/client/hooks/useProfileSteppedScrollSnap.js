import { useEffect } from 'react';
import {
  PROFILE_SCROLL_PADDING_TOP_PX,
  PROFILE_SNAP_ATTR,
  isProfileSteppedScrollLocked,
} from '../utils/profileSnapScroll';

const SETTLE_MS = 130;
const ALIGN_THRESHOLD_PX = 16;
const GESTURE_MIN_DELTA_PX = 28;

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

function findCurrentIndex(scrollY, tops) {
  let idx = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (scrollY + ALIGN_THRESHOLD_PX >= tops[i]) {
      idx = i;
    }
  }
  return idx;
}

/**
 * Mobile stepped scrolling: after each gesture, land on the next/previous snap point.
 * Uses touch + scroll settle (works when CSS scroll-snap on document is unavailable).
 */
export function useProfileSteppedScrollSnap(active) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return undefined;
    }

    let settleTimer = null;
    let isProgrammatic = false;
    let gestureStartScrollY = window.scrollY;

    const snapTo = (top) => {
      isProgrammatic = true;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      window.setTimeout(() => {
        isProgrammatic = false;
        gestureStartScrollY = window.scrollY;
      }, 480);
    };

    const settleScroll = () => {
      if (isProgrammatic || isProfileSteppedScrollLocked()) {
        return;
      }

      const tops = getSnapTops();
      if (!tops.length) {
        return;
      }

      const endY = window.scrollY;
      const delta = endY - gestureStartScrollY;
      const currentIdx = findCurrentIndex(endY, tops);
      const aligned = Math.abs(endY - tops[currentIdx]) <= ALIGN_THRESHOLD_PX;

      if (Math.abs(delta) < GESTURE_MIN_DELTA_PX) {
        if (!aligned) {
          snapTo(tops[currentIdx]);
        }
        return;
      }

      const nextIdx = delta > 0
        ? Math.min(currentIdx + 1, tops.length - 1)
        : Math.max(currentIdx - 1, 0);

      if (nextIdx !== currentIdx || !aligned) {
        snapTo(tops[nextIdx]);
      }
    };

    const onTouchStart = () => {
      if (!isProgrammatic) {
        gestureStartScrollY = window.scrollY;
      }
    };

    const onScroll = () => {
      if (isProgrammatic) {
        return;
      }
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settleScroll, SETTLE_MS);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(settleTimer);
    };
  }, [active]);
}
