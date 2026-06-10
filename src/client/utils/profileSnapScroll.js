import { profileSectionScrollMarginSx } from './profileSectionScroll';

export const PROFILE_SNAP_ATTR = 'data-profile-snap';
export const PROFILE_MOBILE_SNAP_CLASS = 'profile-mobile-scroll-snap';

/** Fixed header + mobile profile action bar (px). */
export const PROFILE_SCROLL_PADDING_TOP_PX = 120;

/** Default duration of the swipe transition between profile sub-sections (ms). */
export const PROFILE_SNAP_ANIMATION_MS = 260;

function easeInOutCubic(progress) {
  return progress < 0.5
    ? 4 * progress ** 3
    : 1 - ((-2 * progress + 2) ** 3) / 2;
}

/**
 * Duration scales with travel distance and finger velocity so fast swipes feel snappy.
 */
export function computeProfileSnapDuration(distancePx, velocityPxMs = 0) {
  const byDistance = Math.min(300, Math.max(200, Math.abs(distancePx) * 0.4));
  const velocityShortening = Math.min(90, Math.abs(velocityPxMs) * 70);
  return Math.max(180, byDistance - velocityShortening);
}

/**
 * Smoothly scroll the window to `top` over a short eased duration.
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
  let cancelled = false;

  const step = (now) => {
    if (cancelled) {
      return;
    }
    const progress = Math.min((now - startTime) / durationMs, 1);
    window.scrollTo(0, startY + distance * easeInOutCubic(progress));
    if (progress < 1) {
      frameId = requestAnimationFrame(step);
    } else {
      window.scrollTo(0, targetY);
      onComplete?.();
    }
  };

  frameId = requestAnimationFrame(step);

  return () => {
    cancelled = true;
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
