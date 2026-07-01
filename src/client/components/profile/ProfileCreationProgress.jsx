import React from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';

export const PROFILE_CREATION_STEP_COUNT = 5;

/**
 * Segmented progress for the profile creation wizard (upload + review steps).
 * @param {{ currentStep: number, totalSteps?: number, sx?: object }} props — currentStep is 1-based
 */
const ProfileCreationProgress = ({ currentStep, totalSteps = PROFILE_CREATION_STEP_COUNT, sx }) => {
  const { t } = useTranslation('onboarding');
  const maxStep = Math.max(1, Number(totalSteps) || PROFILE_CREATION_STEP_COUNT);
  const step = Math.min(
    Math.max(1, Number(currentStep) || 1),
    maxStep
  );

  return (
    <Box
      sx={sx}
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={maxStep}
      aria-valuenow={step}
      aria-label={t('documentUpload.review.progress.ariaLabel', {
        current: step,
        total: maxStep,
      })}
    >
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        {Array.from({ length: maxStep }, (_, i) => i + 1).map((n) => (
          <Box
            key={n}
            sx={{
              flex: 1,
              height: 6,
              borderRadius: 1,
              bgcolor: n <= step ? 'primary.main' : 'action.selected',
              transition: 'background-color 0.2s ease',
            }}
          />
        ))}
      </Box>
    </Box>
  );
};

export default ProfileCreationProgress;
