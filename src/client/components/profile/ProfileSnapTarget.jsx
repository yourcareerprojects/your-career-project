import React from 'react';
import { Box } from '@mui/material';
import { profileSnapTargetSx } from '../../utils/profileSnapScroll';

/**
 * Mobile scroll-snap anchor on the profile page (category or subcategory).
 */
const ProfileSnapTarget = ({ snap = true, children, sx, ...rest }) => (
  <Box
    sx={[
      snap ? profileSnapTargetSx : null,
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}
    {...rest}
  >
    {children}
  </Box>
);

export default ProfileSnapTarget;
