import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Grid,
  LinearProgress,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import RouteIcon from '@mui/icons-material/Route';
import ThumbUpAltOutlinedIcon from '@mui/icons-material/ThumbUpAltOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  getEvaluationVisibleSlotCount,
  countEvaluatedRoles,
  isEvaluationComplete,
} from '../../utils/simulationRoleRanking';
import {
  buildCombinedRankingSeenRolesKey,
  getCombinedRankingRowId,
  trackCombinedRankingRolesForVisit,
} from '../../utils/combinedRankingRoleAccent';
import { getCareerStepMatchScorePercent } from '../../utils/careerStepMatchScore';
import { getRoleTitleForLocale, getRoleTitleEnglishForMatch } from '../../utils/roleTitleDisplay';
import { storeSimulationResultDetails } from '../../utils/simulationResultSessionStore';
import RoleEvaluationActionButtons from './RoleEvaluationActionButtons';
import localizedContentService from '../../utils/localizedContentService';
import { CareerStepRoleInlineBody } from './CareerStepRoleSections';
import { useEvalActionNudge } from '../../hooks/useEvalActionNudge';
import { useCtaNudgeAnimation } from '../../hooks/useCtaNudgeAnimation';
import { useSwipePanelExpansion } from '../../hooks/useSwipePanelExpansion';
import {
  SWIPE_EXIT_MS,
  useRoleEvaluationSwipe,
} from '../../hooks/useRoleEvaluationSwipe';

/** Matches `Layout` main `mt` so the card sticky header sits below the fixed app bar. */
const LAYOUT_APP_BAR_HEIGHT_PX = 64;

/** Top accent border on role evaluation cards (category color). */
const CARD_ACCENT_TOP_BORDER_PX = 3;

/** Swipe direction labels overlap the card just below the sticky header. */
const SWIPE_CUE_OVERLAP_BELOW_HEADER_PX = 10;
const SWIPE_CUE_FALLBACK_TOP_PX = 118;
/** Show direction labels earlier than the gesture commit threshold. */
const SWIPE_CUE_ACTIVATION_PX = 6;
/** Distance over which cue opacity/scale reach full strength. */
const SWIPE_CUE_RAMP_PX = 36;

const SWIPE_CUE_TYPOGRAPHY_SX = {
  fontWeight: 900,
  fontSize: { xs: '1.85rem', sm: '2.35rem', md: '2.85rem' },
  lineHeight: 1.15,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  display: 'inline-block',
};

const swipeCueLabelBackdropSx = (theme, accentColor) => ({
  px: { xs: 1, sm: 1.25 },
  py: { xs: 0.35, sm: 0.5 },
  borderRadius: 1.25,
  bgcolor:
    theme.palette.mode === 'dark'
      ? 'rgba(18, 18, 18, 0.72)'
      : 'rgba(255, 255, 255, 0.92)',
  boxShadow:
    theme.palette.mode === 'dark'
      ? `0 2px 14px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.08)`
      : `0 2px 14px rgba(0, 0, 0, 0.12), inset 0 0 0 1px ${accentColor}22`,
});

const swipeCueTextShadowSx = (theme) =>
  theme.palette.mode === 'dark'
    ? '0 1px 2px rgba(0, 0, 0, 0.85)'
    : '0 1px 2px rgba(255, 255, 255, 0.95)';

const rankedRowActionSx = (theme) => ({
  minWidth: { xs: 0, md: '96px !important' },
  width: { xs: '100%', md: 'auto' },
  px: '12px !important',
  py: '6px !important',
  fontSize: '0.8rem !important',
  lineHeight: '1.1 !important',
  borderRadius: '10px !important',
  whiteSpace: { xs: 'normal !important', md: 'nowrap !important' },
  boxShadow: 'none !important',
  textAlign: 'center',
  [theme.breakpoints.up('md')]: {
    textAlign: 'initial',
  },
});

/** Outside-the-box: More / Save use headline red (`tokens.css` --color-ootb-*). */
const OOTB_ACTION_BUTTON_SX = {
  bgcolor: 'var(--color-ootb-action)',
  color: 'var(--color-ootb-action-contrast)',
  '&:hover': { bgcolor: 'var(--color-ootb-action-hover)' },
};

const CARD_ENTER_MS = 360;
/** Softer ease — decelerate into place so the card feels like it settles from behind. */
const CARD_ENTER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Start slightly smaller/dimmer so the next role reads as coming from behind the deck. */
const CARD_ENTER_FROM_TRANSFORM = 'translate3d(0, 0, 0) scale(0.9)';
const CARD_ENTER_TO_TRANSFORM = 'translate3d(0, 0, 0) scale(1)';
const CARD_ENTER_FROM_OPACITY = 0;

/** Animates a swiped-away card off-screen while the next card appears underneath. */
function RoleEvaluationExitShell({
  direction,
  startOffsetX,
  children,
  swipeStageRef = null,
  expandSwipeToPanel = false,
  cardHeight,
}) {
  const theme = useTheme();
  const shellRef = useRef(null);
  const measureRef = useRef(null);
  const [offsetX, setOffsetX] = useState(startOffsetX);

  const panelFrame = useSwipePanelExpansion({
    active: expandSwipeToPanel,
    stageRef: swipeStageRef,
    measureRef,
  });

  const setShellRef = useCallback((node) => {
    shellRef.current = node;
    measureRef.current = node;
  }, []);

  useLayoutEffect(() => {
    const width = panelFrame?.width || shellRef.current?.getBoundingClientRect?.().width || 320;
    const exitDistance = Math.max(width * 1.15, 280);
    const finalOffset = direction === 'right' ? exitDistance : -exitDistance;
    const frame = requestAnimationFrame(() => setOffsetX(finalOffset));
    return () => cancelAnimationFrame(frame);
  }, [direction, startOffsetX, panelFrame?.width]);

  const shellSx = {
    pointerEvents: 'none',
    transform: `translateX(${offsetX}px)`,
    transition: `transform ${SWIPE_EXIT_MS}ms ease-in`,
    overflow: 'visible',
    display: 'flex',
    flexDirection: 'column',
  };

  if (panelFrame) {
    return (
      <>
        {(panelFrame.height || cardHeight) ? (
          <Box
            aria-hidden
            sx={{ height: panelFrame.height || cardHeight, pointerEvents: 'none' }}
          />
        ) : null}
        <Box
          ref={setShellRef}
          sx={{
            ...shellSx,
            position: 'fixed',
            top: `${panelFrame.top}px`,
            left: `${panelFrame.left}px`,
            width: `${panelFrame.width}px`,
            minHeight: panelFrame.height || cardHeight,
            zIndex: theme.zIndex.modal - 1,
          }}
        >
          {children}
        </Box>
      </>
    );
  }

  return (
    <Box
      ref={setShellRef}
      sx={{
        ...shellSx,
        position: 'absolute',
        inset: 0,
        zIndex: 3,
        height: '100%',
      }}
    >
      {children}
    </Box>
  );
}

