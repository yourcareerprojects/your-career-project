import React from 'react';
import { Box } from '@mui/material';

/** Vertical connector between spine pieces. */
export default function PuzzleConnector() {
  return (
    <Box
      aria-hidden
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 0.5,
        width: '100%',
      }}
    >
      <Box
        sx={{
          width: 3,
          height: 18,
          borderRadius: 2,
          bgcolor: 'divider',
          background: (theme) =>
            `linear-gradient(180deg, ${theme.palette.divider}, ${theme.palette.primary.light})`,
        }}
      />
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: '2px solid',
          borderColor: 'primary.main',
          bgcolor: 'background.paper',
          my: 0.25,
        }}
      />
      <Box
        sx={{
          width: 3,
          height: 18,
          borderRadius: 2,
          bgcolor: 'divider',
          background: (theme) =>
            `linear-gradient(180deg, ${theme.palette.primary.light}, ${theme.palette.divider})`,
        }}
      />
    </Box>
  );
}
