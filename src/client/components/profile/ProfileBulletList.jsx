import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * Read-only bullet list for coaching / manual identity answers.
 */
export default function ProfileBulletList({ items = [], emptyLabel }) {
  const cleaned = (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  if (cleaned.length === 0) {
    return (
      <Typography variant="body1" color="text.disabled" sx={{ fontStyle: 'italic' }}>
        {emptyLabel}
      </Typography>
    );
  }

  if (cleaned.length === 1) {
    return (
      <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
        {cleaned[0]}
      </Typography>
    );
  }

  return (
    <Box component="ul" sx={{ pl: 2, m: 0, listStylePosition: 'outside' }}>
      {cleaned.map((item, idx) => (
        <Typography
          key={idx}
          component="li"
          variant="body1"
          color="text.primary"
          sx={{ mb: idx < cleaned.length - 1 ? 0.5 : 0, lineHeight: 1.45 }}
        >
          {item}
        </Typography>
      ))}
    </Box>
  );
}