export function RoleEvaluationCard({
  role,
  categoryKey,
  isViewingSavedSimulation,
  savedSimulationId,
  onEvaluate,
  guardedNavigate,
  showEvalNudge = false,
  getButtonNudgeSx,
  nudgeInteractionHandlers,
  inlineDetails = false,
  stickyTop = LAYOUT_APP_BAR_HEIGHT_PX,
  simulationIdForCards = null,
  onSwipeExitStart,
  swipeHandoffToParent = false,
  skipEnterAnimation = false,
  swipeStageRef = null,
  expandSwipeToPanel = false,
}) {
  const navigate = useNavigate();
  const theme = useTheme();
  const { t, i18n } = useTranslation('dashboard');
  const uiLang = i18n.resolvedLanguage || i18n.language || 'en';
  const roleTitle = getRoleTitleForLocale(role.title, uiLang);
  const roleDescription = localizedContentService.getLocalizedWithFallback(role.description, uiLang, '');
  const pct = getCareerStepMatchScorePercent(role);
  const simulationScopeId = simulationIdForCards || role?.simulationId || 'local';

  const nudgeSx = (buttonKey) => (
    showEvalNudge && typeof getButtonNudgeSx === 'function' ? getButtonNudgeSx(buttonKey) : {}
  );
  const nudgeHandlers = showEvalNudge ? nudgeInteractionHandlers : {};
  const accentColor =
    categoryKey === 'nextSteps' ? 'var(--color-primary)' : 'var(--color-ootb-action)';

  const handleMore = () => {
    const stepId = role.stepId || role.id || getRoleTitleEnglishForMatch(role.title);
    try {
      sessionStorage.setItem('currentStepDetails', JSON.stringify(role));
      storeSimulationResultDetails(role, [stepId]);
    } catch {
      /* ignore */
    }
    const path =
      isViewingSavedSimulation && savedSimulationId
        ? `/saved-simulation/${savedSimulationId}/career-step/${encodeURIComponent(stepId)}`
        : `/simulation/result/${encodeURIComponent(stepId)}`;
    const navigateFunction = guardedNavigate || navigate;
    navigateFunction(path);
  };

  const useStickyCardLayout = inlineDetails;
  const enableSwipe = typeof onEvaluate === 'function';
  /** 'from' → mount pose (no transition); 'to' → animate forward; 'done' → idle. */
  const [enterPhase, setEnterPhase] = useState(
    skipEnterAnimation || !enableSwipe ? 'done' : 'from'
  );
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const cardRef = useRef(null);
  const swipeCueAnchorRef = useRef(null);
  const measureRef = useRef(null);
  const [swipeCueTopPx, setSwipeCueTopPx] = useState(SWIPE_CUE_FALLBACK_TOP_PX);

  const evaluationButtonProps = {
    role,
    onEvaluate,
    showEvalNudge,
    getButtonNudgeSx,
    nudgeInteractionHandlers: nudgeHandlers,
  };

  const swipe = useRoleEvaluationSwipe({
    enabled: enableSwipe,
    handoffExitToParent: swipeHandoffToParent,
    onExitStart: (payload) => {
      onSwipeExitStart?.({
        ...payload,
        cardHeight: measureRef.current?.offsetHeight,
      });
    },
    onSwipeLeft: () => onEvaluate(role.id, 'dislike'),
    onSwipeRight: () => onEvaluate(role.id, 'keep'),
    onInteractionStart: nudgeHandlers.onMouseEnter,
    onInteractionEnd: nudgeHandlers.onMouseLeave,
  });

  useLayoutEffect(() => {
    if (skipEnterAnimation || !enableSwipe || prefersReducedMotion) {
      setEnterPhase('done');
      return undefined;
    }
    setEnterPhase('from');
    let raf1 = 0;
    let raf2 = 0;
    let settleTimer = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setEnterPhase('to');
        settleTimer = window.setTimeout(() => setEnterPhase('done'), CARD_ENTER_MS);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(settleTimer);
    };
  }, [role.id, enableSwipe, skipEnterAnimation, prefersReducedMotion]);

  useLayoutEffect(() => {
    if (!enableSwipe) return undefined;

    const updateSwipeCueTop = () => {
      const cardEl = cardRef.current;
      const anchorEl = swipeCueAnchorRef.current;
      if (!cardEl || !anchorEl) return;

      const cardTop = cardEl.getBoundingClientRect().top;
      const anchorBottom = anchorEl.getBoundingClientRect().bottom;
      setSwipeCueTopPx(anchorBottom - cardTop - SWIPE_CUE_OVERLAP_BELOW_HEADER_PX);
    };

    updateSwipeCueTop();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateSwipeCueTop)
      : null;

    if (observer) {
      if (cardRef.current) observer.observe(cardRef.current);
      if (swipeCueAnchorRef.current) observer.observe(swipeCueAnchorRef.current);
    }

    window.addEventListener('resize', updateSwipeCueTop);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateSwipeCueTop);
    };
  }, [enableSwipe, role.id, useStickyCardLayout, roleTitle]);

  const isEntering = enableSwipe && enterPhase !== 'done';
  const isSwipeDragOrExit = enableSwipe && (swipe.dragging || Boolean(swipe.exiting));
  const isSwipeMotionActive = isEntering || isSwipeDragOrExit;

  const isSwipeExpanded = expandSwipeToPanel && enableSwipe && (
    swipe.dragging
    || swipe.exiting
    || Math.abs(swipe.offsetX) > SWIPE_CUE_ACTIVATION_PX
  );

  const panelFrame = useSwipePanelExpansion({
    active: isSwipeExpanded,
    stageRef: swipeStageRef,
    measureRef,
  });

  const setSwipeContainerRef = useCallback((node) => {
    swipe.containerRef.current = node;
    measureRef.current = node;
  }, [swipe.containerRef]);

  const cardTransform = (() => {
    if (!enableSwipe) return 'none';
    if (enterPhase === 'from') return CARD_ENTER_FROM_TRANSFORM;
    if (enterPhase === 'to') return CARD_ENTER_TO_TRANSFORM;
    if (isSwipeDragOrExit) return `translateX(${swipe.offsetX}px)`;
    return 'none';
  })();

  const cardOpacity = (() => {
    if (!enableSwipe) return 1;
    if (enterPhase === 'from') return CARD_ENTER_FROM_OPACITY;
    return 1;
  })();

  const cardTransition = (() => {
    if (!enableSwipe) return 'none';
    if (enterPhase === 'from') return 'none';
    if (enterPhase === 'to') {
      return `transform ${CARD_ENTER_MS}ms ${CARD_ENTER_EASING}, opacity ${CARD_ENTER_MS}ms ${CARD_ENTER_EASING}`;
    }
    if (swipe.dragging) return 'none';
    if (swipe.exiting) return `transform ${SWIPE_EXIT_MS}ms ease-in`;
    return 'none';
  })();

  const getSwipeCueProgress = (direction) => {
    if (swipe.exiting === direction) return 1;

    const offset = swipe.offsetX;
    const signedDistance = direction === 'right' ? offset : -offset;
    if (signedDistance <= SWIPE_CUE_ACTIVATION_PX) return 0;

    return Math.min(1, (signedDistance - SWIPE_CUE_ACTIVATION_PX) / SWIPE_CUE_RAMP_PX);
  };

  const swipeHintOpacity = (direction) => {
    const progress = getSwipeCueProgress(direction);
    if (!progress) return 0;
    return 0.88 + progress * 0.12;
  };

  const swipeCueScale = (direction) => {
    const progress = getSwipeCueProgress(direction);
    if (!progress) return 0.96;
    return 0.96 + progress * 0.04;
  };

  const activeSwipeLabelDirection = swipe.exiting
    || (swipe.offsetX > SWIPE_CUE_ACTIVATION_PX
      ? 'right'
      : swipe.offsetX < -SWIPE_CUE_ACTIVATION_PX
        ? 'left'
        : null);

  const inlineDetailsBlock = inlineDetails ? (
    <CareerStepRoleInlineBody
      stepDetails={role}
      simulationScopeId={simulationScopeId}
    />
  ) : null;

  const evaluationActionBlock = (
    <RoleEvaluationActionButtons layout="full" {...evaluationButtonProps} />
  );

  const fullEvaluationSection = (
    <Box sx={{ mb: inlineDetails ? 0 : 1.5 }}>
      {evaluationActionBlock}
    </Box>
  );

  const titleRow = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        mb: useStickyCardLayout ? 0 : 1,
      }}
    >
      <Typography
        variant="h6"
        sx={{
          fontWeight: 600,
          flex: 1,
          minWidth: 0,
          minHeight: inlineDetails && !useStickyCardLayout ? undefined : useStickyCardLayout ? undefined : '2.5em',
        }}
      >
        {roleTitle}
      </Typography>
    </Box>
  );

  const matchScoreBlock = (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {t('details.labels.matchScore')}
      </Typography>
      <LinearProgress variant="determinate" value={pct} sx={{ mt: 0.5, height: 8, borderRadius: 1 }} />
      <Typography variant="caption" color="text.secondary">
        {pct}%
      </Typography>
    </Box>
  );

  const moreDetailsBlock = !inlineDetails ? (
    <Box sx={{ mt: 1.5 }}>
      <Tooltip title={t('simulation.evaluationFlow.tooltips.moreDetails')} arrow>
        <span>
          <Button
            variant="contained"
            color={categoryKey === 'outsideTheBox' ? 'inherit' : 'primary'}
            size="small"
            startIcon={<ArrowForwardIcon sx={{ fontSize: '1rem' }} />}
            onClick={handleMore}
            {...nudgeHandlers}
            sx={{
              width: '100%',
              ...(categoryKey === 'outsideTheBox' ? OOTB_ACTION_BUTTON_SX : {}),
              ...nudgeSx('more'),
            }}
            aria-label={t('simulation.evaluationFlow.tooltips.moreDetails')}
          >
            {t('simulation.evaluationFlow.actions.more')}
          </Button>
        </span>
      </Tooltip>
    </Box>
  ) : null;

  const scrollableEvaluationContent = useStickyCardLayout ? (
    <>
      {inlineDetailsBlock}
      {moreDetailsBlock}
    </>
  ) : (
    <>
      {fullEvaluationSection}
      {inlineDetailsBlock}
      {moreDetailsBlock}
    </>
  );

  const cardBodyContent = (
    <>
      {!inlineDetails ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mb: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '5.6em',
          }}
        >
          {roleDescription || 'No description available.'}
        </Typography>
      ) : null}
      {matchScoreBlock}
    </>
  );

  const swipeCueVisibility = (direction) => (
    getSwipeCueProgress(direction) > 0 || swipe.exiting === direction ? 'visible' : 'hidden'
  );

  const swipeSurfaceProps = enableSwipe ? swipe.bind : {};

  const swipeCueLayer = enableSwipe ? (
    <>
      <Box
        aria-hidden={activeSwipeLabelDirection !== 'left'}
        aria-live="polite"
        aria-atomic="true"
        sx={{
          position: 'absolute',
          top: swipeCueTopPx,
          left: { xs: 8, sm: 16 },
          zIndex: 6,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          opacity: swipeHintOpacity('left'),
          visibility: swipeCueVisibility('left'),
          transform: `translateY(-68%) scale(${swipeCueScale('left')})`,
          transformOrigin: 'left center',
          transition: swipe.dragging || swipe.exiting
            ? 'none'
            : `opacity ${SWIPE_EXIT_MS}ms ease, transform ${SWIPE_EXIT_MS}ms ease`,
        }}
      >
        <Typography
          variant="h4"
          component="span"
          sx={(theme) => ({
            ...SWIPE_CUE_TYPOGRAPHY_SX,
            ...swipeCueLabelBackdropSx(theme, theme.palette.error.main),
            color: 'error.main',
            textShadow: swipeCueTextShadowSx(theme),
          })}
        >
          {t('simulation.evaluationFlow.actions.dislike')}
        </Typography>
      </Box>
      <Box
        aria-hidden={activeSwipeLabelDirection !== 'right'}
        aria-live="polite"
        aria-atomic="true"
        sx={{
          position: 'absolute',
          top: swipeCueTopPx,
          right: { xs: 8, sm: 16 },
          zIndex: 6,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          opacity: swipeHintOpacity('right'),
          visibility: swipeCueVisibility('right'),
          transform: `translateY(-68%) scale(${swipeCueScale('right')})`,
          transformOrigin: 'right center',
          transition: swipe.dragging || swipe.exiting
            ? 'none'
            : `opacity ${SWIPE_EXIT_MS}ms ease, transform ${SWIPE_EXIT_MS}ms ease`,
        }}
      >
        <Typography
          variant="h4"
          component="span"
          sx={(theme) => ({
            ...SWIPE_CUE_TYPOGRAPHY_SX,
            ...swipeCueLabelBackdropSx(theme, theme.palette.success.main),
            color: 'success.main',
            textShadow: swipeCueTextShadowSx(theme),
          })}
        >
          {t('simulation.evaluationFlow.actions.keep')}
        </Typography>
      </Box>
    </>
  ) : null;

  return (
    <>
      {panelFrame?.height ? (
        <Box
          aria-hidden
          sx={{ height: panelFrame.height, pointerEvents: 'none' }}
        />
      ) : null}
      <Box
        ref={setSwipeContainerRef}
        {...swipeSurfaceProps}
        sx={{
          ...(panelFrame
            ? {
                position: 'fixed',
                top: `${panelFrame.top}px`,
                left: `${panelFrame.left}px`,
                width: `${panelFrame.width}px`,
                minHeight: panelFrame.height,
                zIndex: theme.zIndex.modal - 1,
                overflow: 'visible',
              }
            : {
                position: 'relative',
                height: '100%',
                overflow: 'visible',
              }),
          touchAction: enableSwipe ? (swipe.dragging ? 'none' : 'manipulation') : 'auto',
          userSelect: enableSwipe && swipe.dragging ? 'none' : 'auto',
          WebkitUserSelect: enableSwipe && swipe.dragging ? 'none' : 'auto',
        }}
      >
        <Box
          sx={{
            height: '100%',
            overflowX: useStickyCardLayout || isSwipeExpanded ? 'visible' : 'hidden',
            overflowY: 'visible',
            transformOrigin: 'center center',
            transform: cardTransform,
            opacity: cardOpacity,
            transition: cardTransition,
            willChange: isSwipeMotionActive ? 'transform, opacity' : 'auto',
            // Keep the card in document flow while scaled so siblings do not jump.
            backfaceVisibility: 'hidden',
          }}
        >
      <Card
        ref={cardRef}
        variant="outlined"
        elevation={0}
        sx={(theme) => ({
          position: 'relative',
          borderStyle: 'solid',
          borderWidth: useStickyCardLayout
            ? `0 1px 1px 6px`
            : `${CARD_ACCENT_TOP_BORDER_PX}px 1px 1px 6px`,
          borderColor: `${accentColor} ${theme.palette.divider} ${theme.palette.divider} ${accentColor}`,
          borderRadius: 2,
          boxShadow: theme.shadows[1],
          bgcolor: 'background.paper',
          minHeight: inlineDetails ? undefined : 300,
          display: 'flex',
          flexDirection: 'column',
          height: inlineDetails ? 'auto' : '100%',
          overflow: 'visible',
          cursor: enableSwipe ? (swipe.dragging ? 'grabbing' : 'grab') : 'auto',
        })}
      >
        <CardContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            justifyContent: inlineDetails ? 'flex-start' : 'space-between',
            gap: inlineDetails && !useStickyCardLayout ? 2 : 0,
            overflow: 'visible',
            p: 2,
            pt: useStickyCardLayout ? 0 : 2,
            '&:last-child': { pb: 2 },
          }}
        >
          {useStickyCardLayout ? (
            <>
              <Box
                ref={swipeCueAnchorRef}
                sx={{
                  position: 'sticky',
                  top: `${stickyTop}px`,
                  zIndex: 2,
                  bgcolor: 'background.paper',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  mx: -2,
                  px: 2,
                  pt: 0,
                  pb: 1.5,
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    height: CARD_ACCENT_TOP_BORDER_PX,
                    bgcolor: accentColor,
                    mx: -2,
                    mb: 0.5,
                    borderTopLeftRadius: 2,
                    borderTopRightRadius: 2,
                  }}
                />
                {titleRow}
                <Box sx={{ mt: 1 }}>{evaluationActionBlock}</Box>
              </Box>
              <Box sx={{ pt: 1.5 }}>
                {cardBodyContent}
                {scrollableEvaluationContent}
              </Box>
            </>
          ) : (
            <Box>
              <Box ref={swipeCueAnchorRef}>
                {titleRow}
                {cardBodyContent}
              </Box>
              {scrollableEvaluationContent}
            </Box>
          )}
        </CardContent>
      </Card>
      </Box>
      {swipeCueLayer ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 5,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {swipeCueLayer}
        </Box>
      ) : null}
      </Box>
    </>
  );
}

