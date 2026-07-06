import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Work,
  Star,
  StarBorder,
  Share
} from '@mui/icons-material';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ShareDialog from './ShareDialog';
import {
  CareerStepRoleInsightsCard,
  CareerStepRoleDetailsCard,
  CareerStepRoleFitCard,
} from '../common/CareerStepRoleSections';
import CareerStepUserEvaluationRow from '../common/CareerStepUserEvaluationRow';
import { generateResultStepId } from '../../utils/stepIdUtils';
import { getCareerStepMatchScorePercent, getMatchScoreFieldsForSave } from '../../utils/careerStepMatchScore';
import { pickUserEvaluationForSave } from '../../utils/savedCareerStepUserEvaluation';
import { persistUserEvaluationToSavedSimulation } from '../../utils/persistSimulationEvaluation';
import { getSimulationResultDetails, storeSimulationResultDetails } from '../../utils/simulationResultSessionStore';
import { applyUserEvaluationToResultsSnapshot } from '../../utils/simulationEvaluationPropagation';
import {
  useSavedCareerStepsListQuery,
  useFullProfileQuery,
  setSavedCareerStepsListQueryData,
} from '../../hooks/useProfileQueries';
import {
  getRoleTitleForLocale,
  getRoleTitleEnglishForMatch,
  normalizeTextForI18nMatch,
} from '../../utils/roleTitleDisplay';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import { loadSimulationFromStorage, saveSimulationToStorage } from '../../utils/simulationPersistence';
import { findMatchingSavedCareerStep } from '../../utils/savedCareerStepIdentity';
import localizedContentService from '../../utils/localizedContentService';

