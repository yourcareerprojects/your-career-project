import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box
} from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';

const ConfirmationDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  severity = 'warning',
  loading = false
}) => {
  const getSeverityColor = () => {
    switch (severity) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
      default:
        return 'warning';
    }
  };

  const getSeverityIcon = () => {
    switch (severity) {
      case 'error':
        return <WarningIcon color="error" />;
      case 'warning':
        return <WarningIcon color="warning" />;
      case 'info':
        return <WarningIcon color="info" />;
      default:
        return <WarningIcon color="warning" />;
    }
  };

  const handleConfirmClick = () => {
    if (onConfirm && typeof onConfirm === 'function') {
      onConfirm();
    } else {
      console.error('onConfirm is not a function:', onConfirm);
    }
  };

  const handleCancelClick = () => {
    if (onClose && typeof onClose === 'function') {
      onClose();
    } else {
      console.error('onClose is not a function:', onClose);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="confirmation-dialog-title"
      aria-describedby="confirmation-dialog-description"
    >
      <DialogTitle id="confirmation-dialog-title">
        <Box display="flex" alignItems="center" gap={1}>
          {getSeverityIcon()}
          {title}
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Typography id="confirmation-dialog-description">
          {message}
        </Typography>
      </DialogContent>
      
      <DialogActions>
        <Button 
          onClick={handleCancelClick} 
          disabled={loading}
          variant="outlined"
        >
          {cancelText}
        </Button>
        <Button 
          onClick={handleConfirmClick} 
          disabled={loading}
          variant="contained" 
          color={getSeverityColor()}
          autoFocus
        >
          {loading ? 'Processing...' : confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmationDialog;
