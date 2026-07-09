import React from 'react';
import { Box, Typography } from '@mui/material';

export const PAGE_TITLE_SX = { mb: 3, fontWeight: 700, textAlign: 'center' };
export const PAGE_DESCRIPTION_SX = { mb: 4, textAlign: 'center' };

/**
 * Standard page title and description — matches Saved Simulations list pages.
 */
const PageHeader = ({ title, description, sx, titleSx, descriptionSx }) => {
  const hasDescription = description != null && description !== '';

  return (
    <Box sx={{ display: 'contents', ...sx }}>
      {title != null && title !== '' && (
        <Typography
          variant="h4"
          component="h1"
          sx={{
            ...PAGE_TITLE_SX,
            mb: hasDescription ? PAGE_TITLE_SX.mb : PAGE_DESCRIPTION_SX.mb,
            ...titleSx,
          }}
        >
          {title}
        </Typography>
      )}
      {hasDescription && (
        <Typography variant="body1" sx={{ ...PAGE_DESCRIPTION_SX, ...descriptionSx }}>
          {description}
        </Typography>
      )}
    </Box>
  );
};

export default PageHeader;
