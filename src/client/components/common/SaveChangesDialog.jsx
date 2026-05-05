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
  Chip,
  CircularProgress
} from '@mui/material';
import { Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';

/**
 * Save Changes Confirmation Dialog
 * Shows a confirmation dialog before saving changes to a simulation
 * Displays a summary of changes that will be saved
 */
const SaveChangesDialog = ({
  open,
  onClose,
  onConfirm,
  loading = false,
  changeSummary = null,
  simulationName = 'Simulation'
}) => {
  const handleConfirm = () => {
    onConfirm();
  };

  const handleCancel = () => {
    if (!loading) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown={loading}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <SaveIcon color="primary" />
          <Typography variant="h6">
            Save Changes to {simulationName}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Typography variant="body1" paragraph>
          Are you sure you want to save the following changes to this simulation?
        </Typography>

        {changeSummary && changeSummary.hasChanges && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Changes to be saved:
            </Typography>
            <List dense>
              {changeSummary.changes.map((change, index) => (
                <ListItem key={index} sx={{ py: 0.5 }}>
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2">
                          {change.category}
                        </Typography>
                        {change.type === 'count_change' && (
                          <Chip
                            label={`${change.original} → ${change.current}`}
                            size="small"
                            color={change.difference > 0 ? 'success' : 'warning'}
                            variant="outlined"
                          />
                        )}
                        {change.type === 'text_change' && (
                          <Chip
                            label="Modified"
                            size="small"
                            color="info"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      change.type === 'text_change' && (
                        <Typography variant="caption" color="text.secondary">
                          "{change.original}" → "{change.current}"
                        </Typography>
                      )
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {loading && (
          <Box display="flex" alignItems="center" gap={2} mt={2}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Saving changes...
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={handleCancel}
          disabled={loading}
          startIcon={<CancelIcon />}
          color="inherit"
        >
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          color="primary"
          variant="contained"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SaveChangesDialog;
