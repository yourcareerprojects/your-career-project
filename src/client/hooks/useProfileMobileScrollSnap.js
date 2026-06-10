import { useEffect } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import {
  PROFILE_MOBILE_SNAP_CLASS,
  PROFILE_SCROLL_PADDING_TOP_PX,
} from '../utils/profileSnapScroll';
import { useProfileSteppedScrollSnap } from './useProfileSteppedScrollSnap';

/**
 * Enables stepped vertical scrolling on the profile page (mobile, read-only view).
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
    const body = document.body;
    const previous = {
      htmlSnap: html.style.scrollSnapType,
      bodySnap: body.style.scrollSnapType,
      htmlPadding: html.style.scrollPaddingTop,
    };

    html.classList.add(PROFILE_MOBILE_SNAP_CLASS);
    html.style.scrollSnapType = 'y proximity';
    body.style.scrollSnapType = 'y proximity';
    html.style.scrollPaddingTop = `${PROFILE_SCROLL_PADDING_TOP_PX}px`;

    return () => {
      html.classList.remove(PROFILE_MOBILE_SNAP_CLASS);
      html.style.scrollSnapType = previous.htmlSnap;
      body.style.scrollSnapType = previous.bodySnap;
      html.style.scrollPaddingTop = previous.htmlPadding;
    };
  }, [active]);

  useProfileSteppedScrollSnap(active);

  return active;
}
