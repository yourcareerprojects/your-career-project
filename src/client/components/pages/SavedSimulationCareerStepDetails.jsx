import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Share
} from '@mui/icons-material';
import { LinearProgress } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ShareDialog from './ShareDialog';
import {
  CareerStepRoleInsightsCard,
  CareerStepRoleDetailsCard,
  CareerStepRoleFitCard,
} from '../common/CareerStepRoleSections';
import CareerStepUserEvaluationRow from '../common/CareerStepUserEvaluationRow';
import { generateStepId } from '../../utils/stepIdUtils';
import { getCareerStepMatchScorePercent, getMatchScoreFieldsForSave } from '../../utils/careerStepMatchScore';
import { pickUserEvaluationForSave } from '../../utils/savedCareerStepUserEvaluation';
import { resolveUserEvaluationFromEvaluationFlow } from '../../utils/simulationRoleRanking';
import { persistUserEvaluationToSavedSimulation } from '../../utils/persistSimulationEvaluation';
import {
  useSavedCareerStepsListQuery,
  useFullProfileQuery,
  setSavedCareerStepsListQueryData,
} from '../../hooks/useProfileQueries';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import { getRoleTitleEnglishForMatch, normalizeTextForI18nMatch } from '../../utils/roleTitleDisplay';
import { findMatchingSavedCareerStep } from '../../utils/savedCareerStepIdentity';
import { resolveSimulationRoleStepIdForSave } from '../../utils/resolveSimulationRoleStepIdForSave';

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

