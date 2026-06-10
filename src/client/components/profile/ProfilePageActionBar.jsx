import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Portal, useMediaQuery, useTheme } from '@mui/material';
import { useCtaNudgeAnimation } from '../../hooks/useCtaNudgeAnimation';

/** Matches Layout AppBar offset (`mt: '64px'`). */
const APP_BAR_HEIGHT_PX = 64;

/**
 * Profile CTA row with a compact fixed bar on mobile once the user scrolls past the originals.
 */
const ProfilePageActionBar = ({ actions, sx }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const sentinelRef = useRef(null);
  const [showCompactBar, setShowCompactBar] = useState(false);
  const hasNudgeAction = actions?.some((action) => action.nudge);
  const { nudgeInteractionHandlers, nudgeSx } = useCtaNudgeAnimation({ enabled: hasNudgeAction });

  useEffect(() => {
    if (!isMobile) {
      setShowCompactBar(false);
      return undefined;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowCompactBar(!entry.isIntersecting);
      },
      {
        root: null,
        threshold: 0,
        rootMargin: `-${APP_BAR_HEIGHT_PX}px 0px 0px 0px`,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isMobile, actions]);

  const renderButton = (action, compact) => (
    <Button
      key={`${action.key}-${compact ? 'compact' : 'full'}`}
      variant={action.variant}
      color={action.color || 'primary'}
      size={compact ? 'small' : 'medium'}
      startIcon={action.startIcon}
      href={action.href}
      onClick={action.onClick}
      disabled={action.disabled}
      aria-label={action.ariaLabel || action.label}
      {...(action.nudge ? nudgeInteractionHandlers : {})}
      sx={{
        fontWeight: 600,
        px: compact ? 1.25 : 3,
        py: compact ? 0.625 : 1.5,
        fontSize: compact ? '0.8125rem' : '1rem',
        lineHeight: compact ? 1.25 : undefined,
        width: compact ? undefined : { xs: '100%', sm: 'auto' },
        flex: compact ? '1 1 0' : undefined,
        minWidth: compact ? 0 : undefined,
        whiteSpace: compact ? 'nowrap' : undefined,
        overflow: compact ? 'hidden' : undefined,
        textOverflow: compact ? 'ellipsis' : undefined,
        '& .MuiButton-startIcon': compact ? { mr: 0.5, '& > *:nth-of-type(1)': { fontSize: 18 } } : undefined,
        ...(action.nudge ? nudgeSx : {}),
      }}
    >
      {compact ? action.shortLabel : action.label}
    </Button>
  );

  if (!actions?.length) return null;

  return (
    <>
      <Box
        ref={sentinelRef}
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'center',
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 2,
          mb: 4,
          width: '100%',
          maxWidth: 1200,
          mx: 'auto',
          ...sx,
        }}
      >
        {actions.map((action) => renderButton(action, false))}
      </Box>

      {isMobile && (
        <Portal>
          <Box
            role="region"
            aria-label={actions.map((a) => a.label).join(', ')}
            aria-hidden={!showCompactBar}
            sx={{
              position: 'fixed',
              top: APP_BAR_HEIGHT_PX,
              left: 0,
              right: 0,
              zIndex: theme.zIndex.appBar - 1,
              display: 'flex',
              gap: 1,
              px: 1.5,
              py: 0.75,
              bgcolor: 'background.paper',
              borderBottom: 1,
              borderColor: 'divider',
              boxShadow: showCompactBar ? theme.shadows[2] : 'none',
              transform: showCompactBar ? 'translateY(0)' : 'translateY(-110%)',
              opacity: showCompactBar ? 1 : 0,
              pointerEvents: showCompactBar ? 'auto' : 'none',
              transition: theme.transitions.create(['transform', 'opacity', 'box-shadow'], {
                duration: theme.transitions.duration.short,
                easing: theme.transitions.easing.easeInOut,
              }),
            }}
          >
            {actions.map((action) => renderButton(action, true))}
          </Box>
        </Portal>
      )}
    </>
  );
};

export default ProfilePageActionBar;
