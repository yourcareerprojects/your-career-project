import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  CircularProgress,
  Button,
  Alert,
  Paper,
  IconButton,
  Tooltip,
} from '@mui/material';
import { ArrowBack, Route as RouteIcon } from '@mui/icons-material';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CareerStepRoleInsightsCard,
  CareerStepRoleDetailsCard,
  CareerStepRoleDescriptionCard,
} from '../common/CareerStepRoleSections';
import { getRoleTitleForLocale } from '../../utils/roleTitleDisplay';
import { navigateToCareerPathPlanning } from '../../utils/careerPathPlanningSession';

const EXPLORE_ROLES_PATH = '/explore-roles';

const RoleDetails = () => {
  const { t } = useTranslation('dashboard');
  const { i18n } = useTranslation();
  const { escoId: escoIdParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const escoId = decodeURIComponent(escoIdParam || '');
  const currentLang = i18n.resolvedLanguage || i18n.language || 'en';

  const [occupation, setOccupation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [escoId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!escoId) {
        setError(t('roleSearch.errors.roleNotFound'));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const qs = new URLSearchParams({ escoId, lang: currentLang });
        const res = await fetch(`/api/occupations/lookup?${qs.toString()}`);
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok || !data.success || !data.occupation) {
          setError(t('roleSearch.errors.roleNotFound'));
          setOccupation(null);
        } else {
          setOccupation({ ...data.occupation, _localizedLang: currentLang });
        }
      } catch {
        if (!cancelled) {
          setError(t('roleSearch.errors.loadFailed'));
          setOccupation(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [escoId, currentLang, t]);

  const handleBack = () => {
    const returnTo = location.state?.returnTo;
    if (
      typeof returnTo === 'string' &&
      (returnTo === EXPLORE_ROLES_PATH || returnTo.startsWith(`${EXPLORE_ROLES_PATH}?`))
    ) {
      navigate(returnTo);
      return;
    }
    navigate(EXPLORE_ROLES_PATH);
  };

  const handlePlanPath = () => {
    if (!occupation) return;
    navigateToCareerPathPlanning({ role: occupation, navigate });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !occupation) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error || t('roleSearch.errors.roleNotFound')}
        </Alert>
        <Button variant="contained" onClick={handleBack}>
          {t('roleSearch.actions.backToSearch')}
        </Button>
      </Box>
    );
  }

  const titleText = getRoleTitleForLocale(occupation.title, currentLang);
  const descriptionText = getRoleTitleForLocale(occupation.description, currentLang);

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Paper
        sx={{
          mb: 3,
          backgroundColor: 'var(--color-detail-header-bg)',
          color: 'var(--color-detail-header-fg)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Tooltip title={t('roleSearch.actions.backToSearch')}>
                <IconButton
                  onClick={handleBack}
                  sx={{
                    color: 'var(--color-detail-header-actions-fg)',
                    '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' },
                  }}
                >
                  <ArrowBack />
                </IconButton>
              </Tooltip>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', wordBreak: 'break-word' }}>
                {titleText}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<RouteIcon />}
              onClick={handlePlanPath}
              sx={{
                backgroundColor: 'var(--color-detail-header-fg)',
                color: 'var(--color-detail-header-bg)',
                '&:hover': {
                  backgroundColor: 'var(--color-detail-header-fg)',
                  opacity: 0.9,
                },
              }}
            >
              {t('careerPathPlanning.actions.planPath')}
            </Button>
          </Box>
        </Box>
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <CareerStepRoleDescriptionCard
            description={descriptionText}
            showWorkIcon={false}
            emphasizeFirstParagraph={false}
          />
        </Grid>

        <Grid item xs={12} lg={4}>
          <CareerStepRoleInsightsCard stepDetails={occupation} />
          <CareerStepRoleDetailsCard stepDetails={occupation} />
        </Grid>
      </Grid>

    </Box>
  );
};

export default RoleDetails;
