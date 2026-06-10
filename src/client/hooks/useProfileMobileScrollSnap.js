import { useEffect } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import { PROFILE_MOBILE_SNAP_CLASS } from '../utils/profileSnapScroll';

/**
 * Enables stepped vertical scroll-snapping on the profile page (mobile, read-only view).
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
    document.documentElement.classList.add(PROFILE_MOBILE_SNAP_CLASS);
    return () => {
      document.documentElement.classList.remove(PROFILE_MOBILE_SNAP_CLASS);
    };
  }, [active]);

  return active;
}