const SavedSimulationCareerStepDetails = () => {
  const { t } = useTranslation(['dashboard', 'onboarding']);
  const { i18n } = useTranslation();
  const { simulationId, stepId } = useParams();
  const navigate = useNavigate();
  const [stepDetails, setStepDetails] = useState(null);
  const [simulationDetails, setSimulationDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matchScore, setMatchScore] = useState(0);
  const { data: savedCareerSteps = [] } = useSavedCareerStepsListQuery();
  const { data: fullProfile, isLoading: profileLoading } = useFullProfileQuery();
  const [savingStep, setSavingStep] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [evaluationSaving, setEvaluationSaving] = useState(false);
  const [canonicalEscoByKey, setCanonicalEscoByKey] = useState({});
  const theme = useTheme();
  /** Matches `lg={8}` / `lg={4}` detail grid: when stacked, show evaluation after fit, before description. */
  const isStackedCareerDetailLayout = useMediaQuery(theme.breakpoints.down('lg'));

  // Re-fetch occupation details in active UI language for consistent backend-localized fields.
  useEffect(() => {
    if (stepDetails) {
      setMatchScore(getCareerStepMatchScorePercent(stepDetails));
    }
  }, [stepDetails]);

  // Enrich from DB if saved simulation payload lacks required skills
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

      const careerPathId = stepDetails.careerPathId;
      const escoId = stepDetails.escoId;
      const titleForQuery = titleToLookupString(stepDetails.title);
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
              skillDomains: occ.skillDomains != null ? occ.skillDomains : prev?.skillDomains ?? [],
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
    fetchSimulationAndStepDetails();
  }, [simulationId, stepId]);

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

  /** Saved list entries tied to this simulation only (avoids false "already saved" from other runs). */
  const savedStepsForThisSimulation = useMemo(() => {
    if (!Array.isArray(savedCareerSteps) || !simulationId) return [];
    const sid = String(simulationId).trim();
    return savedCareerSteps.filter(
      (s) => s && String(s.simulationResultId || '').trim() === sid
    );
  }, [savedCareerSteps, simulationId]);

  const savedCanonicalEscoIds = useMemo(() => {
    const next = new Set();
    if (!Array.isArray(savedStepsForThisSimulation) || savedStepsForThisSimulation.length === 0) return next;
    for (const step of savedStepsForThisSimulation) {
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
  }, [savedStepsForThisSimulation, canonicalEscoByKey, roleIdentityKey]);

  useEffect(() => {
    if (!stepDetails) return;
    void resolveCanonicalEscoId(stepDetails);
  }, [stepDetails, resolveCanonicalEscoId]);

  const fetchSimulationAndStepDetails = async () => {
    try {
      setLoading(true);
      
      // Fetch saved simulation details
      const simulationResponse = await fetch(`/api/profile/simulation/saved/${simulationId}?${getProfileApiLangQuery()}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!simulationResponse.ok) {
        throw new Error(t('details.simulationNotFound', { ns: 'dashboard' }));
      }

      const simulationData = await simulationResponse.json();
      setSimulationDetails(simulationData.simulation);

      // Find the specific career step within the simulation results
      console.log('Looking for stepId:', stepId);
      console.log('Simulation results:', simulationData.simulation.results);
      const step = findCareerStepInSimulation(simulationData.simulation.results, stepId);
      
      if (!step) {
        console.error('Career step not found in simulation results:', { stepId, results: simulationData.simulation.results });
        throw new Error(t('details.errors.careerStepNotFoundInSimulation', { ns: 'dashboard' }));
      }
      
      console.log('Found step:', step);

      const results = simulationData.simulation.results;
      const [evalMatched, evaluationFromFlow] = resolveUserEvaluationFromEvaluationFlow(results, step);
      const stepWithEval =
        evalMatched ? { ...step, userEvaluation: evaluationFromFlow } : step;

      setStepDetails(stepWithEval);

    } catch (err) {
      setError(t('details.errors.loadCareerStepDetailsFailed', { ns: 'dashboard' }));
      console.error('Error fetching simulation details:', err);
    } finally {
      setLoading(false);
    }
  };

  const findCareerStepInSimulation = (results, targetStepId) => {
    // Decode URL-encoded stepId
    const decodedStepId = decodeURIComponent(targetStepId);
    console.log('Searching for targetStepId:', targetStepId);
    console.log('Decoded stepId:', decodedStepId);
    console.log('Available categories:', Object.keys(results || {}));

    // Helper function to normalize strings for comparison
    const normalizeString = (str) => {
      if (!str) return '';
      return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    };
    
    // Helper function to check if two strings match (flexible matching)
    const isMatch = (str1, str2) => {
      if (!str1 || !str2) return false;
      const normalized1 = normalizeString(str1);
      const normalized2 = normalizeString(str2);
      return normalized1 === normalized2 || 
             normalized1.includes(normalized2) || 
             normalized2.includes(normalized1);
    };

    // Prefer evaluationFlow lists (often the only place roles exist when using Keep/Skip/Rank UI)
    const ef = results?.evaluationFlow;
    if (ef && typeof ef === 'object') {
      for (const category of ['nextSteps', 'outsideTheBox']) {
        const arr = ef[category];
        if (!Array.isArray(arr)) continue;
        const stepIndex = arr.findIndex((s) => {
          const matchIds = s.stepId === decodedStepId || s.id === decodedStepId;
          const matchTitle = isMatch(s.title, decodedStepId);
          return matchIds || matchTitle;
        });
        if (stepIndex >= 0) {
          const step = arr[stepIndex];
          return { ...step, category, sourceIndex: stepIndex };
        }
      }
      const ranked = ef.ranked;
      if (ranked && typeof ranked === 'object') {
        for (const category of ['nextSteps', 'outsideTheBox']) {
          const rows = ranked[category];
          if (!Array.isArray(rows)) continue;
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const inner = row?.step && typeof row.step === 'object' ? row.step : row;
            if (!inner || typeof inner !== 'object') continue;
            const matchIds = inner.stepId === decodedStepId || inner.id === decodedStepId;
            const matchTitle = isMatch(inner.title, decodedStepId);
            if (matchIds || matchTitle) {
              return { ...inner, category, sourceIndex: i };
            }
          }
        }
      }
    }
    
    // Search in nextSteps
    if (results.nextSteps) {
      console.log('Searching in nextSteps:', results.nextSteps.length, 'steps');
      const stepIndex = results.nextSteps.findIndex((s) => {
        const matchIds = s.stepId === decodedStepId || s.id === decodedStepId;
        const matchTitle = isMatch(s.title, decodedStepId);
        console.log('Checking step:', { title: s.title, stepId: s.stepId, id: s.id, matchIds, matchTitle });
        return matchIds || matchTitle;
      });
      if (stepIndex >= 0) {
        const step = results.nextSteps[stepIndex];
        console.log('Found in nextSteps:', step);
        return { ...step, category: 'nextSteps', sourceIndex: stepIndex };
      }
    }

    // Search in outsideSimulationBox
    if (results.outsideSimulationBox) {
      console.log('Searching in outsideSimulationBox:', results.outsideSimulationBox.length, 'steps');
      const stepIndex = results.outsideSimulationBox.findIndex((s) => {
        const matchIds = s.stepId === decodedStepId || s.id === decodedStepId;
        const matchTitle = isMatch(s.title, decodedStepId);
        console.log('Checking step:', { title: s.title, stepId: s.stepId, id: s.id, matchIds, matchTitle });
        return matchIds || matchTitle;
      });
      if (stepIndex >= 0) {
        const step = results.outsideSimulationBox[stepIndex];
        console.log('Found in outsideSimulationBox:', step);
        return { ...step, category: 'outsideSimulationBox', sourceIndex: stepIndex };
      }
    }

    // Search in furtherAdvice
    if (results.furtherAdvice) {
      console.log('Searching in furtherAdvice:', results.furtherAdvice.length, 'steps');
      const stepIndex = results.furtherAdvice.findIndex((s) => {
        const matchIds = s.stepId === decodedStepId || s.id === decodedStepId;
        const matchTitle = isMatch(s.title, decodedStepId);
        console.log('Checking step:', { title: s.title, stepId: s.stepId, id: s.id, matchIds, matchTitle });
        return matchIds || matchTitle;
      });
      if (stepIndex >= 0) {
        const step = results.furtherAdvice[stepIndex];
        console.log('Found in furtherAdvice:', step);
        return { ...step, category: 'furtherAdvice', sourceIndex: stepIndex };
      }
    }

    // Fallback: search in all categories
    for (const category of Object.keys(results)) {
      if (Array.isArray(results[category])) {
        const stepIndex = results[category].findIndex((s) =>
          s.stepId === decodedStepId || 
          s.id === decodedStepId ||
          isMatch(s.title, decodedStepId)
        );
        if (stepIndex >= 0) {
          const step = results[category][stepIndex];
          console.log('Found in fallback search:', step);
          return { ...step, category, sourceIndex: stepIndex };
        }
      }
    }

    console.log('Step not found in any category');
    return null;
  };


  const handleBack = () => {
    navigate(`/simulation/${simulationId}`);
  };

  const findSavedCareerStepRecord = useCallback(() => {
    if (!savedStepsForThisSimulation?.length || !stepDetails) return null;
    const matchedBySharedIdentity = findMatchingSavedCareerStep(stepDetails, savedStepsForThisSimulation, {
      routeStepId: stepId,
    });
    if (matchedBySharedIdentity) return matchedBySharedIdentity;
    const decodedStepId = decodeURIComponent(stepId);
    const normalizeId = (value) => String(value || '').trim().toLowerCase();
    const normalizeCategory = (value) => {
      const raw = String(value || '').trim().toLowerCase();
      if (
        raw === 'outsidesimulationbox' ||
        raw === 'outside-the-box' ||
        raw === 'outside_the_box' ||
        raw === 'outsidetheboxroles'
      ) {
        return 'outsidethebox';
      }
      return raw;
    };
    const routeStepIdKey = normalizeId(stepId);
    const decodedStepIdKey = normalizeId(decodedStepId);
    const detailIds = new Set(
      [
        stepDetails.stepId,
        stepDetails.id,
        stepDetails.resultId,
        stepDetails.simulationResultId,
        stepId,
        decodedStepId,
      ]
        .map(normalizeId)
        .filter(Boolean)
    );
    let r = savedStepsForThisSimulation.find((s) => {
      const candidateIds = [s.stepId, s.id, s.simulationResultId]
        .map(normalizeId)
        .filter(Boolean);
      return candidateIds.some((id) => detailIds.has(id));
    });
    if (r) return r;

    const sourceIndex = Number.isFinite(stepDetails.sourceIndex) ? stepDetails.sourceIndex : 0;
    const detailCategory = stepDetails.category || 'nextSteps';
    const canonicalCategory = normalizeCategory(detailCategory) === 'outsidethebox' ? 'outsideTheBox' : detailCategory;
    const slugTitle = getRoleTitleEnglishForMatch(stepDetails.title) || stepDetails.title;
    const deterministicStepIds = [
      generateStepId(slugTitle, simulationId, canonicalCategory, sourceIndex),
      generateStepId(slugTitle, simulationId, 'outsideTheBox', sourceIndex),
      generateStepId(slugTitle, simulationId, 'outsideSimulationBox', sourceIndex),
    ]
      .map(normalizeId)
      .filter(Boolean);
    if (deterministicStepIds.length) {
      r = savedStepsForThisSimulation.find((s) => {
        const candidate = normalizeId(s.stepId || s.id);
        return deterministicStepIds.includes(candidate);
      });
      if (r) return r;
    }

    const normalizedDecodedStepId = decodedStepIdKey.replace(/\s+/g, '-');
    r = savedStepsForThisSimulation.find(
      (s) => {
        const candidate = normalizeId(s.stepId);
        return (
          (routeStepIdKey && candidate.includes(routeStepIdKey)) ||
          (decodedStepIdKey && candidate.includes(decodedStepIdKey)) ||
          (normalizedDecodedStepId && candidate.includes(normalizedDecodedStepId))
        );
      }
    );
    if (r) return r;

    const detailEscoId = normalizeId(stepDetails.escoId);
    if (detailEscoId) {
      r = savedStepsForThisSimulation.find((s) => normalizeId(s.escoId) === detailEscoId);
      if (r) return r;
    }

    const detailCareerPathId = normalizeId(stepDetails.careerPathId);
    if (detailCareerPathId) {
      r = savedStepsForThisSimulation.find((s) => normalizeId(s.careerPathId) === detailCareerPathId);
      if (r) return r;
    }

    const normalizedTitle =
      normalizeTextForI18nMatch(stepDetails.title) ||
      normalizeTextForI18nMatch(getRoleTitleEnglishForMatch(stepDetails.title));
    const normalizedDetailCategory = normalizeCategory(stepDetails.category);
    if (normalizedTitle) {
      r = savedStepsForThisSimulation.find((s) => {
        const savedTitle =
          normalizeTextForI18nMatch(s.title) ||
          normalizeTextForI18nMatch(getRoleTitleEnglishForMatch(s.title));
        if (savedTitle !== normalizedTitle) return false;
        const savedCategory = normalizeCategory(s.category);
        return !normalizedDetailCategory || !savedCategory || savedCategory === normalizedDetailCategory;
      });
      if (r) return r;
    }
    const normalizedDescription = normalizeTextForI18nMatch(stepDetails.description);
    if (normalizedTitle && normalizedDescription) {
      r = savedStepsForThisSimulation.find(
        (s) =>
          normalizeTextForI18nMatch(s.title) === normalizedTitle &&
          normalizeTextForI18nMatch(s.description) === normalizedDescription
      );
      if (r) return r;
    }

    const roleCanonicalEsco = resolveCanonicalEscoIdFromCache(stepDetails);
    if (roleCanonicalEsco) {
      r = savedStepsForThisSimulation.find((s) => resolveCanonicalEscoIdFromCache(s) === roleCanonicalEsco);
      if (r) return r;
    }

    return null;
  }, [savedStepsForThisSimulation, stepDetails, stepId, resolveCanonicalEscoIdFromCache, simulationId]);

  const currentStepSaved = useMemo(() => {
    if (!savedCareerSteps || !Array.isArray(savedCareerSteps) || !stepDetails) return false;
    if (findSavedCareerStepRecord()) return true;
    const roleCanonicalEsco = resolveCanonicalEscoIdFromCache(stepDetails);
    return !!(roleCanonicalEsco && savedCanonicalEscoIds.has(roleCanonicalEsco));
  }, [
    savedCareerSteps,
    stepDetails,
    findSavedCareerStepRecord,
    resolveCanonicalEscoIdFromCache,
    savedCanonicalEscoIds
  ]);

  const handleEvaluationCommit = async (next) => {
    if (!stepDetails || !simulationId) return;
    setEvaluationSaving(true);
    try {
      const updatedSimulation = await persistUserEvaluationToSavedSimulation(
        simulationId,
        stepDetails,
        next,
        { existingSimulation: simulationDetails }
      );
      setSimulationDetails(updatedSimulation);
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
      showSnackbar(t('details.messages.ratingSavedToSimulation', { ns: 'dashboard' }), 'success');
    } catch (err) {
      console.error('Error updating evaluation:', err);
      showSnackbar(err.message || t('details.errors.updateRatingFailed', { ns: 'dashboard' }), 'error');
    } finally {
      setEvaluationSaving(false);
    }
  };

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleToggleSave = async () => {
    if (!stepDetails) {
      showSnackbar(t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }), 'error');
      return;
    }
    const isCurrentlySaved = currentStepSaved;
    setSavingStep(true);

    try {
      if (isCurrentlySaved) {
        const savedRecord = findSavedCareerStepRecord();
        const actualStepId = savedRecord?.stepId || null;

        if (!actualStepId) {
          const decodedStepId = decodeURIComponent(stepId);
          console.error('Could not find actual stepId for removal:', {
            stepId,
            decodedStepId,
            savedSteps: savedStepsForThisSimulation,
          });
          throw new Error(t('details.errors.savedStepNotFoundForRemoval', { ns: 'dashboard' }));
        }
        
        console.log('Using actual stepId for removal:', actualStepId);
        
        const response = await fetch(`/api/profile/saved-career-steps/${encodeURIComponent(actualStepId)}`, {
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
          } else {
            throw new Error(data.message || t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }));
          }
        } else {
          const errorData = await response.text();
          console.error('Delete failed with response:', response.status, errorData);
          throw new Error(t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }));
        }
      } else {
        const titleForSave =
          stepDetails.title != null &&
          (typeof stepDetails.title === 'object' ||
            (typeof stepDetails.title === 'string' && stepDetails.title.trim() !== ''))
            ? stepDetails.title
            : getRoleTitleEnglishForMatch(stepDetails.title) ||
              String(stepDetails.escoId || '').trim() ||
              'Career step';
        const properStepId = resolveSimulationRoleStepIdForSave(stepDetails, simulationDetails, simulationId, {
          routeStepId: stepId,
        });

        const stepData = {
          title: titleForSave,
          description: stepDetails.description,
          stepId: properStepId,
          escoId: stepDetails.escoId || null,
          category: stepDetails.category || 'nextSteps',
          savedAt: new Date().toISOString(),
          simulationResultId: simulationId,
          // Include any additional fields that might be needed
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

        console.log('Saving career step with data:', stepData);

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
          console.error('Save failed with response:', response.status, errorData);
          
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
          
          let serverHint = '';
          try {
            const parsed = JSON.parse(errorData);
            if (parsed?.details && Array.isArray(parsed.details)) {
              serverHint = ` ${parsed.details.join('; ')}`;
            } else if (parsed?.error) {
              serverHint = ` ${parsed.error}`;
            }
          } catch {
            /* ignore */
          }
          throw new Error(
            `${t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' })}${serverHint}`.trim()
          );
        }
      }
    } catch (err) {
      const errorMessage = err.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' });
      showSnackbar(errorMessage, 'error');
      console.error('Error toggling save:', err);
    } finally {
      setSavingStep(false);
    }
  };

  const handleShare = () => {
    setShareDialogOpen(true);
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
          {t('details.actions.backToSimulation', { ns: 'dashboard' })}
        </Button>
      </Box>
    );
  }

  if (!stepDetails || !simulationDetails) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Alert severity="warning" sx={{ mb: 3 }}>
          {t('details.errors.careerStepNotFoundInSimulation', { ns: 'dashboard' })}
        </Alert>
        <Button variant="contained" onClick={handleBack}>
          {t('details.actions.backToSimulation', { ns: 'dashboard' })}
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
                <Tooltip title={t('details.actions.backToSimulation', { ns: 'dashboard' })}>
                  <IconButton
                    onClick={handleBack}
                    aria-label={t('details.actions.backToSimulation', { ns: 'dashboard' })}
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
                    data-testid="saved-simulation-detail-save-toggle"
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

              {/* Simulation Date */}
              <Grid item xs={12} sm={6} md={6}>
                <Box sx={{ textAlign: 'center', p: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'var(--color-detail-header-fg)', mb: 1 }}>
                    {(simulationDetails.timestamp ?? simulationDetails.createdAt ?? simulationDetails.date)
                      ? formatDateShort(
                          simulationDetails.timestamp ?? simulationDetails.createdAt ?? simulationDetails.date
                        )
                      : t('details.labels.unknown', { ns: 'dashboard' })}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    {t('details.labels.simulationDate', { ns: 'dashboard' })}
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
              simulationScopeId={simulationId}
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

            <CareerStepRoleInsightsCard stepDetails={stepDetails} key={`insights-${simulationId}-${stepId}`} />
          </Grid>

          {/* Sidebar */}
          <Grid item xs={12} lg={4}>
            {!isStackedCareerDetailLayout ? userEvaluationCard : null}

            <CareerStepRoleDetailsCard stepDetails={stepDetails} key={`details-${simulationId}-${stepId}`} />

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

export default SavedSimulationCareerStepDetails;
