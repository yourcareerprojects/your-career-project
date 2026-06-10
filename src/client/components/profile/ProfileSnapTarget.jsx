import React from 'react';
import { Box } from '@mui/material';
import { useProfileMobileSnapActive } from '../../contexts/ProfileMobileSnapContext';
import { PROFILE_SNAP_ATTR, profileSnapTargetSxActive } from '../../utils/profileSnapScroll';

/**
 * Mobile scroll-snap anchor on the profile page (category or subcategory).
 */
const ProfileSnapTarget = ({ snap = true, children, sx, ...rest }) => {
  const mobileSnapActive = useProfileMobileSnapActive();
  const shouldSnap = Boolean(snap && mobileSnapActive);

  return (
    <Box
      {...{ [PROFILE_SNAP_ATTR]: shouldSnap ? 'true' : undefined }}
      sx={[
        shouldSnap ? profileSnapTargetSxActive : null,
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      {...rest}
    >
      {children}
    </Box>
  );
};

export default ProfileSnapTarget;
