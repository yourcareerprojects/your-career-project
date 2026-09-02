import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Button,
  Alert,
  LinearProgress,
  Paper,
  IconButton,
  Tooltip,
  Snackbar,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  ArrowBack,
  Share,
  Route as RouteIcon
} from '@mui/icons-material';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ShareDialog from './ShareDialog';
import {
  CareerStepRoleInsightsCard,
  CareerStepRoleDetailsCard,
  CareerStepRoleFitCard,
  CareerStepRoleDescriptionCard,
} from '../common/CareerStepRoleSections';
import CareerStepUserEvaluationRow from '../common/CareerStepUserEvaluationRow';
import { getCareerStepMatchScorePercent } from '../../utils/careerStepMatchScore';
import { persistUserEvaluationToSavedSimulation } from '../../utils/persistSimulationEvaluation';
import { schedulePersistLastSimulationProgress } from '../../utils/persistLastSimulationProgress';
import { getSimulationResultDetails, storeSimulationResultDetails } from '../../utils/simulationResultSessionStore';
import { applyUserEvaluationToResultsSnapshot } from '../../utils/simulationEvaluationPropagation';
import {
  getRoleTitleForLocale,
  getRoleTitleEnglishForMatch,
  normalizeTextForI18nMatch,
} from '../../utils/roleTitleDisplay';
import {
  updateLatestSimulationSnapshot,
  loadSimulationDetailContext,
} from '../../utils/simulationPersistence';
import { navigateToCareerPathPlanning } from '../../utils/careerPathPlanningSession';
import localizedContentService from '../../utils/localizedContentService';

const MAX_VISIBLE_SKILL_DOMAINS = 8;

