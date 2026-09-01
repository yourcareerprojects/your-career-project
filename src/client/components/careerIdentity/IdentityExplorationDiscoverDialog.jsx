import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Typography,
} from '@mui/material';
import CelebrationOutlinedIcon from '@mui/icons-material/CelebrationOutlined';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useExplorationSessionQuery } from '../../hooks/useCareerIdentityQueries';
import { baseUILanguage } from '../../hooks/useProfileQueries';
import { useEvalActionNudge, EVAL_RATING_NUDGE_BUTTON_KEYS } from '../../hooks/useEvalActionNudge';
import SimulationWizardDialog from '../common/SimulationWizardDialog';
import SimulationWizardPauseDialog from '../common/SimulationWizardPauseDialog';
import { RoleEvaluationCard, RankedGroupsView } from '../common/SimulationCategoryEvaluation';
import {
  buildRankedRows,
  countEvaluatedRoles,
  isEvaluationComplete,
} from '../../utils/simulationRoleRanking';
import {
  applyExplorationRankingProgress,
  buildExplorationEvaluationRoles,
  buildExplorationRankingProgress,
} from '../../utils/explorationRoleEvaluation';
import {
  cancelPersistExplorationRankingProgress,
  flushPersistExplorationRankingProgress,
  schedulePersistExplorationRankingProgress,
} from '../../utils/persistExplorationRankingProgress';
import { navigateToCareerPathPlanning } from '../../utils/careerPathPlanningSession';
import { fireProfileCreatedConfetti } from '../../utils/profileCreatedConfetti';

/**
 * Discovery ranking experience for a completed IdentityExplorationSession.
 * Mirrors the simulation role-evaluation wizard: progress bar, inline role
 * details, Keep/Skip/Dislike + swipe, then a ranked Keep/Skip/Dislike board.
 * Mid-flow ratings persist on the session so Schließen / pause can resume later.
 */
