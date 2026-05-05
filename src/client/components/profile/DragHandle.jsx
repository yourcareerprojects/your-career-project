import React from 'react';
import { Box } from '@mui/material';
import { DragIndicator as DragIcon } from '@mui/icons-material';

const DragHandle = ({ 
  isVisible = true,
  size = 'small',
  color = 'action'
}) => {
  if (!isVisible) return null;
  
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        opacity: 0.6,
        transition: 'opacity 0.2s ease',
        '&:hover': {
          opacity: 1,
        },
        '&:active': {
          cursor: 'grabbing',
        }
      }}
    >
      <DragIcon 
        fontSize={size} 
        color={color}
        sx={{
          color: 'text.secondary'
        }}
      />
    </Box>
  );
};

export default DragHandle;

