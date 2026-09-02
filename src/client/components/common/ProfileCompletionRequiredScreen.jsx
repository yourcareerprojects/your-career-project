import React from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from './PageHeader';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../../constants/profileCompletion';
import { useProfileCompletionQuery } from '../../hooks/useProfileQueries';

/**
 * Hook for pages that gate content on minimum profile completion.
 */
export function useProfileCompletionGate() {
  const completionQuery = useProfileCompletionQuery();
  const overall = Number(completionQuery.data?.completion?.overall || 0);
  const isLoading = completionQuery.isLoading;
  const belowMin = completionQuery.isSuccess && overall < MIN_PROFILE_COMPLETION_REQUIRED;
  return {
    isLoading,
    belowMin,
    overall,
    minRequired: MIN_PROFILE_COMPLETION_REQUIRED,
    isReady: !isLoading && !belowMin,
  };
}

/**
 * Incomplete-profile gate matching the `/simulation` empty-state layout:
 * page header → warning alert → Fill profile CTA.
 */
export default function ProfileCompletionRequiredScreen({
  pageTitle,
  pageSubtitle,
  gateTitle,
  gateDescription,
  ctaTo = '/profile/fill',
  ctaLabel,
}) {
  const { t } = useTranslation('onboarding');
  const { overall, minRequired } = useProfileCompletionGate();
  const descriptionText =
    typeof gateDescription === 'function'
      ? gateDescription({ current: overall, min: minRequired })
      : gateDescription;
  const resolvedCtaLabel = ctaLabel || t('profilePagePrompts.incomplete.cta');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <PageHeader title={pageTitle} description={pageSubtitle} />

      <Alert
        severity="warning"
        variant="outlined"
        sx={{
          mb: 3,
          maxWidth: 680,
          mx: 'auto',
          borderRadius: 3,
          px: 2,
          py: 1.5,
          borderWidth: 1.5,
          alignItems: 'center',
          backgroundColor: 'warning.50',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.25 }}>
          {gateTitle}
        </Typography>
        <Typography variant="body2">{descriptionText}</Typography>
      </Alert>

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'center',
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 2,
          mb: 4,
          flexWrap: 'wrap',
          width: '100%',
          maxWidth: { xs: 420, sm: 'none' },
          mx: 'auto',
          px: { xs: 0.5, sm: 0 },
          '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } },
        }}
      >
        <Button
          component={RouterLink}
          to={ctaTo}
          variant="contained"
          color="primary"
          size="medium"
          startIcon={<ArrowForwardIcon />}
          aria-label={resolvedCtaLabel}
          sx={{
            fontWeight: 600,
            px: 3,
            py: 1.5,
            fontSize: '1rem',
          }}
        >
          {resolvedCtaLabel}
        </Button>
      </Box>
    </Box>
  );
}

export function EmailVerificationRequiredScreen({
  pageTitle,
  pageSubtitle,
  gateTitle,
  gateDescription,
}) {
  const { t } = useTranslation('onboarding');
  return (
    <ProfileCompletionRequiredScreen
      pageTitle={pageTitle}
      pageSubtitle={pageSubtitle}
      gateTitle={gateTitle}
      gateDescription={gateDescription}
      ctaTo="/check-email"
      ctaLabel={t('profilePagePrompts.verifyEmail.cta')}
    />
  );
}

export function ProfileCompletionGateLoading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  );
}
