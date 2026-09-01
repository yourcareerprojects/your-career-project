import React from 'react';
import {
  Box,
  Button,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import { useTranslation } from 'react-i18next';
import SimulationCategoryEvaluation from './SimulationCategoryEvaluation';
import SimulationCombinedRanking from './SimulationCombinedRanking';
import {
  EVALUATION_ROLES_TARGET,
  areBothSimulationRankingsComplete,
  getMobileEvaluationView,
  isOutsideTheBoxDeferred,
  MOBILE_EVAL_VIEWS,
  getEvalQueue,
  getRankedBoard,
} from '../../utils/simulationRoleRanking';

function OutsideTheBoxPhaseTransition({ onContinue, onSkip }) {
  const { t } = useTranslation('dashboard');

  return (
    <Box
      sx={{
        mb: 4,
        p: { xs: 3, sm: 4 },
        borderRadius: 2,
        textAlign: 'center',
        bgcolor: 'var(--color-ranking-panel-bg)',
        boxShadow: (theme) => theme.shadows[1],
      }}
    >
      <ExploreOutlinedIcon
        sx={{
          fontSize: 48,
          color: 'var(--color-ootb-action)',
          mb: 2,
        }}
      />
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>
        {t('simulation.evaluationFlow.mobileTransition.title')}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 480, mx: 'auto' }}>
        {t('simulation.evaluationFlow.mobileTransition.description', {
          count: EVALUATION_ROLES_TARGET,
        })}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Button
          variant="contained"
          color="primary"
          size="large"
          endIcon={<ArrowForwardIcon />}
          onClick={onContinue}
          sx={{ fontWeight: 600, px: 4, py: 1.5 }}
        >
          {t('simulation.evaluationFlow.mobileTransition.continue')}
        </Button>
        <Button
          variant="text"
          color="primary"
          size="medium"
          onClick={onSkip}
          sx={{ fontWeight: 600 }}
        >
          {t('simulation.evaluationFlow.mobileTransition.skipForNow')}
        </Button>
      </Box>
    </Box>
  );
}

