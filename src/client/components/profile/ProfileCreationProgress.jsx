import React from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';

export const PROFILE_CREATION_STEP_COUNT = 5;

/**
 * Segmented progress for the 5-step profile creation wizard (upload + review steps).
 * @param {{ currentStep: number, sx?: object }} props — currentStep is 1-based (1–5)
 */
const ProfileCreationProgress = ({ currentStep, sx }) => {
  const { t } = useTranslation('onboarding');
  const step = Math.min(
    Math.max(1, Number(currentStep) || 1),
    PROFILE_CREATION_STEP_COUNT
  );

  return (
    <Box
      sx={sx}
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={PROFILE_CREATION_STEP_COUNT}
      aria-valuenow={step}
      aria-label={t('documentUpload.review.progress.ariaLabel', {
        current: step,
        total: PROFILE_CREATION_STEP_COUNT,
      })}
    >
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        {Array.from({ length: PROFILE_CREATION_STEP_COUNT }, (_, i) => i + 1).map((n) => (
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
