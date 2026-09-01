import React, { useId } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { confidenceLabel } from './identityVisuals';

const RING_SIZE = 92;
const STROKE_WIDTH = 7;

function arcGradientPoints(clamped, center, radius) {
  const fillDeg = clamped >= 100 ? 359.99 : (clamped / 100) * 360;
  const endAngleRad = ((fillDeg - 90) * Math.PI) / 180;

  return {
    x1: center,
    y1: center - radius,
    x2: center + radius * Math.cos(endAngleRad),
    y2: center + radius * Math.sin(endAngleRad),
  };
}

function ConfidenceRing({ percent }) {
  const theme = useTheme();
  const green = theme.palette.primary.main;
  const red = theme.palette.secondary.main;
  const gradientId = useId().replace(/:/g, '');
  const center = RING_SIZE / 2;
  const radius = (RING_SIZE - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;
  const gradientPoints =
    clamped > 0 ? arcGradientPoints(clamped, center, radius) : null;

  return (
    <Box
      sx={{
        position: 'relative',
        width: RING_SIZE,
        height: RING_SIZE,
        flexShrink: 0,
      }}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden
      >
        {gradientPoints ? (
          <defs>
            <linearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              x1={gradientPoints.x1}
              y1={gradientPoints.y1}
              x2={gradientPoints.x2}
              y2={gradientPoints.y2}
            >
              <stop offset="0%" stopColor={red} />
              <stop offset="100%" stopColor={green} />
            </linearGradient>
          </defs>
        ) : null}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={theme.palette.divider}
          strokeWidth={STROKE_WIDTH}
        />
        {clamped > 0 ? (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        ) : null}
      </svg>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography
          variant="h5"
          fontWeight={800}
          sx={{ letterSpacing: '-0.04em', lineHeight: 1 }}
        >
          {clamped}
          <Typography
            component="span"
            variant="body2"
            fontWeight={700}
            color="text.secondary"
            sx={{ ml: 0.15 }}
          >
            %
          </Typography>
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Trait confidence score — ring gauge with brand red-to-green gradient.
 */
export default function IdentityConfidenceScore({ trait }) {
  const { t } = useTranslation('dashboard');
  const percent = trait?.confidencePercent ?? 0;
  const label = confidenceLabel(percent, t);

  return (
    <Box
      sx={{
        mt: 2.5,
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
      }}
    >
      <ConfidenceRing percent={percent} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.3 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
}
