import React, { useEffect, useState } from 'react';
import { Button, useMediaQuery } from '@mui/material';
import { ArrowForward as ArrowForwardIcon } from '@mui/icons-material';
import { useIdleNudge } from '../../hooks/useIdleNudge';

const NUDGE_DURATION_MS = 580;

const HomeGetStartedButton = ({ children, onClick, ...buttonProps }) => {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const nudgeEnabled = !prefersReducedMotion;
  const { nudgeCount, pause, resume } = useIdleNudge({ enabled: nudgeEnabled });
  const [isNudging, setIsNudging] = useState(false);

  useEffect(() => {
    if (!nudgeEnabled || nudgeCount === 0) {
      return undefined;
    }
    setIsNudging(true);
    const timer = setTimeout(() => setIsNudging(false), NUDGE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [nudgeCount, nudgeEnabled]);

  return (
    <Button
      variant="contained"
      color="primary"
      size="medium"
      startIcon={<ArrowForwardIcon />}
      onClick={onClick}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      sx={{
        fontWeight: 600,
        px: 3,
        py: 1.5,
        fontSize: '1rem',
        width: { xs: '100%', sm: 'auto' },
        maxWidth: '100%',
        willChange: 'transform',
        '@keyframes homeCtaNudge': {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '28%': { transform: 'translateY(-8px) scale(1.02)' },
          '52%': { transform: 'translateY(2px) scale(1)' },
          '76%': { transform: 'translateY(-4px) scale(1.01)' },
        },
        ...(isNudging
          ? {
              animation: `homeCtaNudge ${NUDGE_DURATION_MS}ms cubic-bezier(0.34, 1.45, 0.64, 1)`,
            }
          : {}),
      }}
      {...buttonProps}
    >
      {children}
    </Button>
  );
};

export default HomeGetStartedButton;
