import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  LinearProgress,
  Typography,
  CircularProgress,
} from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CelebrationOutlinedIcon from '@mui/icons-material/CelebrationOutlined';
import { useTranslation } from 'react-i18next';
import SimulationWizardDialog from './SimulationWizardDialog';
import SimulationWizardPauseDialog from './SimulationWizardPauseDialog';
import { RoleEvaluationCard } from './SimulationCategoryEvaluation';
import { EVALUATION_ROLES_TARGET, getEvalQueue } from '../../utils/simulationRoleRanking';
import {
  getRoleIndexForNextWizardStep,
  getRoleIndexForOotbWizardStep,
  NEXT_SIMULATION_WIZARD_TOTAL,
  NEXT_WIZARD_LOADING_STEP,
  NEXT_WIZARD_FIRST_ROLE_STEP,
  NEXT_WIZARD_LAST_ROLE_STEP,
  NEXT_WIZARD_OOTB_CHOICE_STEP,
  OOTB_SIMULATION_WIZARD_TOTAL,
} from '../../utils/simulationWizardSteps';
import { fireProfileCreatedConfetti } from '../../utils/profileCreatedConfetti';
import { useEvalActionNudge, EVAL_RATING_NUDGE_BUTTON_KEYS } from '../../hooks/useEvalActionNudge';

function WizardRoleEvaluationSection({
  intro,
  role,
  categoryKey,
  simulationIdForCards,
  isViewingSavedSimulation,
  savedSimulationId,
  onEvaluate,
  guardedNavigate,
  evalNudge,
}) {
  const swipeStageRef = useRef(null);

  return (
    <>
      <Typography variant="body2" color="text.secondary">
        {intro}
      </Typography>
      <Box ref={swipeStageRef} sx={{ position: 'relative', overflow: 'visible' }}>
        <RoleEvaluationCard
          key={role.id}
          role={role}
          categoryKey={categoryKey}
          inlineDetails
          stickyTop={0}
          simulationIdForCards={simulationIdForCards}
          isViewingSavedSimulation={isViewingSavedSimulation}
          savedSimulationId={savedSimulationId}
          onEvaluate={onEvaluate}
          guardedNavigate={guardedNavigate}
          showEvalNudge
          getButtonNudgeSx={evalNudge.getButtonNudgeSx}
          nudgeInteractionHandlers={evalNudge.interactionHandlers}
          swipeStageRef={swipeStageRef}
          expandSwipeToPanel
        />
      </Box>
    </>
  );
}

function SimulationWizardStepTitle({ children }) {
  return (
    <Typography
      variant="h6"
      component="span"
      sx={{ display: 'block', fontWeight: 600, lineHeight: 1.3 }}
    >
      {children}
    </Typography>
  );
}

/**
 * Step-by-step simulation evaluation panel (loading → NEXT roles → OOTB choice → OOTB roles).
 */
