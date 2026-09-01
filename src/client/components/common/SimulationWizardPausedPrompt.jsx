import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import { useTranslation } from 'react-i18next';
import {
  EVALUATION_ROLES_TARGET,
  countEvaluatedRoles,
  isEvaluationComplete,
  isMobileOutsideTheBoxUnlocked,
  getEvalQueue,
} from '../../utils/simulationRoleRanking';
import { NEXT_WIZARD_OOTB_CHOICE_STEP } from '../../utils/simulationWizardSteps';

/**
 * Shown on the results page when the user paused the ranking wizard mid-flow.
 */
export default function SimulationWizardPausedPrompt({ evaluationFlow, onResume }) {
  const { t } = useTranslation('dashboard');

  const nextQueue = getEvalQueue(evaluationFlow, 'nextSteps');
  const ootbQueue = getEvalQueue(evaluationFlow, 'outsideTheBox');
  const nextComplete = isEvaluationComplete(nextQueue);
  const ootbUnlocked = isMobileOutsideTheBoxUnlocked(evaluationFlow);
  const nextEvaluated = countEvaluatedRoles(nextQueue);
  const ootbEvaluated = countEvaluatedRoles(ootbQueue);

  let descriptionKey = 'simulation.wizard.pausedPrompt.descriptionNext';
  let descriptionValues = {
    evaluated: nextEvaluated,
    total: EVALUATION_ROLES_TARGET,
  };

  if (nextComplete && !ootbUnlocked) {
    descriptionKey = 'simulation.wizard.pausedPrompt.descriptionOotbChoice';
    descriptionValues = { count: EVALUATION_ROLES_TARGET };
  } else if (ootbUnlocked) {
    descriptionKey = 'simulation.wizard.pausedPrompt.descriptionOotb';
    descriptionValues = {
      evaluated: ootbEvaluated,
      total: EVALUATION_ROLES_TARGET,
    };
  }

  return (
    <Box
      sx={{
        mb: 4,
        p: { xs: 2.5, sm: 3 },
        borderRadius: 2,
        bgcolor: 'var(--color-ranking-panel-bg)',
        boxShadow: (theme) => theme.shadows[1],
        borderLeft: '6px solid var(--color-primary)',
      }}
    >
      <PauseCircleOutlineIcon
        sx={{ fontSize: 40, color: 'primary.main', mb: 1.5 }}
        aria-hidden
      />
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
        {t('simulation.wizard.pausedPrompt.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(descriptionKey, descriptionValues)}
      </Typography>
      <Button
        variant="contained"
        color="primary"
        size="medium"
        endIcon={<ArrowForwardIcon />}
        onClick={onResume}
        sx={{ fontWeight: 600, px: 3, py: 1.25 }}
      >
        {t('simulation.wizard.pausedPrompt.resume')}
      </Button>
    </Box>
  );
}
