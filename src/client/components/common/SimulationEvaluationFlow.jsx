import React from 'react';
import {
  Box,
  Button,
  Divider,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import { useTranslation } from 'react-i18next';
import SimulationCategoryEvaluation from './SimulationCategoryEvaluation';
import {
  EVALUATION_ROLES_TARGET,
  getMobileEvaluationView,
  MOBILE_EVAL_VIEWS,
} from '../../utils/simulationRoleRanking';

function MobileOutsideTheBoxTransition({ onContinue }) {
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
    </Box>
  );
}

/**
 * Renders next-role and outside-the-box evaluation sections.
 * On mobile, sequences the two categories with a transition screen between them.
 */
export default function SimulationEvaluationFlow({
  evaluationFlow,
  onUnlockMobileOutsideTheBox,
  nextStepsTitle,
  outsideTheBoxTitle,
  onEvaluate,
  onSeeRanking,
  onEditRatings,
  onReorderRankedRoles,
  isStepSaved,
  isStepSaving,
  onToggleSave,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
  nextStepsProfileRecommendation = null,
  outsideTheBoxProfileRecommendation = null,
}) {
  const theme = useTheme();
  const isMobileViewport = useMediaQuery(theme.breakpoints.down('sm'));
  const mobileView = getMobileEvaluationView(evaluationFlow);

  const showNextSteps =
    !isMobileViewport
    || mobileView === MOBILE_EVAL_VIEWS.NEXT_ONLY
    || mobileView === MOBILE_EVAL_VIEWS.BOTH;
  const showTransition = isMobileViewport && mobileView === MOBILE_EVAL_VIEWS.TRANSITION;
  const showOutsideTheBox =
    !isMobileViewport
    || mobileView === MOBILE_EVAL_VIEWS.OOTB_ONLY
    || mobileView === MOBILE_EVAL_VIEWS.BOTH;
  const showDivider =
    !isMobileViewport
    || mobileView === MOBILE_EVAL_VIEWS.BOTH;

  const nextStepsSection = showNextSteps ? (
    <>
      {nextStepsProfileRecommendation}
      <SimulationCategoryEvaluation
        title={nextStepsTitle}
        categoryKey="nextSteps"
        roles={evaluationFlow.nextSteps}
        phase={evaluationFlow.phases?.nextSteps || 'eval'}
        rankedRows={evaluationFlow.ranked?.nextSteps}
        hasStarted={!!evaluationFlow.hasStarted?.nextSteps}
        onEvaluate={(stepId, evaluation) => onEvaluate('nextSteps', stepId, evaluation)}
        onSeeRanking={() => onSeeRanking('nextSteps')}
        onEditRatings={() => onEditRatings('nextSteps')}
        onReorderRankedRoles={(rows) => onReorderRankedRoles('nextSteps', rows)}
        isStepSaved={isStepSaved}
        isStepSaving={isStepSaving}
        onToggleSave={onToggleSave}
        guardedNavigate={guardedNavigate}
        isViewingSavedSimulation={isViewingSavedSimulation}
        savedSimulationId={savedSimulationId}
        simulationIdForCards={simulationIdForCards}
      />
    </>
  ) : null;

  const outsideTheBoxSection = showOutsideTheBox ? (
    <>
      {outsideTheBoxProfileRecommendation}
      <SimulationCategoryEvaluation
        title={outsideTheBoxTitle}
        categoryKey="outsideTheBox"
        roles={evaluationFlow.outsideTheBox}
        phase={evaluationFlow.phases?.outsideTheBox || 'eval'}
        rankedRows={evaluationFlow.ranked?.outsideTheBox}
        hasStarted={!!evaluationFlow.hasStarted?.outsideTheBox}
        onEvaluate={(stepId, evaluation) => onEvaluate('outsideTheBox', stepId, evaluation)}
        onSeeRanking={() => onSeeRanking('outsideTheBox')}
        onEditRatings={() => onEditRatings('outsideTheBox')}
        onReorderRankedRoles={(rows) => onReorderRankedRoles('outsideTheBox', rows)}
        isStepSaved={isStepSaved}
        isStepSaving={isStepSaving}
        onToggleSave={onToggleSave}
        guardedNavigate={guardedNavigate}
        isViewingSavedSimulation={isViewingSavedSimulation}
        savedSimulationId={savedSimulationId}
        simulationIdForCards={simulationIdForCards}
      />
    </>
  ) : null;

  return (
    <>
      {nextStepsSection}
      {showTransition ? (
        <MobileOutsideTheBoxTransition onContinue={onUnlockMobileOutsideTheBox} />
      ) : null}
      {showDivider && nextStepsSection && outsideTheBoxSection ? <Divider sx={{ my: 4 }} /> : null}
      {outsideTheBoxSection}
    </>
  );
}
