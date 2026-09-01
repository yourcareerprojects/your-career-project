import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import PageHeader from '../common/PageHeader';
import { useUserHistoryQuery } from '../../hooks/useProfileQueries';
import { getRoleTitleForLocale } from '../../utils/roleTitleDisplay';

/**
 * @param {string|Date} iso
 * @returns {string} mm/yyyy
 */
function formatMonthYear(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${year}`;
}

/**
 * @param {object} activity
 * @param {Function} t
 * @param {string} lang
 * @returns {string}
 */
function activityLabel(activity, t, lang) {
  const type = activity?.type || activity?.summaryKey;
  const meta = activity?.meta || {};

  switch (type) {
    case 'profile_section_updated': {
      const sectionKey = meta.section
        ? `history.activities.sections.${meta.section}`
        : null;
      const sectionLabel = sectionKey && t(sectionKey, { defaultValue: '' })
        ? t(sectionKey)
        : null;
      return sectionLabel
        ? t('history.activities.profile_section_updated_with_section', { section: sectionLabel })
        : t('history.activities.profile_section_updated');
    }
    case 'document_uploaded':
      return meta.documentName
        ? t('history.activities.document_uploaded_named', { name: meta.documentName })
        : t('history.activities.document_uploaded');
    case 'simulation_completed':
      return t('history.activities.simulation_completed');
    case 'simulation_saved':
      return meta.simulationName
        ? t('history.activities.simulation_saved_named', { name: meta.simulationName })
        : t('history.activities.simulation_saved');
    case 'career_step_saved': {
      const title = getRoleTitleForLocale(meta.title, lang);
      return title
        ? t('history.activities.career_step_saved_named', { title })
        : t('history.activities.career_step_saved');
    }
    case 'career_step_evaluated': {
      const title = getRoleTitleForLocale(meta.title, lang);
      const evaluation = meta.userEvaluation
        ? t(`history.activities.evaluations.${meta.userEvaluation}`, {
            defaultValue: meta.userEvaluation,
          })
        : null;
      if (title && evaluation) {
        return t('history.activities.career_step_evaluated_named', { title, evaluation });
      }
      return t('history.activities.career_step_evaluated');
    }
    case 'trait_voted':
      return t('history.activities.trait_voted');
    default:
      return t(`history.activities.${type}`, { defaultValue: type });
  }
}

/**
 * @param {object} milestone
 * @param {Function} t
 * @returns {string}
 */
function milestoneTitle(milestone, t) {
  return t(`history.milestones.${milestone.type}`, {
    defaultValue: milestone.type,
  });
}

const HistoryPage = () => {
  const { t, i18n } = useTranslation('dashboard');
  const lang = (i18n.language || 'en').split('-')[0];
  const historyQuery = useUserHistoryQuery();

  // API returns oldest-first; display newest-first (recent at top, origin at bottom).
  const milestonesNewestFirst = [...(historyQuery.data?.milestones || [])].reverse();
  const recentActivitiesNewestFirst = [...(historyQuery.data?.recentActivities || [])].reverse();

  const renderActivityRow = (activity) => (
    <Box
      key={activity.id}
      sx={{
        position: 'relative',
        pl: { xs: 3.5, sm: 4 },
        mb: 1.5,
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          left: { xs: 7, sm: 11 },
          top: 8,
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: 'action.disabled',
        }}
      />
      <Typography variant="body2" color="text.secondary">
        {activityLabel(activity, t, lang)}
      </Typography>
    </Box>
  );

  const renderMilestone = (milestone) => {
    const roles = milestone.meta?.roles || [];
    // Activities led up to this milestone (older than it) — show newest of those first, below the marker.
    const leadingActivitiesNewestFirst = [...(milestone.activities || [])].reverse();

    return (
      <Box key={milestone.id} sx={{ position: 'relative', mb: 4 }}>
        <Box
          sx={{
            position: 'relative',
            pl: { xs: 3.5, sm: 4 },
            py: 1,
          }}
        >
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              left: { xs: 4, sm: 8 },
              top: 14,
              width: 14,
              height: 14,
              borderRadius: '50%',
              bgcolor: 'var(--color-primary)',
              border: '2px solid',
              borderColor: 'background.paper',
              boxShadow: 1,
            }}
          />
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
              {milestoneTitle(milestone, t)}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMonthYear(milestone.occurredAt)}
            </Typography>
          </Box>
          {milestone.type === 'roles_unlocked' && roles.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
              {roles.map((role, idx) => {
                const title =
                  typeof role === 'string'
                    ? role
                    : getRoleTitleForLocale(role?.title, lang);
                if (!title) return null;
                return (
                  <Typography
                    key={`${milestone.id}-role-${idx}`}
                    component="li"
                    variant="body2"
                    color="text.secondary"
                  >
                    {title}
                  </Typography>
                );
              })}
            </Box>
          )}
        </Box>

        {leadingActivitiesNewestFirst.map(renderActivityRow)}
      </Box>
    );
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <PageHeader
        title={t('history.pageTitle')}
        description={t('history.subtitle')}
      />

      {historyQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {historyQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('history.loadError')}
        </Alert>
      )}

      {!historyQuery.isLoading && !historyQuery.isError && milestonesNewestFirst.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <HistoryIcon sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
          <Typography variant="body1">{t('history.empty')}</Typography>
        </Box>
      )}

      {!historyQuery.isLoading && milestonesNewestFirst.length > 0 && (
        <Box sx={{ position: 'relative', pl: { xs: 2, sm: 3 } }}>
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              left: { xs: 11, sm: 15 },
              top: 8,
              bottom: 8,
              width: 2,
              bgcolor: 'divider',
            }}
          />

          {recentActivitiesNewestFirst.length > 0 && (
            <Box sx={{ position: 'relative', mb: 4 }}>
              <Typography
                variant="subtitle2"
                color="text.secondary"
                sx={{ pl: { xs: 3.5, sm: 4 }, mb: 1.5 }}
              >
                {t('history.recentActivity')}
              </Typography>
              {recentActivitiesNewestFirst.map(renderActivityRow)}
            </Box>
          )}

          {milestonesNewestFirst.map(renderMilestone)}
        </Box>
      )}
    </Box>
  );
};

export default HistoryPage;
