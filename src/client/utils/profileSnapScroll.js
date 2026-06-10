import { profileSectionScrollMarginSx } from './profileSectionScroll';

export const PROFILE_SNAP_ATTR = 'data-profile-snap';
export const PROFILE_MOBILE_SNAP_CLASS = 'profile-mobile-scroll-snap';

/** Fixed header + mobile profile action bar (px). */
export const PROFILE_SCROLL_PADDING_TOP_PX = 120;

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
  scrollSnapAlign: 'start',
  scrollSnapStop: 'always',
};

/**
 * First subcategory in each group is not a snap stop; later items are.
 * @param {number} index — zero-based subcategory index within its parent category
 */
export function isProfileSubcategorySnap(index) {
  return index > 0;
}