const GROUP_KEYS = ['keep', 'skip', 'dislike'];

/** Column headings in ranked view: align with Chip colors (keep=success green, skip=grey, dislike=error red). */
function rankGroupHeadingSx(groupKey) {
  switch (groupKey) {
    case 'keep':
      return { color: 'success.main', fontWeight: 700 };
    case 'skip':
      return { color: 'text.secondary', fontWeight: 700 };
    case 'dislike':
      return { color: 'error.main', fontWeight: 700 };
    default:
      return { color: 'text.secondary', fontWeight: 700 };
  }
}

const getRankRowId = (row, fallbackIndex) => {
  const byId = row?.id ?? row?.step?.id ?? row?.stepId;
  if (byId != null && byId !== '') return String(byId);
  const title = row?.step?.title ?? row?.title;
  if (title != null && title !== '') return getRoleTitleEnglishForMatch(title);
  return `row-${fallbackIndex}`;
};

const getContainerId = (groupKey) => `container:${groupKey}`;
const getItemId = (groupKey, rowId) => `item:${groupKey}:${rowId}`;

const parseContainerId = (id) => {
  if (typeof id !== 'string') return null;
  if (!id.startsWith('container:')) return null;
  return id.replace('container:', '');
};

const parseItemId = (id) => {
  if (typeof id !== 'string') return null;
  if (!id.startsWith('item:')) return null;
  const parts = id.split(':');
  if (parts.length < 3) return null;
  return {
    groupKey: parts[1],
    rowId: parts.slice(2).join(':'),
  };
};