const SimulationResultDetails = () => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { i18n } = useTranslation();
  const theme = useTheme();
  /** Stacked layout (main above sidebar): reorder evaluation between fit and description. */
  const isStackedCareerDetailLayout = useMediaQuery(theme.breakpoints.down('lg'));
  const { resultId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [resultDetails, setResultDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matchScore, setMatchScore] = useState(0);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [evaluationSaving, setEvaluationSaving] = useState(false);
  const [canonicalEscoByKey, setCanonicalEscoByKey] = useState({});
  const currentLang = i18n.resolvedLanguage || i18n.language || 'en';
  const localizeAiText = useCallback(
    (field, missing = '[MISSING]') => localizedContentService.getLocalizedWithFallback(field, currentLang, missing),
    [currentLang]
  );

  // Re-fetch occupation details in active UI language for consistent backend-localized fields.
  useEffect(() => {
    const enrich = async () => {
      if (!resultDetails) return;
      const activeLang = i18n.resolvedLanguage || i18n.language || 'en';
      if (resultDetails._localizedLang === activeLang) return;

      const escoId = resultDetails.escoId;
      const title = resultDetails.title;
      if (!escoId && !title) return;

      try {
        const qs = new URLSearchParams();
        if (escoId) qs.set('escoId', escoId);
        else qs.set('title', title);
        qs.set('lang', activeLang);

        const res = await fetch(`/api/occupations/lookup?${qs.toString()}`);
        const data = await res.json();
        if (res.ok && data?.success && data?.occupation) {
          const occ = data.occupation;
          setResultDetails(prev => {
            const occHasRequired =
              Array.isArray(occ.requiredSkills) && occ.requiredSkills.length > 0;
            const occHasOptional =
              Array.isArray(occ.optionalSkills) && occ.optionalSkills.length > 0;

            let skillModel = prev.skillModel;
            if (skillModel && typeof skillModel === 'object') {
              skillModel = {
                ...skillModel,
                ...(occHasRequired ? { core_skills: [] } : {}),
                ...(occHasOptional ? { optional_skills: [] } : {}),
              };
            }

            const mergedDescription =
              occ.description != null && String(occ.description).trim() !== ''
                ? occ.description
                : prev.description ?? '';

            const mergedRequiredSkills =
              Array.isArray(occ.requiredSkills) && occ.requiredSkills.length > 0
                ? occ.requiredSkills
                : prev.requiredSkills || [];
            const mergedOptionalSkills =
              Array.isArray(occ.optionalSkills) && occ.optionalSkills.length > 0
                ? occ.optionalSkills
                : prev.optionalSkills || [];

            return {
              ...prev,
              // Occupation lookup is authoritative for the requested UI language — do not keep
              // German simulation strings when switching to English (prev||occ was wrong).
              title: occ.title != null ? occ.title : prev.title,
              description: mergedDescription,
              requiredSkills: mergedRequiredSkills,
              optionalSkills: mergedOptionalSkills,
              requiredSkillUris: occ.requiredSkillUris || prev?.requiredSkillUris,
              altTitles: Array.isArray(occ.altTitles) ? occ.altTitles : prev?.altTitles || [],
              hiddenTitles: Array.isArray(occ.hiddenTitles) ? occ.hiddenTitles : prev?.hiddenTitles || [],
              seniority: occ.seniority ?? prev.seniority ?? null,
              keyResponsibilities: occ.keyResponsibilities ?? prev.keyResponsibilities ?? null,
              skillDomains:
                occ.skillDomains != null ? occ.skillDomains : prev.skillDomains ?? [],
              skillModel,
              _localizedLang: activeLang,
            };
          });
        }
      } catch (err) {
        // Silent; UI will just show fallback text
        console.warn('Failed to enrich required skills:', err);
      }
    };

    enrich();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultDetails, i18n.language, i18n.resolvedLanguage]);

  useEffect(() => {
    if (resultDetails) {
      setMatchScore(getCareerStepMatchScorePercent(resultDetails));
    }
  }, [resultDetails]);

  // Debug logging for navigation state
  useEffect(() => {
    console.log('SimulationResultDetails mounted with location state:', location.state);
    console.log('Location pathname:', location.pathname);
    console.log('Location search:', location.search);
  }, [location.state, location.pathname, location.search]);

  const normalizeStorageId = (value) => {
    if (value == null) return '';
    try {
      return decodeURIComponent(String(value)).trim().toLowerCase();
    } catch {
      return String(value).trim().toLowerCase();
    }
  };

  const candidateMatchesRoute = useCallback((candidate, routeId) => {
    if (!candidate || !routeId) return false;
    const candidateIds = [
      candidate.resultId,
      candidate.stepId,
      candidate.id,
      getRoleTitleEnglishForMatch(candidate.title),
    ];
    return candidateIds.some((id) => normalizeStorageId(id) === routeId);
  }, []);

  const roleMatchesCurrentResult = useCallback(
    (role) => {
      if (!role || !resultDetails) return false;
      const targetIds = new Set(
        [resultDetails.resultId, resultDetails.stepId, resultDetails.id, getRoleTitleEnglishForMatch(resultDetails.title)]
          .map(normalizeStorageId)
          .filter(Boolean)
      );
      if (!targetIds.size) return false;
      const roleIds = [
        role.resultId,
        role.stepId,
        role.id,
        role.simulationResultId,
        getRoleTitleEnglishForMatch(role.title),
      ]
        .map(normalizeStorageId)
        .filter(Boolean);
      return roleIds.some((id) => targetIds.has(id));
    },
    [resultDetails]
  );

  const persistEvaluationToSimulationSnapshots = useCallback(
    (nextEvaluation) => {
      try {
        const updated = updateLatestSimulationSnapshot(
          (results) => applyUserEvaluationToResultsSnapshot(
            results,
            nextEvaluation,
            roleMatchesCurrentResult
          ),
          { state: 'modified' }
        );
        if (updated?.results) {
          schedulePersistLastSimulationProgress(updated.results);
        }
      } catch (error) {
        console.warn('Failed to persist evaluation to simulation session storage:', error);
      }
    },
    [roleMatchesCurrentResult]
  );

  const fetchResultDetails = useCallback(async () => {
    try {
      setLoading(true);

      const routeId = normalizeStorageId(resultId);
      const storedResultDataRaw = sessionStorage.getItem('currentResultDetails');
      const storedStepDataRaw = sessionStorage.getItem('currentStepDetails');
      const storedMappedData = getSimulationResultDetails(routeId);

      if (!storedMappedData && !storedResultDataRaw && !storedStepDataRaw) {
        throw new Error(t('details.resultNotFound', { ns: 'dashboard' }));
      }

      const storedResultData = storedResultDataRaw ? JSON.parse(storedResultDataRaw) : null;
      const storedStepData = storedStepDataRaw ? JSON.parse(storedStepDataRaw) : null;

      let data = null;
      if (candidateMatchesRoute(storedMappedData, routeId)) {
        data = storedMappedData;
      } else if (candidateMatchesRoute(storedStepData, routeId)) {
        data = storedStepData;
      } else if (candidateMatchesRoute(storedResultData, routeId)) {
        data = storedResultData;
      } else if (storedStepData) {
        data = storedStepData;
      } else {
        data = storedResultData;
      }

      if (!data) {
        throw new Error(t('details.resultNotFound', { ns: 'dashboard' }));
      }

      setResultDetails(data);
      storeSimulationResultDetails(data, [resultId]);
    } catch (err) {
      setError(t('details.errors.loadResultDetailsFailed', { ns: 'dashboard' }));
      console.error('Error fetching result details:', err);
    } finally {
      setLoading(false);
    }
  }, [candidateMatchesRoute, resultId, t]);

  useEffect(() => {
    fetchResultDetails();
  }, [fetchResultDetails]);

  const roleIdentityKey = useCallback((role) => {
    const esco = String(role?.escoId || '').trim().toLowerCase();
    if (esco) return `esco:${esco}`;
    const titleKey = normalizeTextForI18nMatch(role?.title);
    if (titleKey) return `title:${titleKey}`;
    return '';
  }, []);

  const resolveCanonicalEscoIdFromCache = useCallback(
    (role) => {
      const direct = String(role?.escoId || '').trim().toLowerCase();
      if (direct) return direct;
      const key = roleIdentityKey(role);
      if (!key) return '';
      return String(canonicalEscoByKey[key] || '').trim().toLowerCase();
    },
    [canonicalEscoByKey, roleIdentityKey]
  );

  const resolveCanonicalEscoId = useCallback(
    async (role) => {
      const direct = String(role?.escoId || '').trim().toLowerCase();
      if (direct) return direct;

      const key = roleIdentityKey(role);
      if (!key) return '';
      if (Object.prototype.hasOwnProperty.call(canonicalEscoByKey, key)) {
        return String(canonicalEscoByKey[key] || '').trim().toLowerCase();
      }

      const titleForLookup = normalizeTextForI18nMatch(role?.title);
      if (!titleForLookup) {
        setCanonicalEscoByKey((prev) => ({ ...prev, [key]: '' }));
        return '';
      }

      try {
        const qs = new URLSearchParams();
        qs.set('title', titleForLookup);
        qs.set('lang', 'en');
        const res = await fetch(`/api/occupations/lookup?${qs.toString()}`);
        const data = await res.json().catch(() => ({}));
        const escoId = String(data?.occupation?.escoId || '').trim().toLowerCase();
        setCanonicalEscoByKey((prev) => {
          if (prev[key] === escoId) return prev;
          return { ...prev, [key]: escoId };
        });
        return escoId;
      } catch (_err) {
        setCanonicalEscoByKey((prev) => {
          if (Object.prototype.hasOwnProperty.call(prev, key)) return prev;
          return { ...prev, [key]: '' };
        });
        return '';
      }
    },
    [canonicalEscoByKey, roleIdentityKey]
  );

  useEffect(() => {
    if (!resultDetails) return;
    void resolveCanonicalEscoId(resultDetails);
  }, [resultDetails, resolveCanonicalEscoId]);

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleEvaluationCommit = async (next) => {
    if (!resultDetails) return;
    setEvaluationSaving(true);
    try {
      const savedSimIdForContext =
        location.state?.returnTo === 'saved'
          ? location.state?.simulationId || loadSimulationDetailContext().savedSimulationId
          : null;
      const writeToSavedSimulation = location.state?.returnTo === 'saved' && !!savedSimIdForContext;

      if (writeToSavedSimulation) {
        await persistUserEvaluationToSavedSimulation(
          savedSimIdForContext,
          resultDetails,
          next
        );
        showSnackbar(t('details.messages.ratingSavedToSimulation', { ns: 'dashboard' }), 'success');
      }

      const merged = { ...resultDetails, userEvaluation: next };
      setResultDetails(merged);
      persistEvaluationToSimulationSnapshots(next);
      try {
        sessionStorage.setItem('currentStepDetails', JSON.stringify(merged));
        sessionStorage.setItem('currentResultDetails', JSON.stringify(merged));
        storeSimulationResultDetails(merged, [resultId]);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error('Error updating evaluation:', err);
      showSnackbar(err.message || t('details.errors.updateRatingFailed', { ns: 'dashboard' }), 'error');
    } finally {
      setEvaluationSaving(false);
    }
  };

  const handleBack = () => {
    const locationState = location.state;
    const savedSimulationId = loadSimulationDetailContext().savedSimulationId;
    
    console.log('handleBack called with location state:', locationState);
    console.log('savedSimulationId from sessionStorage:', savedSimulationId);
    
    // Check navigation context from location state first, then fallback to sessionStorage
    if (locationState && locationState.returnTo === 'saved') {
      console.log('Returning to saved simulation:', locationState.simulationId);
      // Return to saved simulation results
      const simulationId = locationState.simulationId || savedSimulationId;
      navigate('/puzzle-job', { state: { simulationId, fromSaved: true } });
    } else if (locationState && locationState.returnTo === 'unsaved') {
      console.log('Returning to unsaved simulation results');
      // Return to unsaved simulation results
      navigate('/puzzle-job', { state: { refresh: true } });
    } else if (savedSimulationId) {
      console.log('Fallback: returning to saved simulation from sessionStorage');
      // Fallback: check sessionStorage for saved simulation
      navigate('/puzzle-job', { state: { simulationId: savedSimulationId, fromSaved: true } });
    } else {
      console.log('Default: returning to general simulation page');
      // Default: return to general simulation page
      navigate('/puzzle-job', { state: { refresh: true } });
    }
  };

  const handleShare = () => {
    setShareDialogOpen(true);
  };

  const resolvedPlanEscoId = useMemo(
    () =>
      resultDetails
        ? String(resultDetails.escoId || '').trim().toLowerCase() ||
          resolveCanonicalEscoIdFromCache(resultDetails)
        : '',
    [resultDetails, resolveCanonicalEscoIdFromCache]
  );

  const handlePlanPath = () => {
    if (!resultDetails) return;
    const savedSimulationId =
      location.state?.returnTo === 'saved'
        ? location.state?.simulationId || loadSimulationDetailContext().savedSimulationId
        : null;
    navigateToCareerPathPlanning({
      role: resolvedPlanEscoId
        ? { ...resultDetails, escoId: resolvedPlanEscoId }
        : resultDetails,
      savedSimulationId,
      navigate,
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button variant="contained" onClick={handleBack}>
          {t('details.actions.backToResults', { ns: 'dashboard' })}
        </Button>
      </Box>
    );
  }

  if (!resultDetails) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Typography variant="h6" color="error">
          {t('details.resultNotFound', { ns: 'dashboard' })}
        </Typography>
        <Button variant="contained" onClick={handleBack} sx={{ mt: 2 }}>
          {t('details.actions.backToResults', { ns: 'dashboard' })}
        </Button>
      </Box>
    );
  }

  const userEvaluationCard = (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <CareerStepUserEvaluationRow
          value={resultDetails.userEvaluation}
          onCommit={handleEvaluationCommit}
          disabled={evaluationSaving}
        />
      </CardContent>
    </Card>
  );

  return (
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      {/* Header Section */}
      <Paper 
        sx={{ 
          mb: 3,
          backgroundColor: 'var(--color-detail-header-bg)',
          color: 'var(--color-detail-header-fg)',
          borderRadius: 2,
          overflow: 'hidden'
        }}
      >
        {/* Header Content */}
        <Box sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Tooltip title={t('details.actions.backToResults', { ns: 'dashboard' })}>
                <IconButton
                  onClick={handleBack}
                  aria-label={t('details.actions.backToResults', { ns: 'dashboard' })}
                  sx={{
                    flexShrink: 0,
                    color: 'var(--color-detail-header-actions-fg)',
                    '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' },
                  }}
                >
                  <ArrowBack />
                </IconButton>
              </Tooltip>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', color: 'var(--color-detail-header-fg)', flex: 1, minWidth: 0 }}>
                {getRoleTitleForLocale(localizeAiText(resultDetails.title, ''), currentLang)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title={t('details.actions.share', { ns: 'dashboard' })}>
                <IconButton onClick={handleShare} sx={{ color: 'var(--color-detail-header-actions-fg)', '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' } }}>
                  <Share />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
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
              {t('careerPathPlanning.actions.planPath', { ns: 'dashboard' })}
            </Button>
          </Box>

          {/* Progress Bar */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" sx={{ color: 'var(--color-detail-header-fg)', fontWeight: 'bold' }}>
                {t('details.labels.profileMatchScore', { ns: 'dashboard' })}
              </Typography>
              <Typography variant="body2" sx={{ color: 'var(--color-detail-header-fg)', fontWeight: 'bold' }}>
                {Math.round(matchScore)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={matchScore}
              sx={{
                height: 8,
                borderRadius: 4,
                backgroundColor: 'var(--color-detail-header-progress-track)',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: 'var(--color-detail-header-progress-bar)',
                  borderRadius: 4,
                }
              }}
            />
          </Box>

          {/* Details Grid */}
          <Grid container spacing={3}>
            {/* Match Score */}
            <Grid item xs={12} sm={6} md={6}>
              <Box sx={{ textAlign: 'center', p: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'var(--color-detail-header-fg)', mb: 1 }}>
                  {Math.round(matchScore)}%
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {t('details.labels.matchScore', { ns: 'dashboard' })}
                </Typography>
              </Box>
            </Grid>

            {/* Generated Date */}
            <Grid item xs={12} sm={6} md={6}>
              <Box sx={{ textAlign: 'center', p: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'var(--color-detail-header-fg)', mb: 1 }}>
                  {resultDetails.createdAt ? new Date(resultDetails.createdAt).toLocaleDateString('de-DE', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                  }) : new Date().toLocaleDateString('de-DE', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                  })}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {t('details.labels.generated', { ns: 'dashboard' })}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Box>
      </Paper>

      <Grid container spacing={3}>
        {/* Main Content */}
        <Grid item xs={12} lg={8}>
          <CareerStepRoleFitCard
            stepDetails={resultDetails}
            simulationScopeId={
              resultDetails?.simulationId ||
              loadSimulationDetailContext().savedSimulationId ||
              'local'
            }
          />

          {isStackedCareerDetailLayout ? userEvaluationCard : null}

          <CareerStepRoleDescriptionCard
            description={localizeAiText(resultDetails.description, '')}
          />

          <CareerStepRoleInsightsCard
            stepDetails={resultDetails}
            maxVisibleSkillDomains={MAX_VISIBLE_SKILL_DOMAINS}
            key={`insights-${resultId}`}
          />

        </Grid>

        {/* Sidebar */}
        <Grid item xs={12} lg={4}>
          {!isStackedCareerDetailLayout ? userEvaluationCard : null}

          <CareerStepRoleDetailsCard stepDetails={resultDetails} key={`details-${resultId}`} />

        </Grid>
      </Grid>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Share Dialog */}
      <ShareDialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        resultDetails={{
          resultId: resultDetails?.resultId || resultId,
          title: localizeAiText(resultDetails?.title || '', ''),
          description: localizeAiText(resultDetails?.description || '', ''),
          category: resultDetails?.category || 'career-role',
          matchScore: Number.isFinite(matchScore) ? Math.round(matchScore) : undefined,
          seniority: resultDetails?.seniority,
          keyResponsibilities: resultDetails?.keyResponsibilities,
          skillDomains: resultDetails?.skillDomains,
          skillModel: resultDetails?.skillModel,
          altTitles: resultDetails?.altTitles,
          hiddenTitles: resultDetails?.hiddenTitles,
          requiredSkills: resultDetails?.requiredSkills,
          requiredSkillUris: resultDetails?.requiredSkillUris,
          escoId: resultDetails?.escoId
        }}
      />
    </Box>
  );
};

export default SimulationResultDetails; 