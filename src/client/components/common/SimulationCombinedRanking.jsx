import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { RankedGroupsView } from './SimulationCategoryEvaluation';
import {
  buildCombinedRankedRows,
  resolveRankedRowSourceCategoryKey,
} from '../../utils/simulationRoleRanking';

/**
 * Single ranking view merging next-role and outside-the-box results by Keep / Skip / Dislike.
 */
export default function SimulationCombinedRanking({
  evaluationFlow,
  onReorderCombinedRankedRoles,
  isStepSaved,
  isStepSaving,
  onToggleSave,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
}) {
  const { t } = useTranslation('dashboard');
  const combinedRows = useMemo(
    () => buildCombinedRankedRows(evaluationFlow),
    [evaluationFlow]
  );

  if (!combinedRows.length) return null;

  return (
    <Box
      sx={{
        mb: 4,
        p: { xs: 2, sm: 2.5, md: 3 },
        borderRadius: 2,
        bgcolor: 'var(--color-ranking-panel-bg)',
        boxShadow: (theme) => theme.shadows[1],
      }}
    >
      <Typography
        variant="h4"
        component="h2"
        sx={{
          fontWeight: 'bold',
          mb: 2,
          typography: { xs: 'h5', sm: 'h4' },
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}
      >
        {t('simulation.evaluationFlow.combinedRankingTitle')}
      </Typography>
      <RankedGroupsView
        rankedRows={combinedRows}
        rankCategoryLabel={t('simulation.evaluationFlow.combinedRankingTitle')}
        categoryKey="nextSteps"
        rankingDescription={t('simulation.evaluationFlow.combinedFinalRankingDescription')}
        resolveRowCategoryKey={resolveRankedRowSourceCategoryKey}
        rankingStorageCategoryKey="combined"
        isStepSaved={isStepSaved}
        isStepSaving={isStepSaving}
        onToggleSave={onToggleSave}
        guardedNavigate={guardedNavigate}
        isViewingSavedSimulation={isViewingSavedSimulation}
        savedSimulationId={savedSimulationId}
        simulationIdForCards={simulationIdForCards}
        onReorderRankedRoles={onReorderCombinedRankedRoles}
      />
    </Box>
  );
}
