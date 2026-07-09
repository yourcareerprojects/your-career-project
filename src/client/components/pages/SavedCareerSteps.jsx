import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  TextField,
  Button,
  Paper,
  Checkbox,
  FormControlLabel,
  Pagination,
  CircularProgress,
  Alert,
  Snackbar,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  Delete as DeleteIcon,
  ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import PuzzlePieceIcon from '@mui/icons-material/Extension';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../../constants/profileCompletion';
import { hasActiveCareerSimulationSession } from '../../utils/simulationPersistence';
import useConfirmationDialog from '../../hooks/useConfirmationDialog';
import ConfirmationDialog from '../common/ConfirmationDialog';
import PageHeader from '../common/PageHeader';
import {
  useSavedCareerStepsListQuery,
  invalidateSavedCareerStepsListQuery,
  setSavedCareerStepsListQueryData,
  baseUILanguage,
  useProfileCompletionQuery,
  useLastSimulationQuery,
} from '../../hooks/useProfileQueries';
import { getRoleTitleForLocale, getRoleTitleEnglishForMatch, normalizeTextForI18nMatch } from '../../utils/roleTitleDisplay';

/** React Query’s `data ?? []` would create a new `[]` every render and break any effect keyed on the array. */
const EMPTY_SAVED_STEPS = Object.freeze([]);

const pickI18nOrString = (value, lang) => {
  const a = getRoleTitleForLocale(value, lang);
  if (a) return a;
  const b = getRoleTitleForLocale(value, 'en');
  if (b) return b;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const v of Object.values(value)) {
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return '';
};

const titleFromStepId = (stepId) => {
  if (stepId == null || !String(stepId).trim()) return '';
  const parts = String(stepId).split('-').filter((p) => p && /[a-zA-Z]/.test(p));
  const joined = parts.join(' ').trim();
  return joined || String(stepId).trim();
};

const pickTitleForCard = (step, lang) => {
  const fromTitle = pickI18nOrString(step?.title, lang);
  if (fromTitle) return fromTitle;
  if (step?.escoId && String(step.escoId).trim()) return String(step.escoId).trim();
  if (step?.stepId) return titleFromStepId(step.stepId);
  return '';
};

const pickDescriptionForCard = (step, lang) => {
  return pickI18nOrString(step?.description, lang);
};