export default function IdentityExplorationDiscoverDialog({
  open,
  sessionId,
  onClose,
  onComplete = null,
}) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const lang = baseUILanguage();
  const sessionQuery = useExplorationSessionQuery(sessionId, {
    enabled: open && Boolean(sessionId),
  });

  const [roles, setRoles] = useState([]);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const [phase, setPhase] = useState('eval'); // 'eval' | 'ranked'
  const [rankedRows, setRankedRows] = useState(null);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const swipeStageRef = useRef(null);
  const builtForSessionRef = useRef(null);
  const rolesRef = useRef(roles);
  const phaseRef = useRef(phase);
  const rankedRowsRef = useRef(rankedRows);

  useEffect(() => {
    rolesRef.current = roles;
  }, [roles]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    rankedRowsRef.current = rankedRows;
  }, [rankedRows]);

  const jobs = useMemo(
    () => (Array.isArray(sessionQuery.data?.explorationJobs) ? sessionQuery.data.explorationJobs : []),
    [sessionQuery.data?.explorationJobs]
  );
  const jobsBuildKey = useMemo(
    () =>
      jobs
        .map((job, index) => `${job?.careerPathId || ''}:${job?.escoId || ''}:${index}`)
        .join('|'),
    [jobs]
  );

  const persistProgress = useCallback(
    (next = {}, { flush = false } = {}) => {
      if (!sessionId) return Promise.resolve(null);
      const rankingProgress = buildExplorationRankingProgress({
        phase: next.phase ?? phaseRef.current,
        roles: next.roles ?? rolesRef.current,
        rankedRows: next.rankedRows !== undefined ? next.rankedRows : rankedRowsRef.current,
        wizardPaused: Boolean(next.wizardPaused),
      });
      if (flush) {
        schedulePersistExplorationRankingProgress(sessionId, rankingProgress);
        return flushPersistExplorationRankingProgress();
      }
      schedulePersistExplorationRankingProgress(sessionId, rankingProgress);
      return Promise.resolve(null);
    },
    [sessionId]
  );

  useEffect(() => {
    if (!open) {
      setRoles([]);
      setEnriching(false);
      setEnrichError('');
      setPhase('eval');
      setRankedRows(null);
      setPauseDialogOpen(false);
      builtForSessionRef.current = null;
      return undefined;
    }
    if (!sessionId || sessionQuery.isLoading || sessionQuery.isError) return undefined;

    const buildKey = `${sessionId}::${jobsBuildKey}`;
    if (builtForSessionRef.current === buildKey) return undefined;

    let cancelled = false;
    builtForSessionRef.current = buildKey;
    setEnriching(true);
    setEnrichError('');
    setPhase('eval');
    setRankedRows(null);

    (async () => {
      try {
        if (!jobs.length) {
          if (!cancelled) {
            setRoles([]);
            setEnriching(false);
          }
          return;
        }
        const nextRoles = await buildExplorationEvaluationRoles(jobs, {
          sessionId,
          lang,
        });
        if (cancelled) return;

        const restored = applyExplorationRankingProgress(
          nextRoles,
          sessionQuery.data?.rankingProgress
        );
        setRoles(restored.roles);
        setPhase(restored.phase);
        setRankedRows(restored.rankedRows);
        setEnriching(false);

        // Clear wizardPaused on resume so the next pause can re-flag it.
        if (sessionQuery.data?.rankingProgress?.wizardPaused) {
          persistProgress(
            {
              phase: restored.phase,
              roles: restored.roles,
              rankedRows: restored.rankedRows,
              wizardPaused: false,
            },
            { flush: false }
          );
        }
      } catch (err) {
        if (!cancelled) {
          setRoles([]);
          setEnrichError(err?.message || t('careerIdentity.exploration.loadError'));
          setEnriching(false);
          builtForSessionRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Do not depend on enriching / enrichError / pauseDialogOpen — including
    // enriching re-runs this effect after setEnriching(true), cancels the async
    // build, then early-returns on builtForSessionRef and leaves the spinner stuck.
  }, [
    open,
    sessionId,
    sessionQuery.isLoading,
    sessionQuery.isError,
    sessionQuery.data?.rankingProgress,
    jobs,
    jobsBuildKey,
    lang,
    t,
    persistProgress,
  ]);

  const evaluatedCount = countEvaluatedRoles(roles);
  const totalRoles = roles.length;
  const currentRole = useMemo(
    () => roles.find((role) => role && role.userEvaluation == null) || null,
    [roles]
  );
  const progressStep =
    phase === 'ranked'
      ? Math.max(1, totalRoles)
      : Math.min(totalRoles, evaluatedCount + 1);
  const evalNudge = useEvalActionNudge({
    enabled: open && phase === 'eval' && Boolean(currentRole),
    buttonKeys: EVAL_RATING_NUDGE_BUTTON_KEYS,
  });
  const hasRankingProgress = evaluatedCount > 0 || phase === 'ranked';

  const handleEvaluate = useCallback((roleId, evaluation) => {
    setRoles((prev) => {
      const nextRoles = prev.map((role) =>
        role.id === roleId ? { ...role, userEvaluation: evaluation } : role
      );
      persistProgress({ roles: nextRoles, phase: 'eval', rankedRows: null });
      return nextRoles;
    });
  }, [persistProgress]);

  useEffect(() => {
    if (phase !== 'eval') return;
    if (!roles.length || !isEvaluationComplete(roles)) return;
    const nextRows = buildRankedRows(roles, 'next');
    setPhase('ranked');
    setRankedRows(nextRows);
    persistProgress({ phase: 'ranked', roles, rankedRows: nextRows });
    fireProfileCreatedConfetti();
  }, [roles, phase, persistProgress]);

  const handleOpenStepDetails = useCallback(
    async (role) => {
      const step = role?.step && typeof role.step === 'object' ? role.step : role;
      const escoId = step?.escoId || role?.escoId;
      if (!escoId) return;
      await persistProgress({ wizardPaused: true }, { flush: true });
      onClose?.();
      navigate(`/role/${encodeURIComponent(escoId)}`);
    },
    [navigate, onClose, persistProgress]
  );

  const handlePlanPath = useCallback(
    async (role) => {
      const step = role?.step && typeof role.step === 'object' ? role.step : role;
      if (!step) return;
      await persistProgress({ wizardPaused: true }, { flush: true });
      onClose?.();
      navigateToCareerPathPlanning({ role: step, navigate });
    },
    [navigate, onClose, persistProgress]
  );

  const handleReorderRankedRoles = useCallback((reorderedRows) => {
    if (!Array.isArray(reorderedRows) || !reorderedRows.length) return;
    let nextRoles = null;
    setRoles((prev) => {
      const byId = new Map(prev.map((role) => [role.id, role]));
      const mapped = reorderedRows
        .map((row) => {
          const existing = byId.get(row.id);
          if (!existing) return null;
          return {
            ...existing,
            userEvaluation: row.userEvaluation,
          };
        })
        .filter(Boolean);
      nextRoles = mapped.length ? mapped : prev;
      return nextRoles;
    });
    const nextRanked = reorderedRows.map((row, index) => ({
      ...row,
      finalRank: index + 1,
    }));
    setRankedRows(nextRanked);
    persistProgress({
      phase: 'ranked',
      roles: nextRoles?.length ? nextRoles : rolesRef.current,
      rankedRows: nextRanked,
    });
  }, [persistProgress]);

  const loading =
    open
    && (sessionQuery.isLoading || enriching)
    && !enrichError
    && phase === 'eval';
  const showError = open && (sessionQuery.isError || Boolean(enrichError));
  const showEmpty = open && !loading && !showError && totalRoles === 0;

  const renderTitle = () => (
    <Typography
      variant="h6"
      component="span"
      sx={{ display: 'block', fontWeight: 600, lineHeight: 1.3 }}
    >
      <CelebrationOutlinedIcon sx={{ mr: 1, verticalAlign: 'middle' }} aria-hidden />
      {phase === 'ranked'
        ? t('careerIdentity.exploration.rankingTitle')
        : t('careerIdentity.exploration.discoverTitle')}
    </Typography>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 2 }}>
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary">
            {t('careerIdentity.exploration.preparingRoles')}
          </Typography>
        </Box>
      );
    }

    if (showError) {
      return (
        <Typography color="error">
          {enrichError
            || sessionQuery.error?.message
            || t('careerIdentity.exploration.loadError')}
        </Typography>
      );
    }

    if (showEmpty) {
      return (
        <Typography color="text.secondary">
          {t('careerIdentity.exploration.empty')}
        </Typography>
      );
    }

    if (phase === 'ranked' && Array.isArray(rankedRows)) {
      return (
        <RankedGroupsView
          rankedRows={rankedRows}
          rankCategoryLabel={t('careerIdentity.exploration.rankCategoryLabel')}
          categoryKey="nextSteps"
          rankingDescription={t('careerIdentity.exploration.rankingDescription')}
          simulationIdForCards={`exploration-${sessionId || 'session'}`}
          onOpenStepDetails={handleOpenStepDetails}
          onPlanPath={handlePlanPath}
          onReorderRankedRoles={handleReorderRankedRoles}
        />
      );
    }

    if (!currentRole) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      );
    }

    return (
      <>
        <Typography variant="body2" color="text.secondary">
          {t('careerIdentity.exploration.roleIntro')}
        </Typography>
        <Box ref={swipeStageRef} sx={{ position: 'relative', overflow: 'visible' }}>
          <RoleEvaluationCard
            key={currentRole.id}
            role={currentRole}
            categoryKey="nextSteps"
            inlineDetails
            stickyTop={0}
            simulationIdForCards={`exploration-${sessionId || 'session'}`}
            onEvaluate={handleEvaluate}
            showEvalNudge
            getButtonNudgeSx={evalNudge.getButtonNudgeSx}
            nudgeInteractionHandlers={evalNudge.interactionHandlers}
            swipeStageRef={swipeStageRef}
            expandSwipeToPanel
          />
        </Box>
      </>
    );
  };

  const handleFinishComplete = useCallback(async () => {
    // Snapshot synchronously before close/reset — awaiting persist here previously
    // allowed roles state to clear before onComplete, so simulation merge got [].
    const sessionSnapshot = sessionId;
    const rolesSnapshot = Array.isArray(rolesRef.current) ? rolesRef.current.slice() : [];
    const rankedSnapshot = Array.isArray(rankedRowsRef.current)
      ? rankedRowsRef.current.slice()
      : rankedRowsRef.current;

    let rolesForMerge = rolesSnapshot.filter((role) => role && role.userEvaluation != null);
    if (!rolesForMerge.length && Array.isArray(rankedSnapshot)) {
      rolesForMerge = rankedSnapshot.filter((row) => row && row.userEvaluation != null);
    }

    if (typeof onComplete === 'function') {
      try {
        await onComplete({
          sessionId: sessionSnapshot,
          roles: rolesForMerge,
          rankedRows: rankedSnapshot,
        });
      } catch (err) {
        console.warn('Exploration onComplete handoff failed:', err);
      }
    }
    onClose?.();

    // Draft progress is cleared by mark-seen. Cancel pending puts so a late ranking
    // write cannot race after consume; merge already received the role snapshot above.
    cancelPersistExplorationRankingProgress();
  }, [onComplete, sessionId, onClose]);

  const handleRequestClose = useCallback(() => {
    if (phase === 'ranked') {
      handleFinishComplete();
      return;
    }
    if (hasRankingProgress) {
      setPauseDialogOpen(true);
      return;
    }
    onClose?.();
  }, [phase, hasRankingProgress, handleFinishComplete, onClose]);

  const handleSaveAndExit = useCallback(async () => {
    setPauseDialogOpen(false);
    await persistProgress({ wizardPaused: true }, { flush: true });
    onClose?.();
  }, [persistProgress, onClose]);

  const actions = (
    <Button onClick={handleRequestClose}>
      {phase === 'ranked'
        ? t('careerIdentity.exploration.done')
        : t('careerIdentity.exploration.close')}
    </Button>
  );

  return (
    <>
      <SimulationWizardDialog
        open={open}
        currentStep={Math.max(1, progressStep || 1)}
        totalSteps={Math.max(1, totalRoles || 1)}
        title={renderTitle()}
        actions={actions}
      >
        {renderContent()}
      </SimulationWizardDialog>

      <SimulationWizardPauseDialog
        open={pauseDialogOpen}
        onStay={() => setPauseDialogOpen(false)}
        onSaveAndExit={handleSaveAndExit}
      />
    </>
  );
}
