import React from 'react';
import { Box } from '@mui/material';

/** Legacy wrapper kept to avoid touching many profile sections. */
const ProfileSnapTarget = ({ children, sx, ...rest }) => {
  return (
    <Box
      sx={sx}
      {...rest}
    >
      {children}
    </Box>
  );
};

export default ProfileSnapTarget;
