import { useEffect } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import {
  PROFILE_MOBILE_SNAP_CLASS,
  PROFILE_SCROLL_PADDING_TOP_PX,
} from '../utils/profileSnapScroll';
import { useProfileSteppedScrollSnap } from './useProfileSteppedScrollSnap';

/**
 * Enables swipe-stepped scrolling on the profile page (mobile, read-only view).
 */
export function useProfileMobileScrollSnap(enabled = true) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const active = Boolean(enabled && isMobile && !prefersReducedMotion);

  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      return undefined;
    }

    const html = document.documentElement;
    const previousPadding = html.style.scrollPaddingTop;

    html.classList.add(PROFILE_MOBILE_SNAP_CLASS);
    html.style.scrollPaddingTop = `${PROFILE_SCROLL_PADDING_TOP_PX}px`;

    return () => {
      html.classList.remove(PROFILE_MOBILE_SNAP_CLASS);
      html.style.scrollPaddingTop = previousPadding;
    };
  }, [active]);

  useProfileSteppedScrollSnap(active);

  return active;
}
