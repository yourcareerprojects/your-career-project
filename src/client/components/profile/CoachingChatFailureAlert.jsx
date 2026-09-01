import React from 'react';
import { Alert, Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Error banner for coaching chat failures with retry + manual-entry fallback.
 */
export default function CoachingChatFailureAlert({
  error,
  onDismiss,
  onRetry,
  onEnterManually,
  loading = false,
}) {
  const { t } = useTranslation('onboarding');
  if (!error) return null;

  return (
    <Alert
      severity="error"
      sx={{ mb: 2 }}
      onClose={loading ? undefined : onDismiss}
    >
      {error}
      <Box sx={{ mt: 1.25, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {typeof onRetry === 'function' ? (
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={onRetry}
            disabled={loading}
          >
            {t('profilePage.actions.retry')}
          </Button>
        ) : null}
        {typeof onEnterManually === 'function' ? (
          <Button
            size="small"
            variant="contained"
            color="inherit"
            onClick={onEnterManually}
            disabled={loading}
          >
            {t('coachingFallback.enterManually')}
          </Button>
        ) : null}
      </Box>
    </Alert>
  );
}
