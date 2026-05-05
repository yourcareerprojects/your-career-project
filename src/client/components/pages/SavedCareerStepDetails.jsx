import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Divider,
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
import {
  ArrowBack,
  Work,
  Star,
  StarBorder,
  Share,
  Save,
  Delete
} from '@mui/icons-material';
import { LinearProgress } from '@mui/material';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ConfirmationDialog from '../common/ConfirmationDialog';
import ShareDialog from './ShareDialog';
import {
  CareerStepRoleInsightsCard,
  CareerStepRoleDetailsCard,
  CareerStepRoleFitCard,
} from '../common/CareerStepRoleSections';
import CareerStepUserEvaluationRow from '../common/CareerStepUserEvaluationRow';
import { getCareerStepMatchScorePercent, getMatchScoreFieldsForSave } from '../../utils/careerStepMatchScore';
import { pickUserEvaluationForSave } from '../../utils/savedCareerStepUserEvaluation';
import {
  useSavedCareerStepsListQuery,
  useFullProfileQuery,
  setSavedCareerStepsListQueryData,
} from '../../hooks/useProfileQueries';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import { findMatchingSavedCareerStep } from '../../utils/savedCareerStepIdentity';

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

const SavedCareerStepDetails = () => {
  const { t } = useTranslation(['dashboard', 'onboarding']);
  const { i18n } = useTranslation();
  const { stepId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [stepDetails, setStepDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matchScore, setMatchScore] = useState(0);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  
  const { data: savedCareerSteps = [] } = useSavedCareerStepsListQuery();
  const { data: fullProfile, isLoading: profileLoading } = useFullProfileQuery();
  const [savingStep, setSavingStep] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [confirmUnsaveOpen, setConfirmUnsaveOpen] = useState(false);
  const [evaluationSaving, setEvaluationSaving] = useState(false);
  const theme = useTheme();
  /** Matches `lg={8}` / `lg={4}` detail grid: when stacked, show evaluation after fit, before description. */
  const isStackedCareerDetailLayout = useMediaQuery(theme.breakpoints.down('lg'));

  // Re-fetch occupation details in active UI language for consistent backend-localized fields.
  useEffect(() => {
    const enrich = async () => {
      if (!stepDetails) return;
      const activeLang = i18n.resolvedLanguage || i18n.language || 'en';
      if (stepDetails._localizedLang === activeLang) return;
      const titleToLookupString = (raw) => {
        if (raw == null) return '';
        if (typeof raw === 'string') return raw.trim();
        if (typeof raw === 'object' && !Array.isArray(raw)) {
          const isDe = String(activeLang).toLowerCase().startsWith('de');
          const de = raw.de != null ? String(raw.de).trim() : '';
          const en = raw.en != null ? String(raw.en).trim() : '';
          if (isDe) return de || en;
          return en || de;
        }
        return String(raw).trim();
      };

      let escoId = stepDetails.escoId;
      const careerPathId = stepDetails.careerPathId;
      let title = stepDetails.title;

      // German-localized saved steps may not carry stable identifiers in legacy rows.
      // If ESCO id is missing, fetch canonical EN step once and use its lookup key.
      if (!escoId && !careerPathId && stepId) {
        try {
          const canonicalRes = await fetch(
            `/api/profile/saved-career-steps/${encodeURIComponent(stepId)}?lang=en`,
            {
              headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              }
            }
          );
          if (canonicalRes.ok) {
            const canonicalData = await canonicalRes.json();
            const canonicalStep = canonicalData.savedCareerStep || canonicalData.step;
            escoId = canonicalStep?.escoId || escoId;
            title = canonicalStep?.title || title;
          }
        } catch (err) {
          console.warn('Failed to fetch canonical saved step for enrichment:', err);
        }
      }

      const titleForQuery = titleToLookupString(title);
      if (!careerPathId && !escoId && !titleForQuery) return;

      try {
        const qs = new URLSearchParams();
        if (careerPathId) {
          qs.set('careerPathId', String(careerPathId));
        } else if (escoId) {
          qs.set('escoId', String(escoId).trim());
        } else {
          qs.set('title', titleForQuery);
        }
        qs.set('lang', activeLang);

        const res = await fetch(`/api/occupations/lookup?${qs.toString()}`);
        const data = await res.json();
        if (res.ok && data?.success && data?.occupation) {
          const occ = data.occupation;
          setStepDetails((prev) => {
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

            const mergedTitle =
              occ.title != null
                ? occ.title
                : occ.preferredLabel != null && String(occ.preferredLabel).trim() !== ''
                  ? occ.preferredLabel
                  : prev?.title || '';
            const mergedDescription =
              occ.description != null && String(occ.description).trim() !== ''
                ? occ.description
                : prev?.description ?? '';
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
              careerPathId: occ._id || prev?.careerPathId,
              title: mergedTitle,
              description: mergedDescription,
              requiredSkills: mergedRequiredSkills,
              optionalSkills: mergedOptionalSkills,
              requiredSkillUris: occ.requiredSkillUris || prev?.requiredSkillUris,
              altTitles: Array.isArray(occ.altTitles) ? occ.altTitles : prev?.altTitles || [],
              hiddenTitles: Array.isArray(occ.hiddenTitles) ? occ.hiddenTitles : prev?.hiddenTitles || [],
              seniority: occ.seniority ?? prev?.seniority ?? null,
              keyResponsibilities: occ.keyResponsibilities ?? prev?.keyResponsibilities ?? null,
              skillDomains:
                occ.skillDomains != null ? occ.skillDomains : prev?.skillDomains ?? [],
              skillModel,
              _localizedLang: activeLang,
            };
          });
        }
      } catch (err) {
        console.warn('Failed to enrich required skills:', err);
      }
    };

    enrich();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepDetails, i18n.language, i18n.resolvedLanguage]);

  useEffect(() => {
    fetchStepDetails();
  }, [stepId, i18n.language, i18n.resolvedLanguage]);

  // Keep rating in sync with saved-steps list (matches card state; overrides stale sessionStorage)
  useEffect(() => {
    if (!stepId || !Array.isArray(savedCareerSteps) || savedCareerSteps.length === 0) return;
    const decoded = decodeURIComponent(stepId);
    const saved = savedCareerSteps.find(
      (s) => s.stepId === stepId || s.stepId === decoded
    );
    if (!saved) return;
    const ev = saved.userEvaluation;
    if (ev !== 'keep' && ev !== 'skip' && ev !== 'dislike') return;
    setStepDetails((prev) => {
      if (!prev) return prev;
      if (prev.userEvaluation === ev) return prev;
      return { ...prev, userEvaluation: ev };
    });
  }, [savedCareerSteps, stepId]);

  useEffect(() => {
    if (stepDetails) {
      setMatchScore(getCareerStepMatchScorePercent(stepDetails));
    }
  }, [stepDetails]);

  const fetchStepDetails = async () => {
    try {
      setLoading(true);
      
      const activeLang = i18n.resolvedLanguage || i18n.language || 'en';
      // Get step data from sessionStorage or fetch from API
      const storedData = sessionStorage.getItem('currentStepDetails');
      if (storedData) {
        const data = JSON.parse(storedData);
        setStepDetails(data);
      }

      // Always refresh from backend so title/description come from DB translations for active language.
      const response = await fetch(`/api/profile/saved-career-steps/${encodeURIComponent(stepId)}?lang=${encodeURIComponent(activeLang)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const localizedStep = data.savedCareerStep || data.step;
        if (localizedStep) {
          setStepDetails(localizedStep);
          try {
            sessionStorage.setItem('currentStepDetails', JSON.stringify(localizedStep));
          } catch {
            /* ignore */
          }
        }
      } else if (!storedData) {
        throw new Error(t('details.stepDetailsNotFound', { ns: 'dashboard' }));
      }
    } catch (err) {
      setError(t('details.errors.loadStepDetailsFailed', { ns: 'dashboard' }));
      console.error('Error fetching step details:', err);
    } finally {
      setLoading(false);
    }
  };

  const isStepSaved = () => {
    if (!savedCareerSteps || !Array.isArray(savedCareerSteps)) {
      return false;
    }
    const matched = findMatchingSavedCareerStep(stepDetails || {}, savedCareerSteps, { routeStepId: stepId });
    return !!matched;
  };

  const currentStepSaved = useMemo(
    () => isStepSaved(),
    [savedCareerSteps, stepDetails, stepId]
  );

  const handleBack = () => {
    // Check if we came from a saved simulation
    const savedSimulationId = sessionStorage.getItem('currentSimulationId');
    const locationState = location.state;
    
    if (savedSimulationId || (locationState && locationState.simulationId)) {
      // Navigate back to the saved simulation results
      const simulationId = savedSimulationId || locationState.simulationId;
      navigate('/simulation/results', { state: { simulationId, fromSaved: true } });
    } else {
      // Navigate back to the saved career steps page
      navigate('/saved-steps');
    }
  };

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleToggleSave = async () => {
    const isCurrentlySaved = isStepSaved();

    if (isCurrentlySaved) {
      setConfirmUnsaveOpen(true);
      return;
    }

    setSavingStep(true);

    try {
      // Save career step
      const stepData = {
        title: stepDetails.title,
        description: stepDetails.description,
        stepId: stepId,
        category: stepDetails.category || 'nextSteps',
        savedAt: new Date().toISOString(),
        industry: stepDetails.industry || 'Career Development',
        createdAt: stepDetails.createdAt || new Date().toISOString(),
        // Enrichment fields
        requiredSkills: stepDetails.requiredSkills || [],
        altTitles: stepDetails.altTitles || [],
        hiddenTitles: stepDetails.hiddenTitles || [],
        seniority: stepDetails.seniority || null,
        keyResponsibilities: stepDetails.keyResponsibilities || null,
        skillDomains: stepDetails.skillDomains || null,
        skillModel: stepDetails.skillModel || null,
        ...getMatchScoreFieldsForSave(stepDetails),
        ...pickUserEvaluationForSave(stepDetails),
      };

      console.log('💾 Saving career step with data:', stepData);

      const response = await fetch(`/api/profile/saved-career-steps?${getProfileApiLangQuery()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(stepData)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const newSavedSteps = data.savedCareerSteps || [];
          setSavedCareerStepsListQueryData(newSavedSteps);
          showSnackbar(t('simulation.messages.careerStepSaved', { ns: 'dashboard' }), 'success');
        } else {
          throw new Error(data.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }));
        }
      } else {
        const errorData = await response.text();
        console.error('❌ Save failed with response:', response.status, errorData);
        
        // Handle 409 duplicate error gracefully
        if (response.status === 409) {
          try {
            const duplicateData = JSON.parse(errorData);
            if (duplicateData.savedCareerSteps) {
              setSavedCareerStepsListQueryData(duplicateData.savedCareerSteps);
              showSnackbar(t('simulation.messages.alreadySaved', { ns: 'dashboard' }), 'info');
              return; // Don't throw error, just update state and show info message
            }
          } catch (parseErr) {
            console.error('Failed to parse duplicate error response:', parseErr);
          }
        }
        
        throw new Error(t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }));
      }
    } catch (err) {
      const errorMessage = err.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' });
      showSnackbar(errorMessage, 'error');
      console.error('Error toggling save:', err);
    } finally {
      setSavingStep(false);
    }
  };

  const handleConfirmUnsave = async () => {
    setConfirmUnsaveOpen(false);
    setSavingStep(true);

    try {
      // Find the actual stepId from saved career steps
      const decodedStepId = decodeURIComponent(stepId);
      console.log('🗑️ Removing career step:', { stepId, decodedStepId });
      
      // Find the saved step to get its actual stepId
      let actualStepId = null;
      
      // Helper function to normalize strings for comparison
      const normalizeString = (str) => {
        if (!str) return '';
        return str.toLowerCase().trim().replace(/\s+/g, ' ');
      };
      
      // Try to find the saved step using the same logic as isStepSaved
      if (savedCareerSteps && Array.isArray(savedCareerSteps)) {
        // First try exact stepId matching
        const savedStepById = savedCareerSteps.find(step => 
          step.stepId === stepId || 
          step.stepId === decodedStepId ||
          step.id === stepId ||
          step.id === decodedStepId
        );
        
        if (savedStepById) {
          actualStepId = savedStepById.stepId;
          console.log('✅ Found step by stepId:', actualStepId);
        } else {
          // Try matching by stepId containing the decoded stepId
          const normalizedDecodedStepId = decodedStepId.replace(/\s+/g, '-').toLowerCase();
          const savedStepByContains = savedCareerSteps.find(step => {
            if (step.stepId && step.stepId.toLowerCase().includes(normalizedDecodedStepId)) {
              console.log('✅ Found step by stepId contains:', { stepId: step.stepId, contains: normalizedDecodedStepId });
              return true;
            }
            return false;
          });
          
          if (savedStepByContains) {
            actualStepId = savedStepByContains.stepId;
          } else if (stepDetails) {
            // Try matching by content
            const normalizedTitle = normalizeString(stepDetails.title);
            const savedStepByContent = savedCareerSteps.find(step => {
              const stepTitle = normalizeString(step.title);
              return stepTitle === normalizedTitle;
            });
            
            if (savedStepByContent) {
              actualStepId = savedStepByContent.stepId;
              console.log('✅ Found step by content:', actualStepId);
            }
          }
        }
      }
      
      if (!actualStepId) {
        console.error('❌ Could not find actual stepId for removal:', { stepId, decodedStepId, savedSteps: savedCareerSteps });
        throw new Error(t('details.errors.savedStepNotFoundForRemoval', { ns: 'dashboard' }));
      }
      
      console.log('🗑️ Using actual stepId for removal:', actualStepId);
      
      const activeLang = i18n.resolvedLanguage || i18n.language || 'en';
      const response = await fetch(`/api/profile/saved-career-steps/${encodeURIComponent(actualStepId)}?lang=${encodeURIComponent(activeLang)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const newSavedSteps = data.savedCareerSteps || [];
          setSavedCareerStepsListQueryData(newSavedSteps);
          showSnackbar(t('simulation.messages.careerStepRemoved', { ns: 'dashboard' }), 'info');
          // Always navigate to the saved career steps overview page when unsaving from details
          navigate('/saved-steps');
        } else {
            throw new Error(data.message || t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }));
        }
      } else {
        const errorData = await response.text();
        console.error('❌ Delete failed with response:', response.status, errorData);
        throw new Error(t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }));
      }
    } catch (err) {
      const errorMessage = err.message || t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' });
      showSnackbar(errorMessage, 'error');
      console.error('Error removing saved career step:', err);
    } finally {
      setSavingStep(false);
    }
  };

  const handleShare = () => {
    setShareDialogOpen(true);
  };

  const handleEvaluationCommit = async (next) => {
    const id = stepDetails?.stepId || decodeURIComponent(stepId || '');
    if (!id) return;
    setEvaluationSaving(true);
    try {
      const activeLang = i18n.resolvedLanguage || i18n.language || 'en';
      const response = await fetch(`/api/profile/saved-career-steps/${encodeURIComponent(id)}?lang=${encodeURIComponent(activeLang)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ userEvaluation: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success && Array.isArray(data.savedCareerSteps)) {
        setSavedCareerStepsListQueryData(data.savedCareerSteps);
        setStepDetails((prev) => {
          if (!prev) return prev;
          const merged = { ...prev, userEvaluation: next };
          try {
            sessionStorage.setItem('currentStepDetails', JSON.stringify(merged));
          } catch {
            /* ignore */
          }
          return merged;
        });
      } else {
        showSnackbar(data.error || t('details.errors.updateRatingFailed', { ns: 'dashboard' }), 'error');
      }
    } catch (err) {
      console.error('Error updating saved step evaluation:', err);
      showSnackbar(t('details.errors.updateRatingFailed', { ns: 'dashboard' }), 'error');
    } finally {
      setEvaluationSaving(false);
    }
  };

  const formatDateShort = (timestamp) => {
    const date = new Date(timestamp);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
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

  if (!stepDetails) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Typography variant="h6" color="error">
          {t('details.stepDetailsNotFound', { ns: 'dashboard' })}
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
          value={stepDetails.userEvaluation}
          onCommit={handleEvaluationCommit}
          disabled={evaluationSaving}
        />
      </CardContent>
    </Card>
  );

  return (
      <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>

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
                  {stepDetails.title}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title={currentStepSaved ? t('details.actions.removeFromSavedSteps', { ns: 'dashboard' }) : t('details.actions.saveToSavedSteps', { ns: 'dashboard' })}>
                  <IconButton 
                    onClick={handleToggleSave}
                    disabled={savingStep}
                    aria-label={
                      savingStep
                        ? t('details.actions.saving', { ns: 'dashboard' })
                        : currentStepSaved
                          ? t('details.actions.removeFromSavedSteps', { ns: 'dashboard' })
                          : t('details.actions.saveToSavedSteps', { ns: 'dashboard' })
                    }
                    sx={{ 
                      color: 'var(--color-detail-header-actions-fg)', 
                      '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' },
                      backgroundColor: currentStepSaved ? 'var(--color-on-detail-header-overlay-selected)' : 'transparent'
                    }}
                  >
                    {savingStep ? <CircularProgress size={20} color="inherit" /> : (currentStepSaved ? <Star /> : <StarBorder />)}
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('details.actions.share', { ns: 'dashboard' })}>
                  <IconButton onClick={handleShare} sx={{ color: 'var(--color-detail-header-actions-fg)', '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' } }}>
                    <Share />
                  </IconButton>
                </Tooltip>
              </Box>
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

              {/* Saved Date */}
              <Grid item xs={12} sm={6} md={6}>
                <Box sx={{ textAlign: 'center', p: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'var(--color-detail-header-fg)', mb: 1 }}>
                    {formatDateShort(stepDetails.savedAt)}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    {t('details.labels.saved', { ns: 'dashboard' })}
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
              stepDetails={stepDetails}
              simulationScopeId={stepDetails?.simulationResultId || null}
              profileLoading={profileLoading}
            />

            {isStackedCareerDetailLayout ? userEvaluationCard : null}

            {/* Detailed Description */}
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  <Work sx={{ mr: 1, verticalAlign: 'middle' }} />
                  {t('details.labels.roleDescription', { ns: 'dashboard' })}
                </Typography>
                {splitDescriptionIntoParagraphs(stepDetails.description).length > 0 ? (
                  splitDescriptionIntoParagraphs(stepDetails.description).map((paragraph, index) => (
                    <Typography key={index} variant="body1" sx={{ mb: 2, fontWeight: index === 0 ? 700 : 400 }}>
                      {paragraph}
                    </Typography>
                  ))
                ) : (
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {t('details.labels.noDetailedDescription', { ns: 'dashboard' })}
                  </Typography>
                )}
              </CardContent>
            </Card>

            <CareerStepRoleInsightsCard stepDetails={stepDetails} key={`insights-${stepId}`} />

          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} lg={4}>
            {!isStackedCareerDetailLayout ? userEvaluationCard : null}

            <CareerStepRoleDetailsCard stepDetails={stepDetails} key={`details-${stepId}`} />

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

        <ConfirmationDialog
          open={confirmUnsaveOpen}
          onClose={() => setConfirmUnsaveOpen(false)}
          onConfirm={handleConfirmUnsave}
          title={t('details.unsaveDialog.title', { ns: 'dashboard' })}
          message={t('details.unsaveDialog.message', { ns: 'dashboard' })}
          confirmText={t('details.unsaveDialog.confirm', { ns: 'dashboard' })}
          cancelText={t('profilePage.actions.cancel', { ns: 'onboarding' })}
          severity="warning"
          loading={savingStep}
        />

        <ShareDialog
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          resultDetails={{
            resultId: stepDetails?.stepId || stepDetails?.id || decodeURIComponent(stepId || ''),
            title: stepDetails?.title || '',
            description: stepDetails?.description || '',
            category: stepDetails?.category || 'career-role',
            matchScore: Number.isFinite(matchScore) ? Math.round(matchScore) : undefined,
            seniority: stepDetails?.seniority,
            keyResponsibilities: stepDetails?.keyResponsibilities,
            skillDomains: stepDetails?.skillDomains,
            skillModel: stepDetails?.skillModel,
            altTitles: stepDetails?.altTitles,
            hiddenTitles: stepDetails?.hiddenTitles,
            requiredSkills: stepDetails?.requiredSkills,
            requiredSkillUris: stepDetails?.requiredSkillUris,
            escoId: stepDetails?.escoId
          }}
        />
      </Box>
  );
};

export default SavedCareerStepDetails; 