export default function SimulationStartWizard({
  open,
  phase,
  step,
  simLoading,
  simulationJobState,
  simulationProgress,
  evaluationFlow,
  simError,
  onDismissError,
  onEvaluateNext,
  onEvaluateOotb,
  onSkipOotb,
  onContinueOotb,
  onPauseAndExit,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards = null,
}) {
  const { t } = useTranslation('dashboard');
  const prevStepRef = useRef(null);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const totalSteps = phase === 'ootb' ? OOTB_SIMULATION_WIZARD_TOTAL : NEXT_SIMULATION_WIZARD_TOTAL;
  const showExitRanking =
    (phase === 'ootb' && step >= 1)
    || (phase === 'next' && step > NEXT_WIZARD_LOADING_STEP);

  const isRoleRatingStep =
    (phase === 'next'
      && step >= NEXT_WIZARD_FIRST_ROLE_STEP
      && step <= NEXT_WIZARD_LAST_ROLE_STEP)
    || phase === 'ootb';
  const evalNudge = useEvalActionNudge({
    enabled: open && isRoleRatingStep,
    buttonKeys: EVAL_RATING_NUDGE_BUTTON_KEYS,
  });

  useEffect(() => {
    if (
      phase === 'next'
      && step === 2
      && prevStepRef.current === NEXT_WIZARD_LOADING_STEP
      && !simLoading
    ) {
      fireProfileCreatedConfetti();
    }
    prevStepRef.current = step;
  }, [phase, step, simLoading]);

  const renderTitle = () => {
    if (phase === 'ootb') {
      return (
        <SimulationWizardStepTitle>
          <ExploreOutlinedIcon sx={{ mr: 1, verticalAlign: 'middle' }} aria-hidden />
          {t('simulation.wizard.ootbRoleTitle')}
        </SimulationWizardStepTitle>
      );
    }

    if (step === NEXT_WIZARD_LOADING_STEP) {
      return (
        <SimulationWizardStepTitle>
          <ExtensionIcon sx={{ mr: 1, verticalAlign: 'middle' }} aria-hidden />
          {t('simulation.wizard.loadingTitle')}
        </SimulationWizardStepTitle>
      );
    }

    if (step === NEXT_WIZARD_OOTB_CHOICE_STEP) {
      return (
        <SimulationWizardStepTitle>
          <ExploreOutlinedIcon sx={{ mr: 1, verticalAlign: 'middle' }} aria-hidden />
          {t('simulation.wizard.ootbChoiceTitle')}
        </SimulationWizardStepTitle>
      );
    }

    return (
      <SimulationWizardStepTitle>
        <CelebrationOutlinedIcon sx={{ mr: 1, verticalAlign: 'middle' }} aria-hidden />
        {t('simulation.wizard.nextRoleTitle')}
      </SimulationWizardStepTitle>
    );
  };

  const renderContent = () => {
    if (phase === 'ootb') {
      const roleIndex = getRoleIndexForOotbWizardStep(step);
      const role = getEvalQueue(evaluationFlow, 'outsideTheBox')[roleIndex];
      if (!role) {
        return (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        );
      }
      return (
        <WizardRoleEvaluationSection
          intro={t('simulation.wizard.ootbRoleIntro')}
          role={role}
          categoryKey="outsideTheBox"
          simulationIdForCards={simulationIdForCards}
          isViewingSavedSimulation={isViewingSavedSimulation}
          savedSimulationId={savedSimulationId}
          onEvaluate={(stepId, evaluation) => onEvaluateOotb(stepId, evaluation)}
          guardedNavigate={guardedNavigate}
          evalNudge={evalNudge}
        />
      );
    }

    if (step === NEXT_WIZARD_LOADING_STEP) {
      return (
        <Box sx={{ textAlign: 'center', py: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {simulationJobState === 'queued'
              ? t('simulation.loadingQueued')
              : simulationJobState === 'running'
                ? t('simulation.loadingRunning')
                : t('simulation.wizard.loadingDescription')}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, Math.max(0, simulationProgress))}
            sx={{ height: 8, borderRadius: 999, maxWidth: 440, mx: 'auto' }}
          />
        </Box>
      );
    }

    if (step === NEXT_WIZARD_OOTB_CHOICE_STEP) {
      return (
        <Box sx={{ textAlign: 'center', py: 1 }}>
          <ExploreOutlinedIcon
            sx={{
              fontSize: 48,
              color: 'var(--color-ootb-action)',
              mb: 2,
            }}
          />
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
              onClick={onContinueOotb}
              sx={{ fontWeight: 600, px: 4, py: 1.5 }}
            >
              {t('simulation.evaluationFlow.mobileTransition.continue')}
            </Button>
            <Button
              variant="text"
              color="primary"
              size="medium"
              onClick={onSkipOotb}
              sx={{ fontWeight: 600 }}
            >
              {t('simulation.evaluationFlow.mobileTransition.skipForNow')}
            </Button>
          </Box>
        </Box>
      );
    }

    const roleIndex = getRoleIndexForNextWizardStep(step);
    const role = getEvalQueue(evaluationFlow, 'nextSteps')[roleIndex];
    if (!role) {
      return (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t('simulation.preparingRoleEvaluation')}
          </Typography>
        </Box>
      );
    }

    return (
      <WizardRoleEvaluationSection
        intro={t('simulation.wizard.nextRoleIntro')}
        role={role}
        categoryKey="nextSteps"
        simulationIdForCards={simulationIdForCards}
        isViewingSavedSimulation={isViewingSavedSimulation}
        savedSimulationId={savedSimulationId}
        onEvaluate={(stepId, evaluation) => onEvaluateNext(stepId, evaluation)}
        guardedNavigate={guardedNavigate}
        evalNudge={evalNudge}
      />
    );
  };

  return (
    <>
      <SimulationWizardDialog
        open={open}
        currentStep={step}
        totalSteps={totalSteps}
        title={renderTitle()}
        error={simError}
        onDismissError={onDismissError}
        actions={
          showExitRanking ? (
            <Button onClick={() => setPauseDialogOpen(true)}>
              {t('documentUpload.common.cancel', { ns: 'onboarding' })}
            </Button>
          ) : null
        }
      >
        {renderContent()}
      </SimulationWizardDialog>

      <SimulationWizardPauseDialog
        open={pauseDialogOpen}
        onStay={() => setPauseDialogOpen(false)}
        onSaveAndExit={() => {
          setPauseDialogOpen(false);
          onPauseAndExit();
        }}
      />
    </>
  );
}
