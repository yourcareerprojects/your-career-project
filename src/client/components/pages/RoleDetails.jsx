import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Button,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  IconButton,
  Tooltip,
  Snackbar,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ArrowBack, Work, Star, StarBorder } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CareerStepRoleInsightsCard,
  CareerStepRoleDetailsCard,
  CareerStepRoleFitCard,
} from '../common/CareerStepRoleSections';
import CareerStepUserEvaluationRow from '../common/CareerStepUserEvaluationRow';
import {
  useSavedCareerStepsListQuery,
  useFullProfileQuery,
  setSavedCareerStepsListQueryData,
} from '../../hooks/useProfileQueries';
import { getRoleTitleForLocale } from '../../utils/roleTitleDisplay';
import {
  findSavedOccupationMatch,
  saveOccupationAsCareerStep,
  removeSavedOccupation,
} from '../../utils/saveOccupationAsCareerStep';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';

const splitDescriptionIntoParagraphs = (text) => {
  const normalizedText = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalizedText) return [];

  const lineParagraphs = normalizedText
    .split(/\n\s*\n|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (lineParagraphs.length > 1) return lineParagraphs;

  const sentences = normalizedText.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentences || sentences.length <= 2) return [normalizedText];

  const paragraphs = [];
  const sentenceBatchSize = 3;
  for (let i = 0; i < sentences.length; i += sentenceBatchSize) {
    paragraphs.push(sentences.slice(i, i + sentenceBatchSize).join(' ').trim());
  }
  return paragraphs.filter(Boolean);
};

const RoleDetails = () => {
  const { t } = useTranslation('dashboard');
  const { i18n } = useTranslation();
  const { escoId: escoIdParam } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isStackedCareerDetailLayout = useMediaQuery(theme.breakpoints.down('lg'));

  const escoId = decodeURIComponent(escoIdParam || '');
  const currentLang = i18n.resolvedLanguage || i18n.language || 'en';

  const [occupation, setOccupation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [evaluationSaving, setEvaluationSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const { data: savedCareerSteps = [] } = useSavedCareerStepsListQuery();
  const { isLoading: profileLoading } = useFullProfileQuery();

  const savedMatch = useMemo(
    () => (occupation ? findSavedOccupationMatch(occupation, savedCareerSteps) : null),
    [occupation, savedCareerSteps]
  );
  const isSaved = Boolean(savedMatch);

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

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
    navigate('/explore-roles');
  };

  const handleSaveToggle = async () => {
    if (!occupation || saving) return;
    setSaving(true);
    try {
      if (isSaved) {
        await removeSavedOccupation(occupation, savedCareerSteps);
        showSnackbar(t('simulation.messages.careerStepRemoved'), 'info');
      } else {
        await saveOccupationAsCareerStep(occupation);
        showSnackbar(t('simulation.messages.careerStepSaved'), 'success');
      }
    } catch (err) {
      showSnackbar(err.message || t('simulation.messages.careerStepSaveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleViewSavedDetail = () => {
    if (!savedMatch?.stepId) return;
    navigate(`/saved-career-step/${encodeURIComponent(savedMatch.stepId)}`);
  };

  const handleEvaluationCommit = async (next) => {
    const stepId = savedMatch?.stepId;
    if (!stepId) return;
    setEvaluationSaving(true);
    try {
      const activeLang = i18n.resolvedLanguage || i18n.language || 'en';
      const response = await fetch(
        `/api/profile/saved-career-steps/${encodeURIComponent(stepId)}?${getProfileApiLangQuery()}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ userEvaluation: next }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success && Array.isArray(data.savedCareerSteps)) {
        setSavedCareerStepsListQueryData(data.savedCareerSteps);
        setOccupation((prev) => (prev ? { ...prev, userEvaluation: next } : prev));
      } else {
        showSnackbar(data.error || t('details.errors.updateRatingFailed'), 'error');
      }
    } catch {
      showSnackbar(t('details.errors.updateRatingFailed'), 'error');
    } finally {
      setEvaluationSaving(false);
    }
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
  const descriptionParagraphs = splitDescriptionIntoParagraphs(
    getRoleTitleForLocale(occupation.description, currentLang)
  );
  const stepDetailsForCards = {
    ...occupation,
    userEvaluation: savedMatch?.userEvaluation ?? occupation.userEvaluation,
  };

  const userEvaluationCard = isSaved ? (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <CareerStepUserEvaluationRow
          value={savedMatch?.userEvaluation}
          onCommit={handleEvaluationCommit}
          disabled={evaluationSaving}
        />
      </CardContent>
    </Card>
  ) : null;

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
            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              {!saving ? (
                <Tooltip
                  title={
                    isSaved
                      ? t('details.actions.removeFromSavedSteps')
                      : t('details.actions.saveToSavedSteps')
                  }
                >
                  <IconButton
                    onClick={handleSaveToggle}
                    aria-label={
                      isSaved
                        ? t('details.actions.removeFromSavedSteps')
                        : t('details.actions.saveToSavedSteps')
                    }
                    sx={{
                      color: 'var(--color-detail-header-actions-fg)',
                      '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' },
                      backgroundColor: isSaved
                        ? 'var(--color-on-detail-header-overlay-selected)'
                        : 'transparent',
                    }}
                  >
                    {isSaved ? <Star /> : <StarBorder />}
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip title={t('details.actions.saving')}>
                  <IconButton disabled sx={{ color: 'var(--color-detail-header-actions-fg)', opacity: 0.6 }}>
                    <CircularProgress size={20} color="inherit" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>

          {isSaved && (
            <Button
              variant="outlined"
              size="small"
              onClick={handleViewSavedDetail}
              sx={{
                color: 'var(--color-detail-header-fg)',
                borderColor: 'var(--color-detail-header-fg)',
                mb: 2,
                '&:hover': {
                  borderColor: 'var(--color-detail-header-fg)',
                  backgroundColor: 'var(--color-on-detail-header-overlay-hover)',
                },
              }}
            >
              {t('roleSearch.actions.viewSavedDetail')}
            </Button>
          )}
        </Box>
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          {isStackedCareerDetailLayout && userEvaluationCard}

          <CareerStepRoleFitCard stepDetails={stepDetailsForCards} profileLoading={profileLoading} />

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                {t('details.labels.roleDescription')}
              </Typography>
              {descriptionParagraphs.length > 0 ? (
                descriptionParagraphs.map((paragraph, index) => (
                  <Typography key={index} variant="body1" paragraph sx={{ lineHeight: 1.7 }}>
                    {paragraph}
                  </Typography>
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('details.labels.noDetailedDescription')}
                </Typography>
              )}
            </CardContent>
          </Card>

          {!isStackedCareerDetailLayout && userEvaluationCard}
        </Grid>

        <Grid item xs={12} lg={4}>
          <CareerStepRoleInsightsCard stepDetails={stepDetailsForCards} />
          <CareerStepRoleDetailsCard stepDetails={stepDetailsForCards} />

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                {t('details.labels.additionalInformation')}
              </Typography>
              <List dense disablePadding>
                {occupation.iscoGroup && (
                  <ListItem disableGutters>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Work fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={t('roleSearch.labels.iscoGroup')}
                      secondary={occupation.iscoGroup}
                    />
                  </ListItem>
                )}
                {occupation.escoId && (
                  <ListItem disableGutters>
                    <ListItemText
                      primary={t('roleSearch.labels.roleId')}
                      secondary={occupation.escoId}
                      sx={{ pl: 0 }}
                    />
                  </ListItem>
                )}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RoleDetails;
