import React, { useCallback, useEffect, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { RankedGroupsView } from './SimulationCategoryEvaluation';
import { buildCombinedRankedRows } from '../../utils/simulationRoleRanking';
import {
  buildCombinedRankingSeenRolesKey,
  getCombinedRankingRowId,
  getCombinedRankingVisitBaseline,
  resolveCombinedRankingAccentCategoryKey,
  trackCombinedRankingRolesForVisit,
  flushCombinedRankingVisitAcknowledgements,
} from '../../utils/combinedRankingRoleAccent';

/**
 * Single ranking view merging next-role and outside-the-box results by Keep / Skip / Dislike.
 * Accents: green = roles already on the board; red = newly appeared (until full reload).
 */
export default function SimulationCombinedRanking({
  evaluationFlow,
  onReorderCombinedRankedRoles,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
  onPlanPath,
}) {
  const { t } = useTranslation('dashboard');
  const combinedRows = useMemo(
    () => buildCombinedRankedRows(evaluationFlow),
    [evaluationFlow]
  );

  const storageKey = useMemo(
    () =>
      buildCombinedRankingSeenRolesKey({
        isViewingSavedSimulation,
        savedSimulationId,
        simulationIdForCards,
      }),
    [isViewingSavedSimulation, savedSimulationId, simulationIdForCards]
  );

  // Sticky tab-session baseline (survives SPA remounts); localStorage updates on unload only.
  useEffect(() => {
    const ids = combinedRows.map(getCombinedRankingRowId).filter(Boolean);
    if (!ids.length) return;
    trackCombinedRankingRolesForVisit(storageKey, ids);
  }, [combinedRows, storageKey]);

  // Persist pending ids when leaving this view (SPA or reload). Sticky baseline stays put
  // so navigate-away/back keeps new roles red until a full page reload.
  useEffect(() => () => {
    flushCombinedRankingVisitAcknowledgements();
  }, []);

  const resolveRowCategoryKey = useCallback(
    (row) =>
      resolveCombinedRankingAccentCategoryKey(
        row,
        getCombinedRankingVisitBaseline(storageKey)
      ),
    [storageKey]
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
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t('simulation.evaluationFlow.combinedRankingTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('simulation.evaluationFlow.combinedFinalRankingDescription')}
      </Typography>
      <RankedGroupsView
        rankedRows={combinedRows}
        categoryKey="nextSteps"
        showRankingDescription={false}
        resolveRowCategoryKey={resolveRowCategoryKey}
        guardedNavigate={guardedNavigate}
        isViewingSavedSimulation={isViewingSavedSimulation}
        savedSimulationId={savedSimulationId}
        simulationIdForCards={simulationIdForCards}
        onReorderRankedRoles={onReorderCombinedRankedRoles}
        onPlanPath={onPlanPath}
      />
    </Box>
  );
}