const MAX_VISIBLE_SKILL_DOMAINS = 8;

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
  const { data: savedCareerSteps = [], isLoading: loadingCareerSteps } = useSavedCareerStepsListQuery();
  const { data: fullProfile, isLoading: profileLoading } = useFullProfileQuery();
  const savedCareerStepsRef = useRef([]);
  useEffect(() => {
    savedCareerStepsRef.current = savedCareerSteps;
  }, [savedCareerSteps]);
  // State to track which career steps are being saved/unsaved
  const [savingSteps, setSavingSteps] = useState(new Set());
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

  useEffect(() => {
    fetchResultDetails();
  }, [resultId]);

  const normalizeStorageId = (value) => {
    if (value == null) return '';
    try {
      return decodeURIComponent(String(value)).trim().toLowerCase();
    } catch {
      return String(value).trim().toLowerCase();
    }
  };

  const candidateMatchesRoute = (candidate, routeId) => {
    if (!candidate || !routeId) return false;
    const candidateIds = [
      candidate.resultId,
      candidate.stepId,
      candidate.id,
      getRoleTitleEnglishForMatch(candidate.title),
    ];
    return candidateIds.some((id) => normalizeStorageId(id) === routeId);
  };

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
        const rawUnsaved = sessionStorage.getItem('currentUnsavedResults');
        if (rawUnsaved) {
          const parsedUnsaved = JSON.parse(rawUnsaved);
          const patchedUnsavedResults = applyUserEvaluationToResultsSnapshot(
            parsedUnsaved?.results,
            nextEvaluation,
            roleMatchesCurrentResult
          );
          if (patchedUnsavedResults && patchedUnsavedResults !== parsedUnsaved?.results) {
            sessionStorage.setItem(
              'currentUnsavedResults',
              JSON.stringify({ ...parsedUnsaved, results: patchedUnsavedResults })
            );
          }
        }
      } catch (error) {
        console.warn('Failed to persist evaluation to currentUnsavedResults:', error);
      }

      try {
        const stored = loadSimulationFromStorage();
        if (!stored?.results) return;
        const patchedStoredResults = applyUserEvaluationToResultsSnapshot(
          stored.results,
          nextEvaluation,
          roleMatchesCurrentResult
        );
        if (!patchedStoredResults || patchedStoredResults === stored.results) return;
        saveSimulationToStorage(
          {
            results: patchedStoredResults,
            simulationDate: stored.metadata?.simulationDate || new Date().toISOString(),
            profileCompletion: stored.metadata?.profileCompletion ?? null,
          },
          stored.state === 'saved' ? 'saved' : 'modified'
        );
      } catch (error) {
        console.warn('Failed to persist evaluation to simulation session storage:', error);
      }
    },
    [roleMatchesCurrentResult]
  );

  const fetchResultDetails = async () => {
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
  };

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

  const savedCanonicalEscoIds = useMemo(() => {
    const next = new Set();
    const currentSavedSteps = savedCareerStepsRef.current;
    if (!Array.isArray(currentSavedSteps) || currentSavedSteps.length === 0) return next;
    for (const step of currentSavedSteps) {
      const direct = String(step?.escoId || '').trim().toLowerCase();
      if (direct) {
        next.add(direct);
        continue;
      }
      const key = roleIdentityKey(step);
      if (!key) continue;
      const cached = String(canonicalEscoByKey[key] || '').trim().toLowerCase();
      if (cached) next.add(cached);
    }
    return next;
  }, [savedCareerSteps, canonicalEscoByKey, roleIdentityKey]);

  useEffect(() => {
    if (!resultDetails) return;
    void resolveCanonicalEscoId(resultDetails);
  }, [resultDetails, resolveCanonicalEscoId]);

  const findSavedStepForResult = useCallback((role) => {
    const currentSavedSteps = savedCareerStepsRef.current;
    return findMatchingSavedCareerStep(role, currentSavedSteps);
  }, []);

  const findSavedStepForResultWithCanonical = useCallback(
    (role) => {
      const byDefault = findSavedStepForResult(role);
      if (byDefault) return byDefault;
      const currentSavedSteps = savedCareerStepsRef.current;
      if (!Array.isArray(currentSavedSteps) || currentSavedSteps.length === 0) return null;
      const roleEsco = resolveCanonicalEscoIdFromCache(role);
      if (!roleEsco) return null;
      return (
        currentSavedSteps.find((step) => {
          const stepEsco = resolveCanonicalEscoIdFromCache(step);
          return !!stepEsco && stepEsco === roleEsco;
        }) || null
      );
    },
    [findSavedStepForResult, resolveCanonicalEscoIdFromCache]
  );

  const isStepSaved = (role) => {
    // Use the ref for immediate access to the most up-to-date saved career steps
    const currentSavedSteps = savedCareerStepsRef.current;
    
    if (!currentSavedSteps || !Array.isArray(currentSavedSteps)) {
      return false;
    }

    const byDefault = findSavedStepForResult(role);
    if (byDefault) return true;

    const roleEsco = resolveCanonicalEscoIdFromCache(role);
    if (roleEsco && savedCanonicalEscoIds.has(roleEsco)) return true;

    return false;
  };

  // Helper function to check if a specific step is being saved/unsaved
  const isStepSaving = (role) => {
    const id = role.stepId || getRoleTitleEnglishForMatch(role.title) || 'career-step';
    return savingSteps.has(id);
  };

  const currentResultSaved = useMemo(
    () => (resultDetails ? isStepSaved(resultDetails) : false),
    [resultDetails, savedCareerSteps, canonicalEscoByKey, savedCanonicalEscoIds, findSavedStepForResult, resolveCanonicalEscoIdFromCache]
  );

  const currentResultSaving = useMemo(
    () => (resultDetails ? isStepSaving(resultDetails) : false),
    [resultDetails, savingSteps]
  );

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleEvaluationCommit = async (next) => {
    if (!resultDetails) return;
    setEvaluationSaving(true);
    try {
      const savedSimIdForContext =
        location.state?.returnTo === 'saved'
          ? location.state?.simulationId || sessionStorage.getItem('currentSimulationId')
          : null;
      const writeToSavedSimulation = location.state?.returnTo === 'saved' && !!savedSimIdForContext;

      if (writeToSavedSimulation) {
        await persistUserEvaluationToSavedSimulation(
          savedSimIdForContext,
          resultDetails,
          next
        );
        showSnackbar(t('details.messages.ratingSavedToSimulation', { ns: 'dashboard' }), 'success');
      } else {
        const savedStep = findSavedStepForResultWithCanonical(resultDetails);
        if (savedStep) {
          const res = await fetch(
            `/api/profile/saved-career-steps/${encodeURIComponent(savedStep.stepId)}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token')}`,
              },
              body: JSON.stringify({ userEvaluation: next }),
            }
          );
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.success && Array.isArray(data.savedCareerSteps)) {
            setSavedCareerStepsListQueryData(data.savedCareerSteps);
            savedCareerStepsRef.current = data.savedCareerSteps;
            showSnackbar(t('details.messages.ratingSavedToSavedSteps', { ns: 'dashboard' }), 'success');
          } else {
            showSnackbar(data.error || t('details.errors.updateRatingFailed', { ns: 'dashboard' }), 'error');
            return;
          }
        }
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
    const savedSimulationId = sessionStorage.getItem('currentSimulationId');
    
    console.log('handleBack called with location state:', locationState);
    console.log('savedSimulationId from sessionStorage:', savedSimulationId);
    
    // Check navigation context from location state first, then fallback to sessionStorage
    if (locationState && locationState.returnTo === 'saved') {
      console.log('Returning to saved simulation:', locationState.simulationId);
      // Return to saved simulation results
      const simulationId = locationState.simulationId || savedSimulationId;
      navigate('/simulation/results', { state: { simulationId, fromSaved: true } });
    } else if (locationState && locationState.returnTo === 'unsaved') {
      console.log('Returning to unsaved simulation results');
      // Return to unsaved simulation results
      navigate('/simulation/results', { state: { refresh: true, showUnsavedResults: true } });
    } else if (savedSimulationId) {
      console.log('Fallback: returning to saved simulation from sessionStorage');
      // Fallback: check sessionStorage for saved simulation
      navigate('/simulation/results', { state: { simulationId: savedSimulationId, fromSaved: true } });
    } else {
      console.log('Default: returning to general simulation page');
      // Default: return to general simulation page
      navigate('/simulation/results', { state: { refresh: true } });
    }
  };

  const handleSave = async () => {
    if (!resultDetails) return;

    // Create a stable id for loading state
    const savingKey = resultDetails.stepId || getRoleTitleEnglishForMatch(resultDetails.title) || 'career-step';
    setSavingSteps((prev) => new Set(prev).add(savingKey));

    try {
      if (isStepSaved(resultDetails)) {
        // Remove - find the saved step to get its stepId
        const currentSavedSteps = savedCareerStepsRef.current;
        if (!currentSavedSteps || !Array.isArray(currentSavedSteps)) {
          showSnackbar(t('simulation.messages.noSavedCareerSteps', { ns: 'dashboard' }), 'error');
          return;
        }
        const savedStep = findSavedStepForResultWithCanonical(resultDetails);
        
        if (!savedStep) {
          showSnackbar(t('simulation.messages.careerStepNotFound', { ns: 'dashboard' }), 'error');
          return;
        }

        const res = await fetch(`/api/profile/saved-career-steps/${encodeURIComponent(savedStep.stepId)}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const data = await res.json();
        if (data.success) {
          const updatedSteps = data.savedCareerSteps || [];
          setSavedCareerStepsListQueryData(updatedSteps);
          savedCareerStepsRef.current = updatedSteps;
          showSnackbar(t('simulation.messages.careerStepRemoved', { ns: 'dashboard' }), 'info');
        } else {
          showSnackbar(data.message || t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }), 'error');
        }
      } else {
        // Save - prefer server-provided deterministic stepId, fallback to legacy generator
        const saveStepId = resultDetails.stepId || generateResultStepId(
          resultDetails.title,
          resultDetails.simulationId || 'local',
          resultDetails.resultId
        );
        
        const saveData = {
          stepId: saveStepId,
          title: resultDetails.title,
          description: resultDetails.description,
          escoId: resultDetails.escoId || null,
          simulationResultId:
            resultDetails.simulationId ||
            (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('currentSimulationId') : null) ||
            'local',
          category: resultDetails.category || 'nextSteps',
          industry: resultDetails.industry || 'Career Development',
          savedAt: new Date().toISOString(),
          // Enrichment fields
          requiredSkills: resultDetails.requiredSkills || [],
          altTitles: resultDetails.altTitles || [],
          hiddenTitles: resultDetails.hiddenTitles || [],
          seniority: resultDetails.seniority || null,
          keyResponsibilities: resultDetails.keyResponsibilities || null,
          skillDomains: resultDetails.skillDomains || null,
          skillModel: resultDetails.skillModel || null,
          ...getMatchScoreFieldsForSave(resultDetails),
          ...pickUserEvaluationForSave(resultDetails),
        };

        console.log('💾 Saving career step with data:', saveData);

        const res = await fetch(`/api/profile/saved-career-steps?${getProfileApiLangQuery()}`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(saveData),
        });

        if (!res.ok) {
          const errorData = await res.text();
          console.error('❌ Save failed with response:', res.status, errorData);
          if (res.status === 409) {
            try {
              const duplicateData = JSON.parse(errorData);
              if (duplicateData.savedCareerSteps) {
                setSavedCareerStepsListQueryData(duplicateData.savedCareerSteps);
                savedCareerStepsRef.current = duplicateData.savedCareerSteps;
              }
              showSnackbar(duplicateData.message || t('simulation.messages.alreadySaved', { ns: 'dashboard' }), 'info');
              return;
            } catch {
              showSnackbar(t('simulation.messages.alreadySaved', { ns: 'dashboard' }), 'info');
              return;
            }
          }
          throw new Error(t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }));
        }

        const data = await res.json();
        if (data.success) {
          const updatedSteps = data.savedCareerSteps || [];
          setSavedCareerStepsListQueryData(updatedSteps);
          savedCareerStepsRef.current = updatedSteps;
          showSnackbar(t('simulation.messages.careerStepSaved', { ns: 'dashboard' }), 'success');
        } else if (data.message === 'Career step already saved' || res.status === 409) {
          // Handle duplicate detection response
          if (data.duplicateType === 'semantic' && data.similarity < 1.0) {
            showSnackbar(`${data.message} (${Math.round(data.similarity * 100)}% similar)`, 'warning');
          } else {
            showSnackbar(data.message || t('simulation.messages.alreadySaved', { ns: 'dashboard' }), 'info');
          }
        } else {
          console.error('❌ Save failed with data:', data);
          showSnackbar(data.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }), 'error');
        }
      }
    } catch (err) {
      console.error('Error in handleSave:', err);
      const errorMessage = err.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' });
      showSnackbar(errorMessage, 'error');
    } finally {
      // Clear loading state for this specific step
      setSavingSteps((prev) => {
        const newSet = new Set(prev);
        newSet.delete(savingKey);
        return newSet;
      });
    }
  };

  const handleShare = () => {
    setShareDialogOpen(true);
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
                {getRoleTitleForLocale(localizeAiText(resultDetails.title, ''), currentLang)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {!loadingCareerSteps && !currentResultSaving ? (
                <Tooltip
                  title={
                    currentResultSaved
                      ? t('details.actions.removeFromSavedSteps', { ns: 'dashboard' })
                      : t('details.actions.saveToSavedSteps', { ns: 'dashboard' })
                  }
                >
                  <IconButton 
                    onClick={handleSave} 
                    aria-label={
                      currentResultSaved
                        ? t('details.actions.removeFromSavedSteps', { ns: 'dashboard' })
                        : t('details.actions.saveToSavedSteps', { ns: 'dashboard' })
                    }
                    data-testid="simulation-detail-save-toggle"
                    sx={{ 
                      color: 'var(--color-detail-header-actions-fg)', 
                      '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' },
                      backgroundColor: currentResultSaved ? 'var(--color-on-detail-header-overlay-selected)' : 'transparent'
                    }}
                  >
                    {currentResultSaved ? <Star /> : <StarBorder />}
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip title={t('details.actions.saving', { ns: 'dashboard' })}>
                  <IconButton 
                    disabled
                    sx={{ 
                      color: 'var(--color-detail-header-actions-fg)', 
                      opacity: 0.6,
                      backgroundColor: 'var(--color-on-detail-header-overlay-hover)'
                    }}
                  >
                    <CircularProgress size={20} color="inherit" />
                  </IconButton>
                </Tooltip>
              )}
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
              (typeof sessionStorage !== 'undefined'
                ? sessionStorage.getItem('currentSimulationId')
                : null) ||
              'local'
            }
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
              {splitDescriptionIntoParagraphs(localizeAiText(resultDetails.description, '')).length > 0 ? (
                splitDescriptionIntoParagraphs(localizeAiText(resultDetails.description, '')).map((paragraph, index) => (
                  <Typography key={index} variant="body1" sx={{ mb: 2, fontWeight: index === 0 ? 700 : 400 }}>
                    {paragraph}
                  </Typography>
                ))
              ) : (
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {t('details.labels.noDetailedDescription', { ns: 'dashboard' })}
                </Typography>
              )}
              
              {resultDetails.category === 'resources' && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                    {t('details.labels.additionalInformation', { ns: 'dashboard' })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('details.labels.resourceHelpText', { ns: 'dashboard' })}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>

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