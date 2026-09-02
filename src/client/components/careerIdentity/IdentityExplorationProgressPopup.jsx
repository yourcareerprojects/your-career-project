import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import { useAppNavigation } from '../../hooks/useAppNavigation';
import { useLastSimulationQuery } from '../../hooks/useProfileQueries';
import { isIdentityExplorationUnlockedBySimulation } from '../../utils/identityExplorationSimulationUnlock';
import { resolveExplorationProgressPhase } from '../../utils/resolveExplorationNotification';

function resolveBodyCopy(phase, t, { activityPending = false } = {}) {
  if (activityPending && phase === 'accumulating') {
    return t('careerIdentity.progress.updating');
  }
  switch (phase) {
    case 'delivered':
      return t('careerIdentity.progress.delivered');
    case 'ready':
      return t('careerIdentity.progress.ready');
    case 'preparing':
      return t('careerIdentity.progress.preparing');
    default:
      return null;
  }
}

/**
 * Progress card for identity → role-suggestion accumulation.
 * Discovery and profile next-actions unlock only after the first simulation
 * has both Next and Outside-the-Box rankings complete; otherwise the card
 * sends the user to the simulation flow (Career Identity page).
 * On PuzzleJOB, pass hideWhenSimulationGated so the "complete simulation" prompt
 * is not shown while ranking is still in progress.
 * While ready/preparing at threshold, shows an explicit preparing state (not a Discover button).
 */
export default function IdentityExplorationProgressPopup({
  progress = null,
  explorationNotification = null,
  onDiscover = null,
  onRateIdentity = null,
  canRateIdentity = true,
  sticky = true,
  hideWhenSimulationGated = false,
  sx = null,
}) {
  const { t } = useTranslation('dashboard');
  const { isAuthenticated } = useAuth();
  const { guardedNavigate } = useNavigationGuardContext();
  const { careerSimulationPath } = useAppNavigation();
  const lastSimQuery = useLastSimulationQuery({ enabled: isAuthenticated });

  const simulationUnlocked = isIdentityExplorationUnlockedBySimulation(lastSimQuery.data);
  const rankingsKnown = simulationUnlocked
    || !isAuthenticated
    || lastSimQuery.isFetched
    || lastSimQuery.isError;
  const showSimulationGate = rankingsKnown && !simulationUnlocked;

  const handleRateIdentity = () => {
    if (!canRateIdentity) return;
    if (typeof onRateIdentity === 'function') {
      onRateIdentity();
      return;
    }
    guardedNavigate('/puzzle-you?rateTraits=1');
  };

  const handleGoToSimulation = () => {
    guardedNavigate(careerSimulationPath || '/simulation');
  };

  if (!progress?.hasBaseline) return null;
  if (hideWhenSimulationGated && !simulationUnlocked) return null;

  const reasons = Array.isArray(progress.reasons) ? progress.reasons.filter(Boolean) : [];
  const progressValue = Math.max(0, Math.min(100, Number(progress.progressPercent) || 0));
  const activityPending = Boolean(progress.activityPending);
  const showReasons = simulationUnlocked
    && progress.phase === 'accumulating'
    && reasons.length > 0
    && !activityPending;
  const showNextActionButtons = simulationUnlocked
    && progressValue < 100
    && !activityPending;

  const jobCount = Number(explorationNotification?.jobCount) || 0;
  const sessionId = explorationNotification?.sessionId
    ? String(explorationNotification.sessionId)
    : null;
  const phase = resolveExplorationProgressPhase(progress, explorationNotification);
  const canDiscover =
    simulationUnlocked
    && Boolean(explorationNotification?.hasUnreadExploration)
    && Boolean(sessionId)
    && jobCount > 0;
  const isPreparingDelivery =
    simulationUnlocked
    && !canDiscover
    && (phase === 'ready' || phase === 'preparing' || activityPending);
  const bodyCopy = !rankingsKnown
    ? null
    : showSimulationGate
      ? t('careerIdentity.progress.completeSimulationFirst')
      : canDiscover
        ? null
        : resolveBodyCopy(phase, t, { activityPending });

  return (
    <Paper
      elevation={6}
      sx={{
        ...(sticky
          ? {
              position: 'sticky',
              top: { xs: 12, md: 20 },
              zIndex: 3,
            }
          : null),
        maxWidth: 560,
        mx: 'auto',
        mb: 3,
        p: 2,
        borderRadius: 3,
        ...sx,
      }}
    >
      <Stack spacing={1.25}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            {t('careerIdentity.progress.title')}
          </Typography>
          {canDiscover ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {explorationNotification?.rankingProgress?.hasProgress
                ? t('careerIdentity.exploration.continueBody', {
                    evaluated: explorationNotification.rankingProgress.evaluatedCount,
                    total:
                      explorationNotification.rankingProgress.totalCount || jobCount,
                  })
                : t('careerIdentity.exploration.discoveredBody', { count: jobCount })}
            </Typography>
          ) : bodyCopy ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {bodyCopy}
            </Typography>
          ) : null}
        </Box>

        {simulationUnlocked ? (
          <Box>
            <LinearProgress
              variant={isPreparingDelivery ? 'indeterminate' : 'determinate'}
              value={isPreparingDelivery ? undefined : progressValue}
              sx={{ height: 10, borderRadius: 999 }}
            />
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 1,
                mt: 0.75,
              }}
            >
              {isPreparingDelivery ? (
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <CircularProgress size={12} thickness={5} />
                  <Typography variant="caption" color="text.secondary">
                    {activityPending && phase === 'accumulating'
                      ? t('careerIdentity.progress.updatingShort')
                      : t('careerIdentity.progress.preparingShort')}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {t('careerIdentity.progress.percentLabel', {
                    percent: progressValue,
                  })}
                </Typography>
              )}
            </Box>
          </Box>
        ) : null}

        {showSimulationGate ? (
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={handleGoToSimulation}
            >
              {t('careerIdentity.progress.ctaCompleteSimulation')}
            </Button>
          </Box>
        ) : null}

        {canDiscover ? (
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => onDiscover?.(sessionId)}
            >
              {explorationNotification?.rankingProgress?.hasProgress
                ? t('careerIdentity.exploration.ctaContinue')
                : t('careerIdentity.exploration.cta')}
            </Button>
          </Box>
        ) : null}

        {simulationUnlocked && phase === 'accumulating' && !activityPending ? (
          <Typography variant="body2" color="text.secondary">
            {t('careerIdentity.progress.helpText')}
          </Typography>
        ) : null}

        {showNextActionButtons ? (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            useFlexGap
            flexWrap="wrap"
          >
            <Button
              variant="outlined"
              size="small"
              onClick={() => guardedNavigate('/profile')}
            >
              {t('careerIdentity.progress.ctaUpdateProfile')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => guardedNavigate('/puzzle-path')}
            >
              {t('careerIdentity.progress.ctaPuzzlePath')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              disabled={!canRateIdentity}
              onClick={handleRateIdentity}
              title={
                canRateIdentity
                  ? undefined
                  : t('careerIdentity.progress.ctaRateIdentityDisabled')
              }
            >
              {t('careerIdentity.progress.ctaRateIdentity')}
            </Button>
          </Stack>
        ) : null}

        {showReasons ? (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('careerIdentity.progress.reasonsTitle')}
            </Typography>
            <Stack spacing={0.5}>
              {reasons.map((reason) => (
                <Typography key={reason} variant="caption">
                  {`\u2022 ${reason}`}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}