function OutsideTheBoxDeferredPrompt({ onResume, roleCount }) {
  const { t } = useTranslation('dashboard');

  return (
    <Box
      sx={{
        mb: 4,
        p: { xs: 2.5, sm: 3 },
        borderRadius: 2,
        bgcolor: 'var(--color-ranking-panel-bg)',
        boxShadow: (theme) => theme.shadows[1],
        borderLeft: '6px solid var(--color-ootb-action)',
      }}
    >
      <Typography variant="h6" component="h3" sx={{ fontWeight: 700, mb: 1 }}>
        {t('simulation.evaluationFlow.deferredOotb.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('simulation.evaluationFlow.deferredOotb.description', { count: roleCount })}
      </Typography>
      <Button
        variant="contained"
        color="inherit"
        size="medium"
        endIcon={<ArrowForwardIcon />}
        onClick={onResume}
        sx={{
          fontWeight: 600,
          px: 3,
          py: 1.25,
          bgcolor: 'var(--color-ootb-action)',
          color: 'var(--color-ootb-action-contrast)',
          '&:hover': { bgcolor: 'var(--color-ootb-action-hover)' },
        }}
      >
        {t('simulation.evaluationFlow.deferredOotb.resume')}
      </Button>
    </Box>
  );
}

/**
 * Renders next-role and outside-the-box evaluation sections in two sequential phases
 * with a transition screen between them. Card batch size (1 vs 3) follows viewport width.
 */
export default function SimulationEvaluationFlow({
  evaluationFlow,
  onUnlockMobileOutsideTheBox,
  onSkipOutsideTheBox,
  onResumeOutsideTheBox,
  nextStepsTitle,
  outsideTheBoxTitle,
  onEvaluate,
  onSeeRanking,
  onReorderRankedRoles,
  onReorderCombinedRankedRoles,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
  nextStepsProfileRecommendation = null,
  outsideTheBoxProfileRecommendation = null,
  onPlanPath,
}) {
  const phaseView = getMobileEvaluationView(evaluationFlow);
  const showCombinedRanking = areBothSimulationRankingsComplete(evaluationFlow);

  if (showCombinedRanking) {
    return (
      <SimulationCombinedRanking
        evaluationFlow={evaluationFlow}
        onReorderCombinedRankedRoles={onReorderCombinedRankedRoles}
        guardedNavigate={guardedNavigate}
        isViewingSavedSimulation={isViewingSavedSimulation}
        savedSimulationId={savedSimulationId}
        simulationIdForCards={simulationIdForCards}
        onPlanPath={onPlanPath}
      />
    );
  }

  const showNextSteps =
    phaseView === MOBILE_EVAL_VIEWS.NEXT_ONLY
    || phaseView === MOBILE_EVAL_VIEWS.BOTH;
  const showTransition = phaseView === MOBILE_EVAL_VIEWS.TRANSITION;
  const showOutsideTheBox =
    phaseView === MOBILE_EVAL_VIEWS.OOTB_ONLY
    || phaseView === MOBILE_EVAL_VIEWS.BOTH;
  const showDeferredOotbPrompt =
    isOutsideTheBoxDeferred(evaluationFlow)
    && evaluationFlow.phases?.nextSteps === 'ranked';

  return (
    <>
      {showNextSteps ? (
        <>
          {nextStepsProfileRecommendation}
          <SimulationCategoryEvaluation
            title={nextStepsTitle}
            categoryKey="nextSteps"
            roles={getEvalQueue(evaluationFlow, 'nextSteps')}
            phase={evaluationFlow.phases?.nextSteps || 'eval'}
            rankedRows={getRankedBoard(evaluationFlow, 'nextSteps')}
            hasStarted={!!evaluationFlow.hasStarted?.nextSteps}
            onEvaluate={(stepId, evaluation) => onEvaluate('nextSteps', stepId, evaluation)}
            onSeeRanking={() => onSeeRanking('nextSteps')}
            onReorderRankedRoles={(rows) => onReorderRankedRoles('nextSteps', rows)}
            guardedNavigate={guardedNavigate}
            isViewingSavedSimulation={isViewingSavedSimulation}
            savedSimulationId={savedSimulationId}
            simulationIdForCards={simulationIdForCards}
            onPlanPath={onPlanPath}
          />
        </>
      ) : null}
      {showDeferredOotbPrompt ? (
        <OutsideTheBoxDeferredPrompt
          roleCount={getEvalQueue(evaluationFlow, 'outsideTheBox').length || EVALUATION_ROLES_TARGET}
          onResume={onResumeOutsideTheBox}
        />
      ) : null}
      {showTransition ? (
        <OutsideTheBoxPhaseTransition
          onContinue={onUnlockMobileOutsideTheBox}
          onSkip={onSkipOutsideTheBox}
        />
      ) : null}
      {showOutsideTheBox ? (
        <>
          {outsideTheBoxProfileRecommendation}
          <SimulationCategoryEvaluation
            title={outsideTheBoxTitle}
            categoryKey="outsideTheBox"
            roles={getEvalQueue(evaluationFlow, 'outsideTheBox')}
            phase={evaluationFlow.phases?.outsideTheBox || 'eval'}
            rankedRows={getRankedBoard(evaluationFlow, 'outsideTheBox')}
            hasStarted={!!evaluationFlow.hasStarted?.outsideTheBox}
            onEvaluate={(stepId, evaluation) => onEvaluate('outsideTheBox', stepId, evaluation)}
            onSeeRanking={() => onSeeRanking('outsideTheBox')}
            onReorderRankedRoles={(rows) => onReorderRankedRoles('outsideTheBox', rows)}
            guardedNavigate={guardedNavigate}
            isViewingSavedSimulation={isViewingSavedSimulation}
            savedSimulationId={savedSimulationId}
            simulationIdForCards={simulationIdForCards}
            onPlanPath={onPlanPath}
          />
        </>
      ) : null}
    </>
  );
}
