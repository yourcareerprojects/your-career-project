import React from 'react';
import { Box, Typography, Chip, Fade, Tooltip } from '@mui/material';
import { Edit as EditIcon, Warning as WarningIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

/**
 * Unsaved Changes Indicator Component
 * Shows visual indicators when there are unsaved changes
 * Can be used in headers, titles, or other UI elements
 */
const UnsavedChangesIndicator = ({
  hasChanges,
  variant = 'chip', // 'chip', 'text', 'icon', 'badge'
  position = 'inline', // 'inline', 'absolute', 'relative'
  color = 'warning',
  size = 'small',
  animation = true
}) => {
  const { t } = useTranslation('common');
  const label = t('app.unsavedChanges');

  // Don't render if no changes
  if (!hasChanges) {
    return null;
  }

  const getIndicatorContent = () => {
    switch (variant) {
      case 'chip':
        return (
          <Chip
            icon={<EditIcon />}
            label={label}
            color={color}
            size={size}
            variant="outlined"
          />
        );

      case 'text':
        return (
          <Typography
            variant="caption"
            color={`${color}.main`}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <EditIcon fontSize="small" />
            {label}
          </Typography>
        );

      case 'icon':
        return (
          <Tooltip title={label}>
            <EditIcon
              color={color}
              fontSize={size === 'small' ? 'small' : 'medium'}
            />
          </Tooltip>
        );

      case 'badge':
        return (
          <Tooltip title={label}>
            <Box
              sx={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5
              }}
            >
              <WarningIcon
                color={color}
                fontSize={size === 'small' ? 'small' : 'medium'}
              />
            </Box>
          </Tooltip>
        );

      default:
        return null;
    }
  };

  const getPositionStyles = () => {
    switch (position) {
      case 'absolute':
        return {
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 1
        };

      case 'relative':
        return {
          position: 'relative',
          display: 'inline-block'
        };

      case 'inline':
      default:
        return {
          display: 'inline-flex',
          alignItems: 'center'
        };
    }
  };

  const indicatorContent = getIndicatorContent();

  if (animation) {
    return (
      <Fade in={hasChanges} timeout={300}>
        <Box sx={getPositionStyles()}>
          {indicatorContent}
        </Box>
      </Fade>
    );
  }

  return (
    <Box sx={getPositionStyles()}>
      {indicatorContent}
    </Box>
  );
};

export default UnsavedChangesIndicator;
