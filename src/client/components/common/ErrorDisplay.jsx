import React from 'react';
import {
  Alert,
  Box,
  Button,
  Typography,
  Collapse
} from '@mui/material';
import { Refresh as RefreshIcon, Close as CloseIcon } from '@mui/icons-material';

const ErrorDisplay = ({ error, onRetry, onDismiss, sx = {} }) => {
  if (!error) return null;

  const getSeverityFromErrorType = (errorType) => {
    switch (errorType) {
      case 'network':
        return 'warning';
      case 'validation':
        return 'error';
      case 'authorization':
        return 'error';
      case 'not_found':
        return 'info';
      case 'server':
        return 'error';
      case 'timeout':
        return 'warning';
      default:
        return 'error';
    }
  };

  const getRetryButtonText = (errorType, retryCount) => {
    if (errorType === 'network') {
      return retryCount > 0 ? `Retry (${retryCount}/3)` : 'Retry';
    }
    return 'Retry';
  };

  const shouldShowRetry = (errorType) => {
    return ['network', 'timeout', 'server'].includes(errorType);
  };

  return (
    <Collapse in={!!error}>
      <Alert 
        severity={getSeverityFromErrorType(error.type)}
        sx={{
          mb: 2,
          ...sx
        }}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            {shouldShowRetry(error.type) && onRetry && (
              <Button 
                onClick={onRetry} 
                size="small" 
                startIcon={<RefreshIcon />}
                disabled={error.retryCount >= 3}
              >
                {getRetryButtonText(error.type, error.retryCount)}
              </Button>
            )}
            {onDismiss && (
              <Button 
                onClick={onDismiss} 
                size="small" 
                startIcon={<CloseIcon />}
              >
                Dismiss
              </Button>
            )}
          </Box>
        }
      >
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {error.message}
        </Typography>
        
        {/* Show debug information in development */}
        {process.env.NODE_ENV === 'development' && error.details && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Debug: {error.details}
            </Typography>
            {error.context && Object.keys(error.context).length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Context: {JSON.stringify(error.context, null, 2)}
              </Typography>
            )}
          </Box>
        )}
        
        {/* Show retry count for network errors */}
        {error.type === 'network' && error.retryCount > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Attempt {error.retryCount} of 3
          </Typography>
        )}
      </Alert>
    </Collapse>
  );
};

export default ErrorDisplay;
