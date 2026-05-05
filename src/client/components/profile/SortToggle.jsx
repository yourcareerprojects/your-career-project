import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { CalendarToday as CalendarIcon, DragIndicator as DragIcon } from '@mui/icons-material';

const SortToggle = ({ 
  sortOrder, 
  onToggle, 
  disabled = false,
  size = 'medium'
}) => {
  const isChronological = sortOrder === 'chronological';
  
  return (
    <Tooltip 
      title={
        isChronological 
          ? "Switch to manual order" 
          : "Switch to chronological order"
      }
    >
      <IconButton
        onClick={onToggle}
        disabled={disabled}
        color={isChronological ? 'primary' : 'default'}
        size={size}
      >
        {isChronological ? <CalendarIcon /> : <DragIcon />}
      </IconButton>
    </Tooltip>
  );
};

export default SortToggle;

