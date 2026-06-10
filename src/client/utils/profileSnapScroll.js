import { profileSectionScrollMarginSx } from './profileSectionScroll';

export const PROFILE_SNAP_ATTR = 'data-profile-snap';
export const PROFILE_MOBILE_SNAP_CLASS = 'profile-mobile-scroll-snap';

/** Fixed header + mobile profile action bar (px). */
export const PROFILE_SCROLL_PADDING_TOP_PX = 120;

/** Duration of the swipe transition between profile sub-sections (ms). */
export const PROFILE_SNAP_ANIMATION_MS = 300;

function easeOutCubic(progress) {
  return 1 - (1 - progress) ** 3;
}

/**
 * Smoothly scroll the window to `top` over a short fixed duration.
 * @returns {() => void} cancel function
 */
export function animateProfileScrollTo(top, {
  durationMs = PROFILE_SNAP_ANIMATION_MS,
  onComplete,
} = {}) {
  const startY = window.scrollY;
  const targetY = Math.max(0, top);
  const distance = targetY - startY;

  if (Math.abs(distance) < 2) {
    onComplete?.();
    return () => {};
  }

  const startTime = performance.now();
  let frameId = null;

  const step = (now) => {
    const progress = Math.min((now - startTime) / durationMs, 1);
    window.scrollTo(0, startY + distance * easeOutCubic(progress));
    if (progress < 1) {
      frameId = requestAnimationFrame(step);
    } else {
      onComplete?.();
    }
  };

  frameId = requestAnimationFrame(step);

  return () => {
    if (frameId != null) {
      cancelAnimationFrame(frameId);
    }
  };
}

let profileScrollLockUntil = 0;

/** Suppress stepped-scroll snapping while programmatic section scroll runs. */
export function lockProfileSteppedScroll(ms = 650) {
  profileScrollLockUntil = Date.now() + ms;
}

export function isProfileSteppedScrollLocked() {
  return Date.now() < profileScrollLockUntil;
}

/** Applied to active snap targets while mobile stepped scroll is enabled. */
export const profileSnapTargetSxActive = {
  ...profileSectionScrollMarginSx,
};

/**
 * First subcategory in each group is not a snap stop; later items are.
 * @param {number} index — zero-based subcategory index within its parent category
 */
export function isProfileSubcategorySnap(index) {
  return index > 0;
}
