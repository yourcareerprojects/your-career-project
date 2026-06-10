import React, { useEffect } from 'react';
import {
  Box,
  Button,
  Paper,
  Portal,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useTranslation } from 'react-i18next';

const AUTO_DISMISS_MS = 5000;

const celebrationKeyframes = {
  '@keyframes rankingsCelebrationBackdropIn': {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  '@keyframes rankingsCelebrationCardIn': {
    '0%': { opacity: 0, transform: 'scale(0.9) translateY(16px)' },
    '70%': { opacity: 1, transform: 'scale(1.02) translateY(0)' },
    '100%': { opacity: 1, transform: 'scale(1) translateY(0)' },
  },
  '@keyframes rankingsCelebrationIconIn': {
    '0%': { opacity: 0, transform: 'scale(0.4) rotate(-12deg)' },
    '60%': { opacity: 1, transform: 'scale(1.08) rotate(4deg)' },
    '100%': { opacity: 1, transform: 'scale(1) rotate(0deg)' },
  },
  '@keyframes rankingsCelebrationGlow': {
    '0%, 100%': { boxShadow: '0 0 0 0 rgba(46, 125, 50, 0.28)' },
    '50%': { boxShadow: '0 0 0 18px rgba(46, 125, 50, 0)' },
  },
  '@keyframes rankingsCelebrationTextIn': {
    from: { opacity: 0, transform: 'translateY(8px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
};

/**
 * Congratulatory overlay when both simulation role rankings are complete (not confetti).
 */
export default function SimulationRankingsCompleteCelebration({ open, onClose }) {
  const { t } = useTranslation('dashboard');
  const theme = useTheme();
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    if (!open) return undefined;
    if (prefersReducedMotion) return undefined;
    const timer = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [open, onClose, prefersReducedMotion]);

  if (!open) return null;

  const motion = !prefersReducedMotion;

  return (
    <Portal>
      <Box
        role="dialog"
        aria-modal="true"
        aria-labelledby="simulation-rankings-complete-title"
        aria-describedby="simulation-rankings-complete-message"
        onClick={onClose}
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: theme.zIndex.modal + 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
          py: 3,
          bgcolor: 'rgba(15, 23, 42, 0.45)',
          ...(motion
            ? {
                ...celebrationKeyframes,
                animation: 'rankingsCelebrationBackdropIn 280ms ease-out',
              }
            : {}),
        }}
      >
        <Paper
          elevation={8}
          onClick={(event) => event.stopPropagation()}
          sx={{
            width: '100%',
            maxWidth: 440,
            borderRadius: 3,
            p: { xs: 3, sm: 4 },
            textAlign: 'center',
            border: '1px solid',
            borderColor: 'success.light',
            ...(motion
              ? {
                  ...celebrationKeyframes,
                  animation: 'rankingsCelebrationCardIn 520ms cubic-bezier(0.34, 1.4, 0.64, 1)',
                }
              : {}),
          }}
        >
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 88,
              height: 88,
              mb: 2.5,
              borderRadius: '50%',
              bgcolor: 'success.light',
              color: 'success.dark',
              ...(motion
                ? {
                    ...celebrationKeyframes,
                    animation:
                      'rankingsCelebrationIconIn 560ms cubic-bezier(0.34, 1.45, 0.64, 1) 120ms both, rankingsCelebrationGlow 1.8s ease-out 680ms 2',
                  }
                : {}),
            }}
          >
            <CheckCircleOutlineIcon sx={{ fontSize: 52 }} />
          </Box>

          <Typography
            id="simulation-rankings-complete-title"
            variant="h5"
            component="h2"
            sx={{
              fontWeight: 700,
              mb: 1.5,
              ...(motion
                ? {
                    animation: 'rankingsCelebrationTextIn 420ms ease-out 220ms both',
                  }
                : {}),
            }}
          >
            {t('simulation.rankingsComplete.title')}
          </Typography>

          <Typography
            id="simulation-rankings-complete-message"
            variant="body1"
            color="text.secondary"
            sx={{
              mb: 3,
              lineHeight: 1.55,
              ...(motion
                ? {
                    animation: 'rankingsCelebrationTextIn 420ms ease-out 320ms both',
                  }
                : {}),
            }}
          >
            {t('simulation.rankingsComplete.message')}
          </Typography>

          <Button
            variant="contained"
            color="success"
            size="large"
            onClick={onClose}
            sx={{
              fontWeight: 600,
              px: 4,
              ...(motion
                ? {
                    animation: 'rankingsCelebrationTextIn 420ms ease-out 420ms both',
                  }
                : {}),
            }}
          >
            {t('simulation.rankingsComplete.continue')}
          </Button>
        </Paper>
      </Box>
    </Portal>
  );
}
