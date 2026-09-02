import React from 'react';
import { Box, Typography } from '@mui/material';

/** Shared green → red title gradient (viewport-centered, sharp mid blend). */
export const PAGE_TITLE_GRADIENT_SX = {
  background: (theme) =>
    `linear-gradient(120deg, ${theme.palette.primary.main} 42%, ${theme.palette.secondary.main} 58%)`,
  backgroundSize: '100vw 100%',
  backgroundPosition: 'center center',
  backgroundRepeat: 'no-repeat',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

/** Canonical page title — same size and top alignment on every screen. */
export const PAGE_TITLE_SX = {
  mt: 0,
  mb: 2,
  fontWeight: 700,
  textAlign: 'center',
  fontSize: { xs: '1.75rem', sm: '2.125rem' },
  lineHeight: 1.25,
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
  ...PAGE_TITLE_GRADIENT_SX,
};

export const PAGE_DESCRIPTION_SX = {
  mt: 0,
  mb: 4,
  textAlign: 'center',
  fontSize: { xs: '1rem', sm: '1.125rem' },
  lineHeight: 1.5,
  color: 'text.secondary',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
};

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
