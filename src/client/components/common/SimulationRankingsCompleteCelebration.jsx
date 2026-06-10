import React, { useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  Portal,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

const AUTO_DISMISS_MS = 6500;

const sceneKeyframes = {
  '@keyframes rankingsBackdropIn': {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  '@keyframes rankingsRocketFly1': {
    '0%': { opacity: 0, transform: 'translate(0, 110vh) rotate(42deg)' },
    '8%': { opacity: 1 },
    '100%': { opacity: 0, transform: 'translate(18vw, -115vh) rotate(42deg)' },
  },
  '@keyframes rankingsRocketFly2': {
    '0%': { opacity: 0, transform: 'translate(0, 110vh) rotate(52deg)' },
    '8%': { opacity: 1 },
    '100%': { opacity: 0, transform: 'translate(-14vw, -120vh) rotate(52deg)' },
  },
  '@keyframes rankingsRocketFly3': {
    '0%': { opacity: 0, transform: 'translate(0, 110vh) rotate(38deg)' },
    '8%': { opacity: 1 },
    '100%': { opacity: 0, transform: 'translate(8vw, -118vh) rotate(38deg)' },
  },
  '@keyframes rankingsRocketFly4': {
    '0%': { opacity: 0, transform: 'translate(0, 110vh) rotate(48deg)' },
    '8%': { opacity: 1 },
    '100%': { opacity: 0, transform: 'translate(-22vw, -112vh) rotate(48deg)' },
  },
  '@keyframes rankingsFlameFlicker': {
    '0%, 100%': { transform: 'scaleY(1)', opacity: 0.95 },
    '50%': { transform: 'scaleY(1.35)', opacity: 1 },
  },
  '@keyframes rankingsFlowerBloom': {
    '0%': { opacity: 0, transform: 'scale(0) rotate(-24deg)' },
    '55%': { opacity: 1, transform: 'scale(1.12) rotate(6deg)' },
    '100%': { opacity: 1, transform: 'scale(1) rotate(0deg)' },
  },
  '@keyframes rankingsPetalDrift': {
    '0%': { opacity: 0, transform: 'translateY(0) rotate(0deg)' },
    '15%': { opacity: 0.9 },
    '100%': { opacity: 0, transform: 'translateY(42vh) rotate(220deg)' },
  },
  '@keyframes rankingsSparkle': {
    '0%, 100%': { opacity: 0, transform: 'scale(0.4)' },
    '50%': { opacity: 1, transform: 'scale(1)' },
  },
  '@keyframes rankingsMessageIn': {
    from: { opacity: 0, transform: 'translateY(20px) scale(0.96)' },
    to: { opacity: 1, transform: 'translateY(0) scale(1)' },
  },
};

const ROCKETS = [
  { left: '6%', delay: '0s', duration: '2.5s', fly: 'rankingsRocketFly1' },
  { left: '28%', delay: '0.45s', duration: '2.7s', fly: 'rankingsRocketFly2' },
  { left: '52%', delay: '0.2s', duration: '2.4s', fly: 'rankingsRocketFly3' },
  { left: '78%', delay: '0.65s', duration: '2.8s', fly: 'rankingsRocketFly4' },
];

const FLOWERS = [
  { left: '10%', bottom: '14%', delay: '0.15s', color: '#f48fb1', size: 72 },
  { left: '82%', bottom: '18%', delay: '0.35s', color: '#ffca28', size: 64 },
  { left: '4%', top: '22%', delay: '0.5s', color: '#ce93d8', size: 56 },
  { left: '88%', top: '26%', delay: '0.25s', color: '#81c784', size: 60 },
];

const PETALS = [
  { left: '18%', delay: '0.6s', color: '#f8bbd0' },
  { left: '34%', delay: '1.1s', color: '#ffe082' },
  { left: '61%', delay: '0.85s', color: '#e1bee7' },
  { left: '74%', delay: '1.4s', color: '#ffab91' },
  { left: '48%', delay: '1.7s', color: '#c5e1a5' },
];

const SPARKLES = [
  { left: '15%', top: '30%', delay: '0s' },
  { left: '42%', top: '18%', delay: '0.4s' },
  { left: '68%', top: '24%', delay: '0.8s' },
  { left: '85%', top: '38%', delay: '1.2s' },
  { left: '25%', top: '55%', delay: '1.5s' },
  { left: '58%', top: '48%', delay: '0.6s' },
];

function Rocket({ left, delay, duration, fly }) {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        left,
        bottom: '-12%',
        width: 28,
        height: 56,
        opacity: 0,
        transformOrigin: '50% 85%',
        animation: `${fly} ${duration} cubic-bezier(0.22, 0.61, 0.36, 1) ${delay} forwards`,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          bottom: 0,
          width: 14,
          height: 18,
          ml: '-7px',
          borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
          background: 'linear-gradient(180deg, #ff9800 0%, #f44336 100%)',
          animation: 'rankingsFlameFlicker 0.18s ease-in-out infinite',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          bottom: 14,
          width: 22,
          height: 34,
          ml: '-11px',
          borderRadius: '4px 4px 2px 2px',
          background: 'linear-gradient(180deg, #e3f2fd 0%, #64b5f6 55%, #1976d2 100%)',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          bottom: 44,
          width: 0,
          height: 0,
          ml: '-11px',
          borderLeft: '11px solid transparent',
          borderRight: '11px solid transparent',
          borderBottom: '16px solid #ef5350',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          bottom: 22,
          width: 8,
          height: 8,
          ml: '-4px',
          borderRadius: '50%',
          bgcolor: 'rgba(255,255,255,0.85)',
        }}
      />
    </Box>
  );
}