const SortableRankedRoleCard = React.memo(function SortableRankedRoleCard({
  id,
  row,
  groupKey,
  isOver,
  onMoveToGroup: _onMoveToGroup,
  onOpenStepDetails,
  onPlanPath,
  categoryKey,
}) {
  const { t, i18n } = useTranslation('dashboard');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { type: 'item', groupKey, rowId: getRankRowId(row, 0) },
  });
  const role = row.step;
  const displayTitle = getRoleTitleForLocale(row.title, i18n.language);

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
      willChange: 'transform',
    }),
    [transform, transition, isDragging]
  );

  return (
    <Card
      ref={setNodeRef}
      style={style}
      variant="outlined"
      sx={{
        borderLeft: '4px solid',
        borderColor: isOver
          ? 'primary.main'
          : categoryKey === 'outsideTheBox'
            ? 'var(--color-ootb-action)'
            : 'var(--color-primary)',
        backgroundColor: isOver ? 'action.selected' : 'background.paper',
        boxShadow: isOver ? 3 : 0,
        transition: 'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
      }}
    >
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'stretch', md: 'center' },
            justifyContent: 'space-between',
            gap: 1.5,
            flexDirection: { xs: 'column', md: 'row' },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.5,
              flex: 1,
              minWidth: 0,
              width: { xs: '100%', md: 'auto' },
            }}
          >
            <Tooltip title={t('simulation.evaluationFlow.tooltips.dragToReorder')} arrow>
              <Box
                {...attributes}
                {...listeners}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  alignSelf: 'center',
                  color: 'text.secondary',
                  cursor: 'grab',
                  pr: 0.5,
                  flexShrink: 0,
                  touchAction: 'none',
                }}
              >
                <DragIndicatorIcon fontSize="small" />
              </Box>
            </Tooltip>
            <Typography
              variant="body1"
              component="div"
              sx={{
                fontWeight: 600,
                minWidth: 0,
                flex: 1,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600, mr: 1 }}>
                #{row.finalRank}
              </Box>
              {displayTitle}
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              gap: 1,
              width: { xs: '100%', md: 'auto' },
              flexShrink: { md: 0 },
            }}
          >
            <Box sx={{ flex: { xs: 1, md: 'initial' }, minWidth: 0, width: { md: 'auto' } }}>
              <Tooltip title={t('simulation.evaluationFlow.tooltips.moreDetails')} arrow>
                <span style={{ display: 'block', width: '100%' }}>
                  <Button
                    variant="contained"
                    color={categoryKey === 'outsideTheBox' ? 'inherit' : 'primary'}
                    size="small"
                    endIcon={<ArrowForwardIcon sx={{ fontSize: '0.9rem' }} />}
                    onClick={() => onOpenStepDetails(role)}
                    sx={(theme) => ({
                      ...rankedRowActionSx(theme),
                      whiteSpace: 'nowrap !important',
                      ...(categoryKey === 'outsideTheBox' ? OOTB_ACTION_BUTTON_SX : {}),
                    })}
                  >
                    {t('simulation.evaluationFlow.actions.more')}
                  </Button>
                </span>
              </Tooltip>
            </Box>
            {typeof onPlanPath === 'function' ? (
              <Box sx={{ flex: { xs: 1, md: 'initial' }, minWidth: 0, width: { md: 'auto' } }}>
                <Tooltip title={t('simulation.evaluationFlow.tooltips.planPath')} arrow>
                  <span style={{ display: 'block', width: '100%' }}>
                    <Button
                      variant="outlined"
                      color={categoryKey === 'outsideTheBox' ? 'inherit' : 'primary'}
                      size="small"
                      endIcon={<RouteIcon sx={{ fontSize: '0.9rem' }} />}
                      onClick={() => onPlanPath(role)}
                      sx={(theme) => ({
                        ...rankedRowActionSx(theme),
                        // Keep label on one line; share the action row equally with "Mehr" on mobile/tablet.
                        whiteSpace: 'nowrap !important',
                        minWidth: { xs: 0, md: '132px !important' },
                        flexShrink: 0,
                        ...(categoryKey === 'outsideTheBox' ? OOTB_ACTION_BUTTON_SX : {}),
                      })}
                    >
                      {t('simulation.evaluationFlow.actions.planPath')}
                    </Button>
                  </span>
                </Tooltip>
              </Box>
            ) : null}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
});