const formatSavedAtLabel = (ts, locale) => {
  if (ts == null || ts === '') return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const loc = (locale && String(locale).replace(/_/g, '-')) || 'en';
  return d.toLocaleDateString(loc, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/** Filled primary career-step actions (More / Saved); full width in grid cells */
const CAREER_STEP_ACTION_BTN_SX = { width: '100%' };
const CAREER_STEP_SAVED_BTN_SX = {
  bgcolor: 'primary.dark',
  '&:hover': {
    bgcolor: 'primary.dark',
    filter: 'brightness(1.08)',
  },
};

/** Keep / Skip / Dislike row — aligned with `SimulationCategoryEvaluation.jsx` */
const EVAL_BUTTON_SX = {
  width: '100% !important',
  minWidth: '0px !important',
  px: '10px !important',
  py: '8px !important',
  fontSize: '0.8rem !important',
  lineHeight: '1.1 !important',
  borderRadius: '12px !important',
  whiteSpace: 'nowrap !important',
  boxShadow: 'none !important',
};

const inferCategoryKey = (step) => {
  const c = step.category;
  if (c === 'nextSteps' || c === 'outsideTheBox' || c === 'furtherAdvice') return c;
  const lc = String(step.listCategory || '').toLowerCase();
  if (lc.includes('outside') || lc.includes('box')) return 'outsideTheBox';
  if (lc.includes('advice') || lc.includes('resource') || lc.includes('further')) return 'furtherAdvice';
  return 'nextSteps';
};

const SavedCareerSteps = () => {
  const { t, i18n } = useTranslation(['dashboard', 'onboarding']);
  const { user } = useAuth();
  const profileCompletionQuery = useProfileCompletionQuery({ enabled: !!user });
  const completion = profileCompletionQuery.data?.completion;
  const meetsSimulationProfileMin =
    !!completion && Number(completion.overall || 0) >= MIN_PROFILE_COMPLETION_REQUIRED;
  const hasSimulationSession = hasActiveCareerSimulationSession();
  const lastSimulationQuery = useLastSimulationQuery({
    enabled: !!user && meetsSimulationProfileMin && !hasSimulationSession,
  });
  const goToSimulationHref = useMemo(() => {
    if (hasSimulationSession) return '/simulation/results';
    if (!meetsSimulationProfileMin) return '/simulation';
    if (lastSimulationQuery.isError || lastSimulationQuery.data == null) return '/simulation';
    return lastSimulationQuery.data?.results ? '/simulation/results' : '/simulation';
  }, [
    hasSimulationSession,
    meetsSimulationProfileMin,
    lastSimulationQuery.data,
    lastSimulationQuery.isError,
  ]);
  const { data, isLoading, isError, error } = useSavedCareerStepsListQuery();
  const savedSteps = useMemo(() => {
    const list = (data && Array.isArray(data)) ? data : EMPTY_SAVED_STEPS;
    return list.filter(
      (row) => row != null && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length > 0
    );
  }, [data]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSteps, setSelectedSteps] = useState([]);
  const [page, setPage] = useState(1);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [removingStepId, setRemovingStepId] = useState(null);
  const [evaluationSavingStepId, setEvaluationSavingStepId] = useState(null);
  const [localizedTitleOverrides, setLocalizedTitleOverrides] = useState({});
  const { dialogState, openDialog, handleConfirm, handleCancel } = useConfirmationDialog();

  const navigate = useNavigate();
  const activeLang = baseUILanguage();
  
  const stepsPerPage = 12;

  /** Stable id for API + routes (DB uses stepId; legacy rows may need English title match on client). */
  const resolveStepId = (step) => {
    if (step?.stepId != null && String(step.stepId).trim() !== '') {
      return String(step.stepId).trim();
    }
    return getRoleTitleEnglishForMatch(step?.title) || '';
  };

  const filteredSteps = useMemo(() => {
    let filtered = Array.isArray(savedSteps) ? [...savedSteps] : [];

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter((step) => {
        const titleH = normalizeTextForI18nMatch(step?.title);
        const descH = normalizeTextForI18nMatch(step?.description);
        return titleH.includes(q) || descH.includes(q);
      });
    }

    filtered.sort((a, b) => {
      const aTime = new Date(a?.savedAt || 0).getTime();
      const bTime = new Date(b?.savedAt || 0).getTime();
      return bTime - aTime;
    });
    return filtered;
  }, [savedSteps, searchTerm]);

  // Reset page when the user changes search (not on every re-render; avoids loops with setState in effects)
  useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  const handleRemoveStep = async (stepId) => {
    setRemovingStepId(stepId);
    try {
      const response = await fetch(`/api/profile/saved-career-steps/${encodeURIComponent(stepId)}?lang=${encodeURIComponent(activeLang)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.savedCareerSteps) {
          setSavedCareerStepsListQueryData(data.savedCareerSteps, activeLang);
        } else {
          setSavedCareerStepsListQueryData(
            (prev) => (Array.isArray(prev) ? prev : []).filter((s) => resolveStepId(s) !== stepId),
            activeLang
          );
        }
        setSelectedSteps(prev => prev.filter(id => id !== stepId));
        showSnackbar(t('savedLists.savedCareerSteps.messages.removedFromSavedList', { ns: 'dashboard' }), 'success');
      } else {
        showSnackbar(t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }), 'error');
      }
    } catch (error) {
      console.error('Error removing career step:', error);
      showSnackbar(t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }), 'error');
    } finally {
      setRemovingStepId(null);
    }
  };

  const normalizeStoredEvaluation = (step) => {
    const v = step?.userEvaluation;
    if (v === 'keep' || v === 'skip' || v === 'dislike') return v;
    return null;
  };

  const handleEvaluationClick = async (step, choice) => {
    const id = resolveStepId(step);
    if (!id) {
      showSnackbar(t('simulation.messages.careerStepNotFound', { ns: 'dashboard' }), 'error');
      return;
    }
    const current = normalizeStoredEvaluation(step);
    const nextPayload = current === choice ? null : choice;
    setEvaluationSavingStepId(id);
    try {
      const response = await fetch(
        `/api/profile/saved-career-steps/${encodeURIComponent(id)}?lang=${encodeURIComponent(activeLang)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ userEvaluation: nextPayload }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success && Array.isArray(data.savedCareerSteps)) {
        setSavedCareerStepsListQueryData(data.savedCareerSteps, activeLang);
      } else {
        showSnackbar(data.error || t('details.errors.updateRatingFailed', { ns: 'dashboard' }), 'error');
      }
    } catch (err) {
      console.error('Error updating saved step evaluation:', err);
      showSnackbar(t('details.errors.updateRatingFailed', { ns: 'dashboard' }), 'error');
    } finally {
      setEvaluationSavingStepId(null);
    }
  };

  const handleRemoveWithConfirm = (step) => {
    openDialog({
      title: t('details.unsaveDialog.title', { ns: 'dashboard' }),
      message: t('details.unsaveDialog.message', { ns: 'dashboard' }),
      confirmText: t('details.unsaveDialog.confirm', { ns: 'dashboard' }),
      cancelText: t('profilePage.actions.cancel', { ns: 'onboarding' }),
      severity: 'warning',
      onConfirm: async () => {
        await handleRemoveStep(resolveStepId(step));
      },
    });
  };

  const getBorderColor = (category) => {
    switch (category) {
      case 'nextSteps':
        return 'var(--color-primary)';
      case 'outsideTheBox':
        return 'var(--color-warning)';
      case 'furtherAdvice':
        return 'var(--color-success)';
      default:
        return 'var(--color-primary)';
    }
  };

  const handleBulkRemove = async () => {
    const idsToRemove = [...selectedSteps];
    if (idsToRemove.length === 0) return;

    try {
      const response = await fetch(
        `/api/profile/saved-career-steps/bulk-delete?lang=${encodeURIComponent(activeLang)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ stepIds: idsToRemove }),
        }
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || t('savedLists.savedCareerSteps.errors.bulkRemoveFailed', { ns: 'dashboard' }));
      }

      const removedCount = Number.isFinite(payload.removedCount) ? payload.removedCount : 0;
      if (Array.isArray(payload.savedCareerSteps)) {
        setSavedCareerStepsListQueryData(payload.savedCareerSteps, activeLang);
      } else {
        invalidateSavedCareerStepsListQuery();
      }

      setSelectedSteps((prev) => prev.filter((id) => !idsToRemove.includes(id)));

      if (removedCount <= 0) {
        showSnackbar(t('savedLists.savedCareerSteps.errors.bulkRemoveNoneRemoved', { ns: 'dashboard' }), 'error');
        return;
      }

      if (removedCount < idsToRemove.length) {
        showSnackbar(
          t('savedLists.savedCareerSteps.messages.bulkPartiallyRemoved', {
            ns: 'dashboard',
            removed: removedCount,
            count: idsToRemove.length,
          }),
          'warning'
        );
        return;
      }

      showSnackbar(t('savedLists.savedCareerSteps.messages.bulkRemoved', { ns: 'dashboard', count: removedCount }), 'success');
    } catch (error) {
      console.error('Error removing career steps:', error);
      showSnackbar(t('savedLists.savedCareerSteps.errors.bulkRemoveFailed', { ns: 'dashboard' }), 'error');
    }
  };

  const handleBulkRemoveWithConfirm = () => {
    if (selectedSteps.length === 0) return;

    openDialog({
      title: t('details.unsaveDialog.title', { ns: 'dashboard' }),
      message: selectedSteps.length === 1
        ? t('details.unsaveDialog.message', { ns: 'dashboard' })
        : t('savedLists.savedCareerSteps.dialogs.bulkRemoveMessage', { ns: 'dashboard' }),
      confirmText: t('details.unsaveDialog.confirm', { ns: 'dashboard' }),
      cancelText: t('profilePage.actions.cancel', { ns: 'onboarding' }),
      severity: 'warning',
      onConfirm: async () => {
        await handleBulkRemove();
      },
    });
  };

  const handleSelectStep = (stepId) => {
    setSelectedSteps(prev =>
      prev.includes(stepId)
        ? prev.filter(id => id !== stepId)
        : [...prev, stepId]
    );
  };

  const handleSelectAll = () => {
    const currentPageSteps = filteredSteps.slice((page - 1) * stepsPerPage, page * stepsPerPage);
    const currentPageIds = currentPageSteps.map((s) => resolveStepId(s)).filter(Boolean);
    
    if (selectedSteps.length === currentPageIds.length) {
      setSelectedSteps([]);
    } else {
      setSelectedSteps(currentPageIds);
    }
  };

  const showSnackbar = (message, severity) => {
    setSnackbar({ open: true, message, severity });
  };

  const paginatedSteps = filteredSteps.slice((page - 1) * stepsPerPage, page * stepsPerPage);
  const totalPages = Math.ceil(filteredSteps.length / stepsPerPage);

  // Keep pagination valid after removals/search updates:
  // - stay on current page when it still exists
  // - move to previous page when current page disappears (e.g., deleting last page)
  useEffect(() => {
    const safeTotalPages = Math.max(1, totalPages);
    setPage((prev) => {
      if (prev > safeTotalPages) return safeTotalPages;
      if (prev < 1) return 1;
      return prev;
    });
  }, [totalPages]);

  useEffect(() => {
    setLocalizedTitleOverrides({});
  }, [activeLang]);

  useEffect(() => {
    let isCancelled = false;
    const token = localStorage.getItem('token');
    if (!token || paginatedSteps.length === 0) return undefined;

    const enrichVisibleTitles = async () => {
      for (const step of paginatedSteps) {
        const id = resolveStepId(step);
        if (!id) continue;
        const languageScopedKey = `${activeLang}:${id}`;
        if (localizedTitleOverrides[languageScopedKey]) continue;

        const qs = new URLSearchParams();
        if (step?.escoId && String(step.escoId).trim()) {
          qs.set('escoId', String(step.escoId).trim());
        } else {
          const lookupTitle = getRoleTitleEnglishForMatch(step?.title) || pickI18nOrString(step?.title, 'en');
          if (!lookupTitle) continue;
          qs.set('title', lookupTitle);
        }
        qs.set('lang', activeLang);

        try {
          const res = await fetch(`/api/occupations/lookup?${qs.toString()}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          const localizedTitle = data?.occupation?.title || data?.occupation?.preferredLabel || '';
          if (!res.ok || !localizedTitle) continue;
          if (isCancelled) return;
          setLocalizedTitleOverrides((prev) => {
            if (prev[languageScopedKey] === localizedTitle) return prev;
            return { ...prev, [languageScopedKey]: localizedTitle };
          });
        } catch (_err) {
          // Ignore lookup failures and keep existing title fallback.
        }
      }
    };

    enrichVisibleTitles();
    return () => {
      isCancelled = true;
    };
  }, [paginatedSteps, activeLang, localizedTitleOverrides]);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error?.message || t('savedLists.savedCareerSteps.errors.fetchFailed', { ns: 'dashboard' })}
        </Alert>
        <Button variant="contained" onClick={() => invalidateSavedCareerStepsListQuery()}>
          {t('savedLists.savedCareerSteps.actions.retry', { ns: 'dashboard' })}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <PageHeader
        title={t('saved.careerSteps', { ns: 'dashboard' })}
        description={t('savedLists.savedCareerSteps.subtitle', { ns: 'dashboard' })}
      />

      {/* Search */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <TextField
          fullWidth
          placeholder={t('savedLists.savedCareerSteps.searchPlaceholder', { ns: 'dashboard' })}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
          }}
        />
      </Paper>

      {/* Results Summary */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('savedLists.savedCareerSteps.resultsFound', { ns: 'dashboard', count: filteredSteps.length })}
        </Typography>
        {selectedSteps.length > 0 && (
          <Button
            variant="outlined"
            color="error"
            size="medium"
            startIcon={<DeleteIcon />}
            onClick={handleBulkRemoveWithConfirm}
            sx={{
              fontWeight: 600,
              px: 3,
              py: 1.5,
              fontSize: '1rem',
            }}
          >
            {t('savedLists.savedCareerSteps.actions.removeSelected', { ns: 'dashboard', count: selectedSteps.length })}
          </Button>
        )}
      </Box>

      {/* Career Steps Grid */}
      {filteredSteps.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <StarBorderIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            {t('savedLists.savedCareerSteps.emptyTitle', { ns: 'dashboard' })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {searchTerm
              ? t('savedLists.savedCareerSteps.emptyAdjustSearch', { ns: 'dashboard' })
              : t('savedLists.savedCareerSteps.emptyStartSimulation', { ns: 'dashboard' })}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="medium"
            startIcon={<PuzzlePieceIcon />}
            href={goToSimulationHref}
            sx={{
              fontWeight: 600,
              px: 3,
              py: 1.5,
              fontSize: '1rem',
            }}
          >
            {t('profilePagePrompts.goToSimulationCta', { ns: 'onboarding' })}
          </Button>
        </Box>
      ) : (
        <>
          {/* Select All Checkbox */}
          {paginatedSteps.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedSteps.length === paginatedSteps.length && paginatedSteps.length > 0}
                    indeterminate={selectedSteps.length > 0 && selectedSteps.length < paginatedSteps.length}
                    onChange={handleSelectAll}
                  />
                }
                label={t('savedLists.savedCareerSteps.selectAllOnPage', { ns: 'dashboard' })}
              />
            </Box>
          )}

          <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} sx={{ alignItems: 'stretch', mb: 2 }}>
            {paginatedSteps.map((step, cardIndex) => {
              const id = resolveStepId(step);
              const category = inferCategoryKey(step);
              const borderColor = getBorderColor(category);
              const storedEval = normalizeStoredEvaluation(step);
              const moreTooltip = t('savedLists.savedCareerSteps.tooltips.moreDetails', { ns: 'dashboard' });
              const saveTooltip = t('savedLists.savedCareerSteps.tooltips.savedRemove', { ns: 'dashboard' });
              const languageScopedKey = id ? `${activeLang}:${id}` : '';
              const displayTitle = (languageScopedKey && localizedTitleOverrides[languageScopedKey]) || pickTitleForCard(step, activeLang) || '—';
              const displayDescription = pickDescriptionForCard(step, activeLang);

              return (
              <Grid item xs={12} sm={6} md={4} key={id || `saved-step-${cardIndex}`} sx={{ 
                mb: { xs: 1, sm: 2, md: 2 },
                px: { xs: 1, sm: 1.5, md: 2 }
              }}>
                <Card 
                  className="career-step-card"
                  sx={{ 
                    borderLeft: `6px solid ${borderColor}`,
                    height: '100%',
                    minHeight: '400px',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    borderRight: id && selectedSteps.includes(id) ? 2 : 1,
                    borderTop: id && selectedSteps.includes(id) ? 2 : 1,
                    borderBottom: id && selectedSteps.includes(id) ? 2 : 1,
                    borderColor: id && selectedSteps.includes(id) ? 'primary.main' : 'divider',
                    margin: 0,
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-card-sm)'
                  }}
                >
                  <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, p: 2, justifyContent: 'space-between' }}>
                    {/* Selection Checkbox */}
                    <Checkbox
                      checked={Boolean(id) && selectedSteps.includes(id)}
                      onChange={() => id && handleSelectStep(id)}
                      disabled={!id}
                      sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                    />

                    {/* Title */}
                    <Typography 
                      variant="h6" 
                      color="text.primary"
                      sx={{ 
                        fontWeight: 600, 
                        mb: 1,
                        minHeight: '2.5em',
                        display: 'flex',
                        alignItems: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        pr: 4
                      }}
                    >
                      {displayTitle}
                    </Typography>

                    {/* Description */}
                    <Typography 
                      variant="body2" 
                      color="text.primary"
                      sx={{ 
                        mb: 2,
                        display: displayDescription ? '-webkit-box' : 'block',
                        WebkitLineClamp: displayDescription ? 4 : undefined,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: '1.4em',
                        minHeight: displayDescription ? '5.6em' : 0
                      }}
                    >
                      {displayDescription || '\u00a0'}
                    </Typography>

                    {/* Save Date */}
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
                      {t('details.labels.saved', { ns: 'dashboard' })} {t('savedLists.savedCareerSteps.onDate', { ns: 'dashboard', date: formatSavedAtLabel(step?.savedAt, i18n.resolvedLanguage || i18n.language) })}
                    </Typography>

                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                      {t('savedLists.savedCareerSteps.rateThisRole', { ns: 'dashboard' })}
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, mb: 1.5 }}>
                      <Tooltip title={t('savedLists.savedCareerSteps.tooltips.keepStrongFit', { ns: 'dashboard' })} arrow>
                        <span>
                          <Button
                            variant={storedEval === 'keep' ? 'contained' : 'outlined'}
                            color="success"
                            size="small"
                            disabled={!id || evaluationSavingStepId === id}
                            onClick={() => handleEvaluationClick(step, 'keep')}
                            sx={EVAL_BUTTON_SX}
                            aria-pressed={storedEval === 'keep'}
                          >
                            {t('savedLists.savedCareerSteps.actions.keep', { ns: 'dashboard' })}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={t('savedLists.savedCareerSteps.tooltips.skipNotSure', { ns: 'dashboard' })} arrow>
                        <span>
                          <Button
                            variant={storedEval === 'skip' ? 'contained' : 'outlined'}
                            color="inherit"
                            size="small"
                            disabled={!id || evaluationSavingStepId === id}
                            onClick={() => handleEvaluationClick(step, 'skip')}
                            startIcon={<RemoveCircleOutlineIcon sx={{ fontSize: '1rem !important' }} />}
                            sx={EVAL_BUTTON_SX}
                            aria-pressed={storedEval === 'skip'}
                          >
                            {t('savedLists.savedCareerSteps.actions.skip', { ns: 'dashboard' })}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={t('savedLists.savedCareerSteps.tooltips.dislikePoorFit', { ns: 'dashboard' })} arrow>
                        <span>
                          <Button
                            variant={storedEval === 'dislike' ? 'contained' : 'outlined'}
                            color="error"
                            size="small"
                            disabled={!id || evaluationSavingStepId === id}
                            onClick={() => handleEvaluationClick(step, 'dislike')}
                            sx={EVAL_BUTTON_SX}
                            aria-pressed={storedEval === 'dislike'}
                          >
                            {t('savedLists.savedCareerSteps.actions.dislike', { ns: 'dashboard' })}
                          </Button>
                        </span>
                      </Tooltip>
                    </Box>

                    {/* Action buttons: More + unsave (Saved) */}
                    <Box
                      className="career-step-actions"
                      sx={{
                        pt: 1,
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 1,
                        width: '100%',
                        alignItems: 'stretch',
                        mt: 'auto'
                      }}
                    >
                      <Tooltip title={moreTooltip} arrow>
                        <span>
                          <Button
                            aria-label={moreTooltip}
                            variant="contained"
                            color="primary"
                            size="small"
                            startIcon={<ArrowForwardIcon sx={{ fontSize: '1rem' }} />}
                            onClick={() => {
                              if (!id) return;
                              sessionStorage.setItem('currentStepDetails', JSON.stringify(step));
                              navigate(`/saved-career-step/${encodeURIComponent(id)}`);
                            }}
                            disabled={!id}
                            className="career-step-action-button"
                            sx={CAREER_STEP_ACTION_BTN_SX}
                          >
                            {t('savedLists.savedCareerSteps.actions.more', { ns: 'dashboard' })}
                          </Button>
                        </span>
                      </Tooltip>

                      <Tooltip title={saveTooltip} arrow>
                        <span>
                          <Button
                            aria-label={saveTooltip}
                            variant="contained"
                            color="primary"
                            size="small"
                            startIcon={
                              removingStepId === id ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <StarIcon sx={{ fontSize: '1rem' }} />
                              )
                            }
                            onClick={() => handleRemoveWithConfirm(step)}
                            disabled={!id || removingStepId === id}
                            className="career-step-action-button"
                            sx={{
                              ...CAREER_STEP_ACTION_BTN_SX,
                              ...CAREER_STEP_SAVED_BTN_SX,
                            }}
                          >
                            {t('savedLists.savedCareerSteps.actions.saved', { ns: 'dashboard' })}
                          </Button>
                        </span>
                      </Tooltip>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
              );
            })}
          </Grid>

          {/* Pagination */}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(e, value) => setPage(value)}
                color="primary"
              />
            </Box>
          )}
        </>
      )}

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      <ConfirmationDialog
        open={dialogState.open}
        onClose={handleCancel}
        onConfirm={handleConfirm}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        severity={dialogState.severity}
        loading={dialogState.loading}
      />
    </Box>
  );
};

export default SavedCareerSteps; 