function Flower({ left, bottom, top, delay, color, size }) {
  const petals = useMemo(() => Array.from({ length: 6 }, (_, i) => i * 60), []);

  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        left,
        ...(bottom != null ? { bottom } : {}),
        ...(top != null ? { top } : {}),
        width: size,
        height: size,
        opacity: 0,
        animation: `rankingsFlowerBloom 900ms cubic-bezier(0.34, 1.45, 0.64, 1) ${delay} forwards`,
        pointerEvents: 'none',
      }}
    >
      {petals.map((angle) => (
        <Box
          key={angle}
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: size * 0.34,
            height: size * 0.52,
            ml: `${-size * 0.17}px`,
            mt: `${-size * 0.42}px`,
            borderRadius: '50% 50% 50% 0',
            bgcolor: color,
            transformOrigin: '50% 90%',
            transform: `rotate(${angle}deg)`,
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.06)',
          }}
        />
      ))}
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: size * 0.28,
          height: size * 0.28,
          ml: `${-size * 0.14}px`,
          mt: `${-size * 0.14}px`,
          borderRadius: '50%',
          bgcolor: '#fff8e1',
          border: '2px solid #ffcc80',
        }}
      />
    </Box>
  );
}

function CelebrationScene() {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        ...sceneKeyframes,
      }}
    >
      {ROCKETS.map((rocket) => (
        <Rocket key={`${rocket.left}-${rocket.delay}`} {...rocket} />
      ))}

      {FLOWERS.map((flower) => (
        <Flower key={`${flower.left}-${flower.delay}`} {...flower} />
      ))}

      {PETALS.map((petal) => (
        <Box
          key={`${petal.left}-${petal.delay}`}
          sx={{
            position: 'absolute',
            top: '-4%',
            left: petal.left,
            width: 12,
            height: 16,
            borderRadius: '50% 50% 50% 0',
            bgcolor: petal.color,
            opacity: 0,
            animation: `rankingsPetalDrift 3.8s ease-in ${petal.delay} forwards`,
          }}
        />
      ))}

      {SPARKLES.map((spark) => (
        <Box
          key={`${spark.left}-${spark.top}`}
          sx={{
            position: 'absolute',
            left: spark.left,
            top: spark.top,
            width: 10,
            height: 10,
            opacity: 0,
            animation: `rankingsSparkle 1.4s ease-in-out ${spark.delay} infinite`,
            '&::before, &::after': {
              content: '""',
              position: 'absolute',
              bgcolor: '#fffde7',
              borderRadius: 1,
            },
            '&::before': {
              left: '50%',
              top: 0,
              width: 2,
              height: '100%',
              transform: 'translateX(-50%)',
            },
            '&::after': {
              top: '50%',
              left: 0,
              width: '100%',
              height: 2,
              transform: 'translateY(-50%)',
            },
          }}
        />
      ))}
    </Box>
  );
}

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
          overflow: 'hidden',
          background: motion
            ? 'linear-gradient(165deg, #1a237e 0%, #4a148c 42%, #880e4f 100%)'
            : 'rgba(15, 23, 42, 0.55)',
          ...(motion
            ? {
                ...sceneKeyframes,
                animation: 'rankingsBackdropIn 400ms ease-out',
              }
            : {}),
        }}
      >
        {motion ? <CelebrationScene /> : null}

        <Box
          onClick={(event) => event.stopPropagation()}
          sx={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            maxWidth: 480,
            textAlign: 'center',
            color: '#fff',
            px: { xs: 2, sm: 3 },
            ...(motion
              ? {
                  ...sceneKeyframes,
                  animation: 'rankingsMessageIn 700ms cubic-bezier(0.34, 1.25, 0.64, 1) 400ms both',
                }
              : {}),
          }}
        >
          <Typography
            id="simulation-rankings-complete-title"
            variant="h3"
            component="h2"
            sx={{
              fontWeight: 800,
              mb: 1.5,
              letterSpacing: '-0.02em',
              textShadow: '0 4px 24px rgba(0,0,0,0.35)',
              typography: { xs: 'h4', sm: 'h3' },
            }}
          >
            {t('simulation.rankingsComplete.title')}
          </Typography>

          <Typography
            id="simulation-rankings-complete-message"
            variant="h6"
            component="p"
            sx={{
              mb: 3,
              lineHeight: 1.55,
              fontWeight: 400,
              color: 'rgba(255,255,255,0.92)',
              textShadow: '0 2px 12px rgba(0,0,0,0.3)',
              typography: { xs: 'body1', sm: 'h6' },
            }}
          >
            {t('simulation.rankingsComplete.message')}
          </Typography>

          <Button
            variant="contained"
            size="large"
            onClick={onClose}
            sx={{
              fontWeight: 700,
              px: 4,
              py: 1.25,
              borderRadius: 999,
              bgcolor: '#fff',
              color: 'primary.dark',
              boxShadow: '0 8px 28px rgba(0,0,0,0.25)',
              '&:hover': {
                bgcolor: '#f5f5f5',
                boxShadow: '0 10px 32px rgba(0,0,0,0.3)',
              },
            }}
          >
            {t('simulation.rankingsComplete.continue')}
          </Button>
        </Box>
      </Box>
    </Portal>
  );
}
