import React from 'react';
import { Button, CircularProgress, Tooltip } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';

/**
 * Save Changes Button Component
 * Displays a button for saving changes to existing simulations
 * Only shows when changes are detected and provides visual feedback
 */
const SaveChangesButton = ({
  hasChanges,
  loading,
  onSave,
  disabled = false,
  variant = 'contained',
  size = 'medium',
  tooltip = null
}) => {
  // Don't render if no changes detected
  if (!hasChanges && !loading) {
    return null;
  }

  const buttonText = loading ? 'Saving...' : 'Save Changes';

  const defaultTooltip = hasChanges
    ? 'Save your changes to this simulation'
    : 'No changes to save';

  const buttonElement = (
    <Button
      variant={variant}
      size={size}
      color="primary"
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
      onClick={onSave}
      disabled={disabled || loading || !hasChanges}
      sx={{
        minWidth: '140px',
        ...(hasChanges && !loading && {
          backgroundColor: 'primary.main',
          '&:hover': {
            backgroundColor: 'primary.dark',
          }
        }),
        ...(loading && {
          backgroundColor: 'action.disabled',
        })
      }}
    >
      {buttonText}
    </Button>
  );

  // Wrap with tooltip if provided or if we have a default tooltip
  if (tooltip !== false) {
    return (
      <Tooltip 
        title={tooltip || defaultTooltip}
        placement="top"
        arrow
      >
        <span>{buttonElement}</span>
      </Tooltip>
    );
  }

  return buttonElement;
};

export default SaveChangesButton;