function RankColumn({ groupKey, title, rows, itemIds, overMeta, children, collapsible = false, defaultCollapsed = false }) {
  const { t } = useTranslation('dashboard');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const containerId = getContainerId(groupKey);
  const { setNodeRef } = useDroppable({
    id: containerId,
    data: { type: 'container', groupKey },
  });
  const isOverContainer = overMeta?.groupKey === groupKey && overMeta?.overType === 'container';
  const showRoleList = !collapsible || !collapsed;

  return (
    <Box
      ref={setNodeRef}
      sx={{
        mb: 2,
        borderRadius: 1.5,
        border: '1px dashed',
        borderColor: isOverContainer ? 'primary.main' : 'transparent',
        backgroundColor: isOverContainer ? 'action.hover' : 'transparent',
        transition: 'border-color 140ms ease, background-color 140ms ease',
        p: 1,
        minHeight: showRoleList ? 78 : 'auto',
      }}
    >
      <Box
        component={collapsible ? 'button' : 'div'}
        type={collapsible ? 'button' : undefined}
        onClick={collapsible ? () => setCollapsed((prev) => !prev) : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          mb: showRoleList ? 1 : 0,
          width: '100%',
          border: 'none',
          background: 'none',
          padding: 0,
          cursor: collapsible ? 'pointer' : 'default',
          textAlign: 'left',
          color: 'inherit',
        }}
      >
        {collapsible ? (
          collapsed ? (
            <ExpandMoreIcon fontSize="small" color="action" aria-hidden />
          ) : (
            <ExpandLessIcon fontSize="small" color="action" aria-hidden />
          )
        ) : null}
        <Typography variant="subtitle1" component="span" sx={{ ...rankGroupHeadingSx(groupKey) }}>
          {title}
          {collapsible && rows.length > 0 ? ` (${rows.length})` : ''}
        </Typography>
      </Box>
      {showRoleList ? (
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {rows.length ? (
              children
            ) : (
              <Box
                sx={{
                  minHeight: 56,
                  borderRadius: 1,
                  border: '1px dashed',
                  borderColor: isOverContainer ? 'primary.main' : 'divider',
                  backgroundColor: isOverContainer ? 'primary.50' : 'action.hover',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 140ms ease',
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {t('simulation.evaluationFlow.dropHere')}
                </Typography>
              </Box>
            )}
          </Box>
        </SortableContext>
      ) : null}
    </Box>
  );
}

export function RankedGroupsView({
  rankedRows,
  rankCategoryLabel,
  categoryKey,
  rankingDescription,
  showRankingDescription = true,
  resolveRowCategoryKey,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
  onReorderRankedRoles,
  onPlanPath,
  onOpenStepDetails = null,
}) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('dashboard');
  const [activeId, setActiveId] = useState(null);
  const [overMeta, setOverMeta] = useState(null);
  const getRowCategoryKey = resolveRowCategoryKey || (() => categoryKey);
  const seenRolesStorageKey = useMemo(
    () =>
      buildCombinedRankingSeenRolesKey({
        isViewingSavedSimulation,
        savedSimulationId,
        simulationIdForCards,
      }),
    [isViewingSavedSimulation, savedSimulationId, simulationIdForCards]
  );

  // Track ranked roles for this tab visit so later inserts stay "new" (red) until a full reload.
  // Do not write localStorage here — that would clear the red state on SPA navigate-away/back.
  useEffect(() => {
    const ids = (rankedRows || []).map(getCombinedRankingRowId).filter(Boolean);
    if (!ids.length) return;
    trackCombinedRankingRolesForVisit(seenRolesStorageKey, ids);
  }, [rankedRows, seenRolesStorageKey]);

  const openStepDetails = (role) => {
    if (typeof onOpenStepDetails === 'function') {
      onOpenStepDetails(role);
      return;
    }
    const stepId = role.stepId || role.id || getRoleTitleEnglishForMatch(role.title);
    try {
      sessionStorage.setItem('currentStepDetails', JSON.stringify(role));
      storeSimulationResultDetails(role, [stepId]);
    } catch {
      /* ignore */
    }
    const path =
      isViewingSavedSimulation && savedSimulationId
        ? `/saved-simulation/${savedSimulationId}/career-step/${encodeURIComponent(stepId)}`
        : `/simulation/result/${encodeURIComponent(stepId)}`;
    const navigateFn = guardedNavigate || navigate;
    navigateFn(path);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Columns = rankedRows grouped by userEvaluation (roles[] SoT via getRankedBoard). No localStorage overlay.
  const groups = useMemo(() => {
    const grouped = { keep: [], skip: [], dislike: [] };
    (rankedRows || []).forEach((row, index) => {
      if (grouped[row.userEvaluation]) {
        grouped[row.userEvaluation].push({ ...row, _dndId: getRankRowId(row, index) });
      }
    });
    return grouped;
  }, [rankedRows]);

  const idToLocation = useMemo(() => {
    const map = new Map();
    GROUP_KEYS.forEach((groupKey) => {
      groups[groupKey].forEach((row, index) => {
        map.set(row._dndId, { groupKey, index });
      });
    });
    return map;
  }, [groups]);

  const applyMoveAndPersist = (nextGroups) => {
    if (typeof onReorderRankedRoles !== 'function') return;
    const flattened = GROUP_KEYS.flatMap((key) => nextGroups[key]).map((row, idx) => ({
      ...row,
      finalRank: idx + 1,
      userEvaluation: row.userEvaluation,
      step: { ...row.step, userEvaluation: row.userEvaluation },
    }));
    onReorderRankedRoles(flattened);
  };

  const moveRoleById = (rowId, sourceGroup, targetGroup, targetIndex) => {
    const nextGroups = {
      keep: [...groups.keep],
      skip: [...groups.skip],
      dislike: [...groups.dislike],
    };
    const sourceIdx = nextGroups[sourceGroup].findIndex((row) => row._dndId === rowId);
    if (sourceIdx < 0) return;

    if (sourceGroup === targetGroup) {
      nextGroups[sourceGroup] = arrayMove(nextGroups[sourceGroup], sourceIdx, targetIndex);
      applyMoveAndPersist(nextGroups);
      return;
    }

    const [picked] = nextGroups[sourceGroup].splice(sourceIdx, 1);
    if (!picked) return;
    const withNewCategory = {
      ...picked,
      userEvaluation: targetGroup,
      step: { ...picked.step, userEvaluation: targetGroup },
    };
    const clampedIndex = Math.max(0, Math.min(targetIndex, nextGroups[targetGroup].length));
    nextGroups[targetGroup].splice(clampedIndex, 0, withNewCategory);
    applyMoveAndPersist(nextGroups);
  };

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event) => {
    const overId = event.over?.id;
    if (!overId) {
      setOverMeta(null);
      return;
    }
    const parsedContainer = parseContainerId(overId);
    if (parsedContainer) {
      setOverMeta({ groupKey: parsedContainer, overType: 'container' });
      return;
    }
    const parsedItem = parseItemId(overId);
    if (parsedItem) {
      setOverMeta({ groupKey: parsedItem.groupKey, overType: 'item', overId });
      return;
    }
    setOverMeta(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverMeta(null);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);
    setOverMeta(null);
    if (!over) return;

    const activeMeta = parseItemId(active.id);
    if (!activeMeta) return;

    const overContainer = parseContainerId(over.id);
    if (overContainer) {
      const targetIndex = groups[overContainer]?.length ?? 0;
      moveRoleById(activeMeta.rowId, activeMeta.groupKey, overContainer, targetIndex);
      return;
    }

    const overMetaItem = parseItemId(over.id);
    if (!overMetaItem) return;
    const targetLocation = idToLocation.get(overMetaItem.rowId);
    if (!targetLocation) return;
    moveRoleById(activeMeta.rowId, activeMeta.groupKey, targetLocation.groupKey, targetLocation.index);
  };

  const handleMoveToGroup = (sourceGroup, rowId, targetGroup) => {
    const targetIndex = groups[targetGroup]?.length ?? 0;
    moveRoleById(rowId, sourceGroup, targetGroup, targetIndex);
  };

  const itemIdsByGroup = useMemo(
    () => ({
      keep: groups.keep.map((row) => getItemId('keep', row._dndId)),
      skip: groups.skip.map((row) => getItemId('skip', row._dndId)),
      dislike: groups.dislike.map((row) => getItemId('dislike', row._dndId)),
    }),
    [groups]
  );

  const activeCard = useMemo(() => {
    const parsed = parseItemId(activeId);
    if (!parsed) return null;
    const location = idToLocation.get(parsed.rowId);
    if (!location) return null;
    const row = groups[location.groupKey][location.index];
    if (!row) return null;
    return { row, groupKey: location.groupKey };
  }, [activeId, idToLocation, groups]);

  return (
    <Box>
      {showRankingDescription ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {rankingDescription
            || t('simulation.evaluationFlow.finalRankingDescription', { category: rankCategoryLabel })}
        </Typography>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <RankColumn
          groupKey="keep"
          title={t('simulation.evaluationFlow.actions.keep')}
          rows={groups.keep}
          itemIds={itemIdsByGroup.keep}
          overMeta={overMeta}
        >
          {groups.keep.map((row) => {
            const id = getItemId('keep', row._dndId);
            return (
              <SortableRankedRoleCard
                key={id}
                id={id}
                row={row}
                groupKey="keep"
                isOver={overMeta?.overType === 'item' && overMeta?.overId === id}
                onMoveToGroup={handleMoveToGroup}
                onOpenStepDetails={openStepDetails}
                onPlanPath={onPlanPath}
                categoryKey={getRowCategoryKey(row)}
              />
            );
          })}
        </RankColumn>
        <RankColumn
          groupKey="skip"
          title={t('simulation.evaluationFlow.actions.skip')}
          rows={groups.skip}
          itemIds={itemIdsByGroup.skip}
          overMeta={overMeta}
          collapsible
          defaultCollapsed
        >
          {groups.skip.map((row) => {
            const id = getItemId('skip', row._dndId);
            return (
              <SortableRankedRoleCard
                key={id}
                id={id}
                row={row}
                groupKey="skip"
                isOver={overMeta?.overType === 'item' && overMeta?.overId === id}
                onMoveToGroup={handleMoveToGroup}
                onOpenStepDetails={openStepDetails}
                onPlanPath={onPlanPath}
                categoryKey={getRowCategoryKey(row)}
              />
            );
          })}
        </RankColumn>
        <RankColumn
          groupKey="dislike"
          title={t('simulation.evaluationFlow.actions.dislike')}
          rows={groups.dislike}
          itemIds={itemIdsByGroup.dislike}
          overMeta={overMeta}
          collapsible
          defaultCollapsed
        >
          {groups.dislike.map((row) => {
            const id = getItemId('dislike', row._dndId);
            return (
              <SortableRankedRoleCard
                key={id}
                id={id}
                row={row}
                groupKey="dislike"
                isOver={overMeta?.overType === 'item' && overMeta?.overId === id}
                onMoveToGroup={handleMoveToGroup}
                onOpenStepDetails={openStepDetails}
                onPlanPath={onPlanPath}
                categoryKey={getRowCategoryKey(row)}
              />
            );
          })}
        </RankColumn>

        <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
          {activeCard ? (
            <Box
              sx={{
                transform: 'scale(1.02)',
                boxShadow: 'var(--shadow-overlay-lg)',
                borderRadius: 1,
              }}
            >
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <DragIndicatorIcon fontSize="small" color="action" />
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600, mr: 1 }}>
                        #{activeCard.row.finalRank}
                      </Box>
                      {getRoleTitleForLocale(activeCard.row.title, i18n.language)}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Box>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Box>
  );
}

/**
 * @param {object} props
 */
export default function SimulationCategoryEvaluation({
  title,
  categoryKey,
  roles,
  phase,
  rankedRows,
  hasStarted,
  onEvaluate,
  onSeeRanking,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
  onReorderRankedRoles,
  onPlanPath,
}) {
  const { t } = useTranslation('dashboard');
  const theme = useTheme();
  const isMobileViewport = useMediaQuery(theme.breakpoints.down('sm'));
  const visibleSlotCount = getEvaluationVisibleSlotCount(isMobileViewport);
  const pending = useMemo(() => roles.filter((r) => r.userEvaluation == null), [roles]);
  const cardsToShow = useMemo(() => {
    if (isEvaluationComplete(roles)) return roles;
    return pending.slice(0, visibleSlotCount);
  }, [roles, pending, visibleSlotCount]);

  const evaluated = countEvaluatedRoles(roles);
  const total = roles.length;
  const complete = isEvaluationComplete(roles);
  /** First-time reveal after all roles are rated (ranking not opened yet). */
  const awaitingRankingReveal = complete && phase === 'eval' && !rankedRows?.length;

  const focusRoleId = useMemo(() => {
    if (phase !== 'eval' || awaitingRankingReveal || complete) return null;
    return cardsToShow[0]?.id ?? null;
  }, [phase, awaitingRankingReveal, complete, cardsToShow]);

  const evalNudge = useEvalActionNudge({ enabled: Boolean(focusRoleId) });
  const rankingRevealNudge = useCtaNudgeAnimation({ enabled: awaitingRankingReveal });
  const useEvalStickyLayout = phase === 'eval' && !awaitingRankingReveal && total > 0;
  const swipeStageRef = useRef(null);
  const [swipeExitOverlay, setSwipeExitOverlay] = useState(null);

  const handleSwipeExitStart = useCallback((role, { direction, offsetX, cardHeight }) => {
    setSwipeExitOverlay({ role, direction, offsetX, cardHeight });
  }, []);

  useEffect(() => {
    if (!swipeExitOverlay) return undefined;
    const timer = window.setTimeout(() => setSwipeExitOverlay(null), SWIPE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [swipeExitOverlay]);

  const renderRoleEvaluationCard = useCallback(
    (role, { showEvalNudge = false, swipeHandoff = false, skipEnterAnimation = false, interactive = true } = {}) => (
      <RoleEvaluationCard
        role={role}
        categoryKey={categoryKey}
        isViewingSavedSimulation={isViewingSavedSimulation}
        savedSimulationId={savedSimulationId}
        onEvaluate={interactive ? onEvaluate : undefined}
        guardedNavigate={guardedNavigate}
        showEvalNudge={showEvalNudge && interactive}
        getButtonNudgeSx={evalNudge.getButtonNudgeSx}
        nudgeInteractionHandlers={evalNudge.interactionHandlers}
        inlineDetails={useEvalStickyLayout}
        simulationIdForCards={simulationIdForCards}
        swipeHandoffToParent={swipeHandoff && interactive}
        onSwipeExitStart={(payload) => handleSwipeExitStart(role, payload)}
        skipEnterAnimation={skipEnterAnimation}
        swipeStageRef={swipeStageRef}
        expandSwipeToPanel={isMobileViewport}
      />
    ),
    [
      categoryKey,
      evalNudge.getButtonNudgeSx,
      evalNudge.interactionHandlers,
      guardedNavigate,
      handleSwipeExitStart,
      isViewingSavedSimulation,
      onEvaluate,
      savedSimulationId,
      simulationIdForCards,
      useEvalStickyLayout,
      isMobileViewport,
    ]
  );

  const evaluationInstructionText = complete
    ? t('simulation.evaluationFlow.allRolesRated', { total })
    : hasStarted
        ? t(
            isMobileViewport
              ? 'simulation.evaluationFlow.continueMobile'
              : 'simulation.evaluationFlow.continue'
          )
        : t(
            isMobileViewport
              ? 'simulation.evaluationFlow.startMobile'
              : 'simulation.evaluationFlow.start'
          );

  if (phase === 'ranked' && Array.isArray(rankedRows) && rankedRows.length) {
    return (
      <Box
        sx={{
          mb: 4,
          p: { xs: 2, sm: 2.5, md: 3 },
          borderRadius: 2,
          bgcolor: 'var(--color-ranking-panel-bg)',
          /* Match default `Paper` elevation on simulation detail headers */
          boxShadow: (theme) => theme.shadows[1],
        }}
      >
        <RankedGroupsView
          rankedRows={rankedRows}
          rankCategoryLabel={title}
          categoryKey={categoryKey}
          showRankingDescription={false}
          guardedNavigate={guardedNavigate}
          isViewingSavedSimulation={isViewingSavedSimulation}
          savedSimulationId={savedSimulationId}
          simulationIdForCards={simulationIdForCards}
          onReorderRankedRoles={onReorderRankedRoles}
          onPlanPath={onPlanPath}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Box sx={{ pb: useEvalStickyLayout ? 1 : 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between',
            mb: 2,
            gap: 1.5,
            flexDirection: { xs: 'column', sm: 'row' },
          }}
        >
          <Typography
            variant="h4"
            component="h2"
            sx={{
              fontWeight: 'bold',
              flex: 1,
              minWidth: 0,
              typography: { xs: 'h5', sm: 'h4' },
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              pr: { sm: 1 },
            }}
          >
            {title}
          </Typography>
          {!awaitingRankingReveal && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'auto' } }}
            >
              {t('simulation.evaluationFlow.rolesEvaluated', { evaluated, total })}
            </Typography>
          )}
        </Box>
        {!awaitingRankingReveal && (
          <LinearProgress
            variant="determinate"
            value={total ? (evaluated / total) * 100 : 0}
            sx={{ height: 6, borderRadius: 3, mb: useEvalStickyLayout ? 1 : 2 }}
          />
        )}
        {useEvalStickyLayout && !awaitingRankingReveal && total > 0 ? (
          <Typography variant="body2" color="text.secondary">
            {evaluationInstructionText}
          </Typography>
        ) : null}
      </Box>

      {!total ? (
        <Typography variant="body2" color="text.secondary">
          {t('simulation.evaluationFlow.noRolesInCategory')}
        </Typography>
      ) : awaitingRankingReveal ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button
            variant="contained"
            color="primary"
            size="medium"
            startIcon={<ThumbUpAltOutlinedIcon />}
            onClick={onSeeRanking}
            {...rankingRevealNudge.nudgeInteractionHandlers}
            sx={{
              fontWeight: 600,
              px: 3,
              py: 1.5,
              fontSize: '1rem',
              ...rankingRevealNudge.nudgeSx,
            }}
          >
            {t('simulation.evaluationFlow.seeYourRanking')}
          </Button>
        </Box>
      ) : (
        <>
          {!useEvalStickyLayout ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {evaluationInstructionText}
            </Typography>
          ) : null}

          <Box
            ref={swipeStageRef}
            sx={{ position: 'relative', overflow: 'visible' }}
          >
            <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} sx={{ mb: 2 }}>
              {cardsToShow.map((role) => (
                <Grid item xs={12} sm={6} md={6} lg={4} key={role.id}>
                  <Box sx={{ position: 'relative', height: '100%' }}>
                    {renderRoleEvaluationCard(role, {
                      showEvalNudge: role.id === focusRoleId,
                      swipeHandoff: useEvalStickyLayout,
                    })}
                  </Box>
                </Grid>
              ))}
            </Grid>
            {useEvalStickyLayout && swipeExitOverlay ? (
              <RoleEvaluationExitShell
                direction={swipeExitOverlay.direction}
                startOffsetX={swipeExitOverlay.offsetX}
                swipeStageRef={swipeStageRef}
                expandSwipeToPanel={isMobileViewport}
                cardHeight={swipeExitOverlay.cardHeight}
              >
                {renderRoleEvaluationCard(swipeExitOverlay.role, {
                  skipEnterAnimation: true,
                  interactive: false,
                })}
              </RoleEvaluationExitShell>
            ) : null}
          </Box>
        </>
      )}
    </Box>
  );
}
