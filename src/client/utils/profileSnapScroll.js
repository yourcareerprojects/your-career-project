import { profileSectionScrollMarginSx } from './profileSectionScroll';

export const PROFILE_MOBILE_SNAP_CLASS = 'profile-mobile-scroll-snap';

/** Snap target styles — mobile only; desktop keeps normal scrolling. */
export const profileSnapTargetSx = {
  ...profileSectionScrollMarginSx,
  scrollSnapAlign: { xs: 'start', sm: 'none' },
  scrollSnapStop: { xs: 'always', sm: 'normal' },
};

/**
 * First subcategory in each group is not a snap stop; later items are.
 * @param {number} index — zero-based subcategory index within its parent category
 */
export function isProfileSubcategorySnap(index) {
  return index > 0;
}
