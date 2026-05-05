import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  CircularProgress,
  Divider,
  Alert
} from '@mui/material';
import {
  Warning as WarningIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  ExitToApp as LeaveIcon,
  Edit as EditIcon
} from '@mui/icons-material';

/**
 * Navigation Confirmation Dialog
 * Shows when user tries to navigate away from a page with unsaved changes
 * Provides options to save, discard, or leave with changes
 */
const NavigationConfirmationDialog = ({
  open,
  title = 'Unsaved Changes Detected',
  message = 'You have unsaved changes. Are you sure you want to leave?',
  confirmText = 'Leave Anyway',
  cancelText = 'Stay on Page',
  saveText = 'Save Changes',
  showSaveOption = false,
  changeSummary = null,
  loading = false,
  onConfirm,
  onCancel,
  onSave
}) => {
  const handleConfirm = () => {
    if (onConfirm && !loading) {
      onConfirm();
    }
  };

  const handleCancel = () => {
    if (onCancel && !loading) {
      onCancel();
    }
  };

  const handleSave = () => {
    if (onSave && !loading) {
      onSave();
    }
  };

  const renderChangeSummary = () => {
    if (!changeSummary || !changeSummary.hasChanges) {
      return null;
    }

    const { changes, totalChanges } = changeSummary;

    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          Changes that will be lost:
        </Typography>
        
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2">
            {totalChanges} change{totalChanges !== 1 ? 's' : ''} will be lost if you leave this page.
          </Typography>
        </Alert>

        {changes && changes.length > 0 && (
          <List dense sx={{ bgcolor: 'background.paper', borderRadius: 1, p: 1 }}>
            {changes.map((change, index) => (
              <React.Fragment key={index}>
                <ListItem sx={{ px: 1, py: 0.5 }}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <EditIcon fontSize="small" color="warning" />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {change.category}
                        </Typography>
                        {change.type === 'count_change' && (
                          <Chip
                            label={`${change.original} → ${change.current}`}
                            size="small"
                            color="warning"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      change.type === 'count_change' 
                        ? `${change.difference > 0 ? 'Added' : 'Removed'} ${Math.abs(change.difference)} item${Math.abs(change.difference) !== 1 ? 's' : ''}`
                        : change.type === 'text_change'
                        ? `Changed from "${change.original}" to "${change.current}"`
                        : 'Modified'
                    }
                  />
                </ListItem>
                {index < changes.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        )}
      </Box>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown={loading}
      PaperProps={{
        sx: {
          borderRadius: 2,
          boxShadow: 'var(--shadow-dialog)'
        }
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <WarningIcon color="warning" />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Typography variant="body1" paragraph>
          {message}
        </Typography>

        {renderChangeSummary()}
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, width: '100%', justifyContent: 'flex-end' }}>
          <Button
            onClick={handleCancel}
            disabled={loading}
            startIcon={<CancelIcon />}
            variant="outlined"
            sx={{ minWidth: 120 }}
          >
            {cancelText}
          </Button>
          
          {showSaveOption && (
            <Button
              onClick={handleSave}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
              variant="contained"
              color="primary"
              sx={{ minWidth: 120 }}
            >
              {loading ? 'Saving...' : saveText}
            </Button>
          )}
          
          <Button
            onClick={handleConfirm}
            disabled={loading}
            startIcon={<LeaveIcon />}
            variant="contained"
            color="error"
            sx={{ minWidth: 120 }}
          >
            {confirmText}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default NavigationConfirmationDialog;
