import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Alert,
} from '@mui/material';
import ProfileCreationProgress from '../profile/ProfileCreationProgress';

/**
 * Full-screen step panel styled like the profile creation review dialog.
 */
export default function SimulationWizardDialog({
  open,
  currentStep,
  totalSteps,
  title,
  children,
  error = '',
  onDismissError,
  actions = null,
}) {
  return (
    <Dialog
      open={open}
      keepMounted={false}
      onClose={(event, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
          return;
        }
      }}
      maxWidth="md"
      fullWidth
      scroll="paper"
      sx={{
        '& .MuiDialog-paper': {
          display: 'flex',
          flexDirection: 'column',
          maxHeight: { xs: '92dvh', sm: 'calc(100% - 64px)' },
          m: { xs: 1, sm: 2 },
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, flexShrink: 0 }}>
        <ProfileCreationProgress
          currentStep={currentStep}
          totalSteps={totalSteps}
          sx={{ mb: 1.5 }}
        />
        {title}
      </DialogTitle>
      <DialogContent
        data-role-eval-scroll
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={onDismissError}>
            {error}
          </Alert>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1, pt: 0.5, pb: 0.5 }}>
          {children}
        </Box>
      </DialogContent>
      {actions ? (
        <DialogActions sx={{ flexShrink: 0 }}>
          {actions}
        </DialogActions>
      ) : null}
    </Dialog>
  );
}
