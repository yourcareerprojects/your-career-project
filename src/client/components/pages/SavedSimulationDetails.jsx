import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  IconButton,
  Tooltip,
  Grid,
  Card,
  CardContent,
  Paper
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

// Import components
import CareerStepCardWithReplacement from '../common/CareerStepCardWithReplacement';
import SimulationCategoryEvaluation from '../common/SimulationCategoryEvaluation';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import SaveChangesButton from '../common/SaveChangesButton';
import SaveChangesDialog from '../common/SaveChangesDialog';
import UnsavedChangesIndicator from '../common/UnsavedChangesIndicator';
// import ShareDialog from './ShareDialog'; // TODO: Create simulation-specific share dialog

// Import hooks
import useUpdateSimulation from '../../hooks/useUpdateSimulation';
import useChangeDetection from '../../hooks/useChangeDetection';
import { getMatchScoreFieldsForSave } from '../../utils/careerStepMatchScore';
import { pickUserEvaluationForSave } from '../../utils/savedCareerStepUserEvaluation';
import {
  buildRankedRows,
  buildRankedRowsFromOrderedRoles,
  isEvaluationComplete,
} from '../../utils/simulationRoleRanking';
import { useSimulationRankingsCompleteCelebration } from '../../hooks/useSimulationRankingsCompleteCelebration';
import SimulationRankingsCompleteCelebration from '../common/SimulationRankingsCompleteCelebration';
import {
  invalidateSavedSimulationsListQuery,
  useSavedCareerStepsListQuery,
  setSavedCareerStepsListQueryData,
  baseUILanguage,
} from '../../hooks/useProfileQueries';
import {
  getRoleTitleEnglishForMatch,
  normalizeTextForI18nMatch,
} from '../../utils/roleTitleDisplay';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import { findMatchingSavedCareerStep } from '../../utils/savedCareerStepIdentity';
import { resolveSimulationRoleStepIdForSave } from '../../utils/resolveSimulationRoleStepIdForSave';
import localizedContentService from '../../utils/localizedContentService';

/** DD.MM.YYYY — aligned with saved simulation career step detail */
const formatSimulationDateShort = (timestamp) => {
  const date = new Date(timestamp);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
};

const SavedSimulationDetails = () => {
  const { t } = useTranslation(['dashboard', 'onboarding']);
  const { simulationId } = useParams();
  const navigate = useNavigate();
  const { guardedNavigate } = useNavigationGuardContext();

  // State management
  const [simulation, setSimulation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  // const [shareDialogOpen, setShareDialogOpen] = useState(false); // TODO: Implement simulation sharing
  const [saveChangesDialogOpen, setSaveChangesDialogOpen] = useState(false);
  const [savingChanges, setSavingChanges] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  
  const { data: savedCareerSteps = [] } = useSavedCareerStepsListQuery();
  const [savingSteps, setSavingSteps] = useState(new Set());
  const savedCareerStepsRef = useRef([]);
  const [canonicalEscoByKey, setCanonicalEscoByKey] = useState({});
  const [savedCanonicalEscoIds, setSavedCanonicalEscoIds] = useState(new Set());

  // Original simulation data for change detection
  const [originalSimulationData, setOriginalSimulationData] = useState(null);

  // Hooks
  const { updateSimulation, loading: updateLoading, error: updateError } = useUpdateSimulation();
  const { hasChanges, resetChanges, getChangeSummary } = useChangeDetection(
    originalSimulationData,
    simulation
  );
  const requestLang = baseUILanguage();
  const localizeAiText = useCallback(
    (field, missing = '[MISSING]') => localizedContentService.getLocalizedWithFallback(field, requestLang, missing),
    [requestLang]
  );

  const rankingsCelebration = useSimulationRankingsCompleteCelebration(
    simulation?.results?.evaluationFlow
  );

  // Load simulation data
  useEffect(() => {
    if (simulationId) {
      fetchSimulation();
    }
  }, [simulationId, requestLang]);

  useEffect(() => {
    savedCareerStepsRef.current = savedCareerSteps;
  }, [savedCareerSteps]);

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
    let cancelled = false;
    const currentSavedSteps = savedCareerStepsRef.current;
    if (!Array.isArray(currentSavedSteps) || currentSavedSteps.length === 0) {
      setSavedCanonicalEscoIds(new Set());
      return undefined;
    }
    const buildSavedCanonicalSet = async () => {
      const next = new Set();
      for (const step of currentSavedSteps) {
        const direct = String(step?.escoId || '').trim().toLowerCase();
        if (direct) {
          next.add(direct);
          continue;
        }
        const inferred = await resolveCanonicalEscoId(step);
        if (inferred) next.add(inferred);
      }
      if (!cancelled) setSavedCanonicalEscoIds(next);
    };
    buildSavedCanonicalSet();
    return () => {
      cancelled = true;
    };
  }, [savedCareerSteps, resolveCanonicalEscoId]);

  useEffect(() => {
    const rolesToWarm = [];
    const flow = simulation?.results?.evaluationFlow;
    if (flow?.nextSteps?.length) rolesToWarm.push(...flow.nextSteps);
    if (flow?.outsideTheBox?.length) rolesToWarm.push(...flow.outsideTheBox);
    if (!rolesToWarm.length) return;
    rolesToWarm.forEach((role) => {
      void resolveCanonicalEscoId(role);
    });
  }, [simulation, resolveCanonicalEscoId]);

  const fetchSimulation = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/profile/simulation/saved/${simulationId}?lang=${encodeURIComponent(requestLang)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await res.json();
      
      if (data.success) {
        setSimulation(data.simulation);
        setOriginalSimulationData(JSON.parse(JSON.stringify(data.simulation)));
        setEditName(data.simulation.name);
      } else {
        setError(data.message || t('simulation.messages.loadFailed', { ns: 'dashboard' }));
      }
    } catch (err) {
      setError(t('simulation.messages.loadFailed', { ns: 'dashboard' }));
    } finally {
      setLoading(false);
    }
  };

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const findMatchingSavedStep = (role, currentSavedSteps) => {
    const matched = findMatchingSavedCareerStep(role, currentSavedSteps);
    if (matched) return matched;
    const roleCanonicalEsco = resolveCanonicalEscoIdFromCache(role);
    if (roleCanonicalEsco) {
      const byCanonicalEsco = currentSavedSteps.find((step) => {
        const stepCanonicalEsco = resolveCanonicalEscoIdFromCache(step);
        return !!stepCanonicalEsco && stepCanonicalEsco === roleCanonicalEsco;
      });
      if (byCanonicalEsco) return byCanonicalEsco;
    }

    return null;
  };

  const isStepSaved = (role) => {
    const currentSavedSteps = savedCareerStepsRef.current;
    if (!Array.isArray(currentSavedSteps) || currentSavedSteps.length === 0) return false;
    if (findMatchingSavedStep(role, currentSavedSteps)) return true;
    const roleCanonicalEsco = resolveCanonicalEscoIdFromCache(role);
    if (roleCanonicalEsco && savedCanonicalEscoIds.has(roleCanonicalEsco)) return true;
    return false;
  };

  const isStepSaving = (role) => {
    const key = role.stepId || role.id || role.instanceId || getRoleTitleEnglishForMatch(role.title);
    return savingSteps.has(key);
  };

  const handleToggleSaveStep = async (role, simulationResultId) => {
    const currentSavedSteps = Array.isArray(savedCareerStepsRef.current)
      ? savedCareerStepsRef.current
      : [];

    // Create a stepId for tracking loading state
    const stepId = role.stepId || role.id || role.instanceId || getRoleTitleEnglishForMatch(role.title);
    
    // Set loading state for this specific step
    setSavingSteps(prev => new Set(prev).add(stepId));

    try {
      if (isStepSaved(role)) {
        const savedStep = findMatchingSavedStep(role, currentSavedSteps);
        
        if (!savedStep) {
          console.error('❌ Could not find saved step to delete:', {
            role: {
              title: role.title,
              description: role.description,
              instanceId: role.instanceId,
              stepId: role.stepId
            },
            simulationId: simulationResultId,
            availableSteps: currentSavedSteps.map(step => ({
              stepId: step.stepId,
              title: step.title,
              simulationResultId: step.simulationResultId
            }))
          });
          showSnackbar(t('simulation.messages.careerStepNotFound', { ns: 'dashboard' }), 'error');
          return { success: false, action: 'error', error: t('simulation.messages.careerStepNotFound', { ns: 'dashboard' }) };
        }

        console.log('✅ Found saved step to delete:', {
          stepId: savedStep.stepId,
          title: savedStep.title,
          simulationResultId: savedStep.simulationResultId
        });

        const res = await fetch(`/api/profile/saved-career-steps/${encodeURIComponent(savedStep.stepId)}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const data = await res.json();
        if (data.success) {
          const newSavedSteps = data.savedCareerSteps || [];
          setSavedCareerStepsListQueryData(newSavedSteps);
          savedCareerStepsRef.current = newSavedSteps;
          showSnackbar(t('simulation.messages.careerStepRemoved', { ns: 'dashboard' }), 'info');
          return { success: true, action: 'unsaved' };
        } else {
          console.error('❌ Delete failed with data:', data);
          throw new Error(data.message || t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }));
        }
      } else {
        const titleForSave =
          role.title != null &&
          (typeof role.title === 'object' ||
            (typeof role.title === 'string' && role.title.trim() !== ''))
            ? role.title
            : getRoleTitleEnglishForMatch(role.title) ||
              String(role.escoId || '').trim() ||
              'Career step';
        const saveData = {
          title: titleForSave,
          description: role.description,
          stepId: resolveSimulationRoleStepIdForSave(role, simulation, simulationResultId),
          category: role.category || 'nextSteps',
          simulationResultId: simulationResultId,
          industry: role.industry || 'Career Development',
          savedAt: new Date().toISOString(),
          escoId: role.escoId || null,
          ...getMatchScoreFieldsForSave(role),
          ...pickUserEvaluationForSave(role),
        };

        console.log('💾 Saving career step with data:', saveData);

        const res = await fetch(`/api/profile/saved-career-steps?${getProfileApiLangQuery()}`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(saveData)
        });

        if (!res.ok) {
          const errorData = await res.text();
          console.error('❌ Save failed with response:', res.status, errorData);
          if (res.status === 409) {
            try {
              const duplicateData = JSON.parse(errorData);
              if (duplicateData.savedCareerSteps) {
                const newSavedSteps = duplicateData.savedCareerSteps || [];
                setSavedCareerStepsListQueryData(newSavedSteps);
                savedCareerStepsRef.current = newSavedSteps;
              }
              showSnackbar(duplicateData.message || t('simulation.messages.alreadySaved', { ns: 'dashboard' }), 'info');
              return { success: false, action: 'duplicate', message: duplicateData.message };
            } catch {
              showSnackbar(t('simulation.messages.alreadySaved', { ns: 'dashboard' }), 'info');
              return { success: false, action: 'duplicate' };
            }
          }
          throw new Error(t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }));
        }

        const data = await res.json();
        if (data.success) {
          // Update state with the response from API
          console.log('✅ Save successful, updating state with:', data.savedCareerSteps);
          const newSavedSteps = data.savedCareerSteps || [];
          setSavedCareerStepsListQueryData(newSavedSteps);
          savedCareerStepsRef.current = newSavedSteps;
          
          // Debug: Check if the step is now detected as saved
          setTimeout(() => {
            const isNowSaved = isStepSaved(role);
            console.log('🔍 After save, isStepSaved result:', isNowSaved, 'for role:', role.title);
            console.log('🔍 Current saved steps:', newSavedSteps.map(s => ({ stepId: s.stepId, title: s.title })));
          }, 100);
          
          showSnackbar(t('simulation.messages.careerStepSaved', { ns: 'dashboard' }), 'success');
          return { success: true, action: 'saved' };
        } else {
          console.error('❌ Save failed with data:', data);
          throw new Error(data.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }));
        }
      }
    } catch (err) {
      const errorMessage = err.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' });
      showSnackbar(errorMessage, 'error');
      console.error('Error toggling save:', err);
      return { success: false, action: 'error', error: errorMessage };
    } finally {
      // Remove loading state for this specific step
      setSavingSteps(prev => {
        const newSet = new Set(prev);
        newSet.delete(stepId);
        return newSet;
      });
    }
  };

  const handleBack = () => {
    navigate('/simulations');
  };

  const handleSaveChanges = () => {
    setSaveChangesDialogOpen(true);
  };

  const handleSaveChangesConfirm = async () => {
    if (!simulation || !hasChanges) return;
    
    setSavingChanges(true);
    try {
      console.log('🔄 Saving changes to simulation:', simulation.id);
      
      const result = await updateSimulation(simulation.id, simulation);
      
      if (result.success) {
        // Update the simulation with the returned data
        setSimulation(result.updatedSimulation);
        
        // Update the original data to reflect the saved state
        setOriginalSimulationData(result.updatedSimulation);
        
        // Reset change detection
        resetChanges();
        
        // Close dialog and show success message
        setSaveChangesDialogOpen(false);
        showSnackbar(t('simulation.messages.changesSavedSuccessfully', { ns: 'dashboard' }), 'success');
      }
    } catch (err) {
      console.error('Error saving changes:', err);
      showSnackbar(t('simulation.messages.saveChangesFailed', { ns: 'dashboard' }), 'error');
    } finally {
      setSavingChanges(false);
    }
  };

  const handleSaveChangesCancel = () => {
    setSaveChangesDialogOpen(false);
  };

  const handleEdit = () => {
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!simulation) return;

    try {
      const updatedSimulation = {
        ...simulation,
        name: editName
      };

      const result = await updateSimulation(simulation.id, updatedSimulation);
      
      if (result.success) {
        setSimulation(result.updatedSimulation);
        setOriginalSimulationData(result.updatedSimulation);
        setEditDialogOpen(false);
        invalidateSavedSimulationsListQuery();
        showSnackbar(t('details.messages.simulationUpdatedSuccessfully', { ns: 'dashboard' }), 'success');
      }
    } catch (err) {
      console.error('Error updating simulation:', err);
      showSnackbar(t('details.errors.updateSimulationFailed', { ns: 'dashboard' }), 'error');
    }
  };

  const handleDelete = () => {
    if (!simulation) return;
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!simulation) return;

    try {
      const res = await fetch(`/api/profile/simulation/saved/${simulation.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (res.ok) {
        invalidateSavedSimulationsListQuery();
        showSnackbar(t('simulation.messages.deletedSuccessfully', { ns: 'dashboard' }), 'success');
        navigate('/simulations');
      } else {
        showSnackbar(t('simulation.messages.deleteFailed', { ns: 'dashboard' }), 'error');
      }
    } catch (err) {
      showSnackbar(t('simulation.messages.deleteFailed', { ns: 'dashboard' }), 'error');
    } finally {
      setDeleteDialogOpen(false);
    }
  };

  const handleCancelDelete = () => {
    setDeleteDialogOpen(false);
  };

  const handleEvaluationCommit = useCallback((categoryKey, stepId, evaluation) => {
    setSimulation((prev) => {
      const flow = prev.results?.evaluationFlow;
      if (!flow || !Array.isArray(flow[categoryKey])) return prev;
      const roles = flow[categoryKey].map((r) =>
        r.id === stepId ? { ...r, userEvaluation: evaluation } : r
      );
      const hasStarted = { ...flow.hasStarted, [categoryKey]: true };
      const nextFlow = { ...flow, [categoryKey]: roles, hasStarted };
      return {
        ...prev,
        results: { ...prev.results, evaluationFlow: nextFlow },
      };
    });
  }, []);

  const handleSeeRoleRanking = useCallback((categoryKey) => {
    setSimulation((prev) => {
      const flow = prev.results?.evaluationFlow;
      if (!flow || !Array.isArray(flow[categoryKey])) return prev;
      const roles = flow[categoryKey];
      if (!isEvaluationComplete(roles)) return prev;
      const rankSlug = categoryKey === 'nextSteps' ? 'next' : 'out_of_the_box';
      const ranked = buildRankedRows(roles, rankSlug);
      const nextFlow = {
        ...flow,
        phases: { ...flow.phases, [categoryKey]: 'ranked' },
        ranked: { ...flow.ranked, [categoryKey]: ranked },
      };
      return {
        ...prev,
        results: { ...prev.results, evaluationFlow: nextFlow },
      };
    });
  }, []);

  const handleEditRoleRanking = useCallback((categoryKey) => {
    setSimulation((prev) => {
      const flow = prev.results?.evaluationFlow;
      if (!flow) return prev;
      const nextFlow = {
        ...flow,
        phases: { ...flow.phases, [categoryKey]: 'eval' },
      };
      return {
        ...prev,
        results: { ...prev.results, evaluationFlow: nextFlow },
      };
    });
  }, []);

  const handleReorderRankedRoles = useCallback((categoryKey, reorderedRows) => {
    setSimulation((prev) => {
      const flow = prev?.results?.evaluationFlow;
      if (!flow || !Array.isArray(reorderedRows) || !reorderedRows.length) return prev;
      const currentRoles = Array.isArray(flow[categoryKey]) ? flow[categoryKey] : [];
      const byId = new Map(currentRoles.map((role) => [role.id, role]));
      const nextRoles = reorderedRows
        .map((row) => {
          const existing = byId.get(row.id);
          if (!existing) return null;
          return { ...existing, userEvaluation: row.userEvaluation };
        })
        .filter(Boolean);
      if (!nextRoles.length) return prev;
      const rankSlug = categoryKey === 'nextSteps' ? 'next' : 'out_of_the_box';
      const nextFlow = {
        ...flow,
        [categoryKey]: nextRoles,
        ranked: {
          ...flow.ranked,
          [categoryKey]: buildRankedRowsFromOrderedRoles(nextRoles, rankSlug),
        },
      };
      return {
        ...prev,
        results: { ...prev.results, evaluationFlow: nextFlow },
      };
    });
  }, []);

  // Generate stable instance IDs for career steps
  const stableInstanceIds = useMemo(() => {
    if (!simulation?.results) return new Map();
    
    const mapping = new Map();
    
    // Map nextSteps
    if (Array.isArray(simulation.results.nextSteps)) {
      simulation.results.nextSteps.forEach((role, idx) => {
        const titleEn = getRoleTitleEnglishForMatch(role?.title);
        if (titleEn) {
          const stableId = `${titleEn.replace(/\s+/g, '-').toLowerCase()}-${idx}-${simulation.id}`;
          mapping.set(`${titleEn}-${idx}`, stableId);
        }
      });
    }
    
    // Map outsideTheBox
    if (Array.isArray(simulation.results.outsideTheBox)) {
      simulation.results.outsideTheBox.forEach((role, idx) => {
        const titleEn = getRoleTitleEnglishForMatch(role?.title);
        if (titleEn) {
          const stableId = `${titleEn.replace(/\s+/g, '-').toLowerCase()}-${idx}-${simulation.id}`;
          mapping.set(`${titleEn}-${idx}`, stableId);
        }
      });
    }
    
    return mapping;
  }, [simulation]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Tooltip title={t('details.actions.backToSimulations', { ns: 'dashboard' })}>
          <IconButton
            size="small"
            onClick={handleBack}
            aria-label={t('details.actions.backToSimulations', { ns: 'dashboard' })}
          >
            <ArrowBack />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  if (!simulation) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('details.simulationNotFound', { ns: 'dashboard' })}
        </Alert>
        <Tooltip title={t('details.actions.backToSimulations', { ns: 'dashboard' })}>
          <IconButton
            size="small"
            onClick={handleBack}
            aria-label={t('details.actions.backToSimulations', { ns: 'dashboard' })}
          >
            <ArrowBack />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  const results = simulation.results;
  const evaluationFlow = results?.evaluationFlow;
  const resultsSimKey = results?.simulationId ?? simulation.id;
  const evaluationFlowMatchesResults =
    evaluationFlow &&
    (evaluationFlow.simulationId ?? resultsSimKey) === resultsSimKey;

  const savedNextUsesEvaluationUi =
    evaluationFlowMatchesResults &&
    Array.isArray(evaluationFlow?.nextSteps) &&
    evaluationFlow.nextSteps.length > 0;

  const savedOutsideUsesEvaluationUi =
    evaluationFlowMatchesResults &&
    Array.isArray(evaluationFlow?.outsideTheBox) &&
    evaluationFlow.outsideTheBox.length > 0;

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      {/* Header — aligned with career step detail (primary header band) */}
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
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 2,
              mb: 3,
            }}
          >
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                minWidth: 0,
              }}
            >
              <Tooltip title={t('details.actions.backToSimulations', { ns: 'dashboard' })}>
                <IconButton
                  onClick={handleBack}
                  aria-label={t('details.actions.backToSimulations', { ns: 'dashboard' })}
                  sx={{
                    flexShrink: 0,
                    color: 'var(--color-detail-header-actions-fg)',
                    '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' },
                  }}
                >
                  <ArrowBack />
                </IconButton>
              </Tooltip>
              <Typography
                variant="h4"
                component="h1"
                sx={{ fontWeight: 'bold', color: 'var(--color-detail-header-fg)', flex: 1, minWidth: 0 }}
              >
                {simulation.name}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              <Tooltip title={t('details.tooltips.editSimulationDetails', { ns: 'dashboard' })}>
                <IconButton
                  onClick={handleEdit}
                  aria-label={t('details.tooltips.editSimulationDetails', { ns: 'dashboard' })}
                  sx={{
                    color: 'var(--color-detail-header-actions-fg)',
                    '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-hover)' },
                  }}
                >
                  <EditIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('details.tooltips.deleteSimulation', { ns: 'dashboard' })}>
                <IconButton
                  onClick={handleDelete}
                  aria-label={t('details.tooltips.deleteSimulation', { ns: 'dashboard' })}
                  sx={{
                    color: 'var(--color-detail-header-actions-fg)',
                    '&:hover': { backgroundColor: 'var(--color-on-detail-header-overlay-active)' },
                  }}
                >
                  <DeleteIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 1,
              mb: hasChanges || updateLoading || savingChanges ? 3 : 0,
            }}
          >
            <UnsavedChangesIndicator hasChanges={hasChanges} variant="chip" />
            <SaveChangesButton
              hasChanges={hasChanges}
              loading={updateLoading || savingChanges}
              onSave={handleSaveChanges}
            />
          </Box>

          {/* Same vertical slot as profile match LinearProgress on career step detail */}
          <Box sx={{ mb: 3 }}>
            <Box
              sx={{
                height: 8,
                borderRadius: 4,
                backgroundColor: 'var(--color-detail-header-progress-track)',
              }}
            />
          </Box>

          {/* Details grid — created date in same slot & style as match score on career step detail */}
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6} md={6}>
              <Box sx={{ textAlign: 'center', p: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'var(--color-detail-header-fg)', mb: 1 }}>
                  {formatSimulationDateShort(simulation.timestamp)}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {t('details.labels.created', { ns: 'dashboard' })}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Box>
      </Paper>

      {/* Career Goal */}
      {localizeAiText(simulation.careerGoal, '') && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4 }}>
          <Card sx={{ backgroundColor: 'var(--color-surface-info)', borderLeft: '6px solid var(--color-primary)', minWidth: 320 }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'primary.main' }}>
                {t('details.labels.selectedCareerGoal', { ns: 'dashboard' })}
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {localizeAiText(simulation.careerGoal, '')}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Phase 3: document enrichment summary */}
      {simulation.results?.profileEnrichment && (
        <Box sx={{ mb: 3 }}>
          <Alert
            severity={
              simulation.results.profileEnrichment.status === 'success' ? 'success' :
                simulation.results.profileEnrichment.status === 'partial' ? 'warning' :
                  simulation.results.profileEnrichment.status === 'failed' ? 'error' : 'info'
            }
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {t('details.labels.profileEnrichmentTitle', { ns: 'dashboard' })}
            </Typography>
            <Typography variant="body2">
              {simulation.results.profileEnrichment.message || t('details.labels.profileEnrichmentFallback', { ns: 'dashboard' })}
            </Typography>
          </Alert>
        </Box>
      )}

      {/* Next Career Roles — saved ranking (evaluationFlow) or legacy grid order */}
      {results?.nextSteps && results.nextSteps.length > 0 && (
        <Box sx={{ mb: 4 }}>
          {savedNextUsesEvaluationUi ? (
            <SimulationCategoryEvaluation
              title={t('simulation.categories.nextRoles', { ns: 'dashboard' })}
              categoryKey="nextSteps"
              roles={evaluationFlow.nextSteps}
              phase={evaluationFlow.phases?.nextSteps || 'eval'}
              rankedRows={evaluationFlow.ranked?.nextSteps}
              hasStarted={!!evaluationFlow.hasStarted?.nextSteps}
              onEvaluate={(stepId, evaluation) =>
                handleEvaluationCommit('nextSteps', stepId, evaluation)
              }
              onSeeRanking={() => handleSeeRoleRanking('nextSteps')}
              onEditRatings={() => handleEditRoleRanking('nextSteps')}
              onReorderRankedRoles={(rows) => handleReorderRankedRoles('nextSteps', rows)}
              isStepSaved={isStepSaved}
              isStepSaving={isStepSaving}
              onToggleSave={(role) => handleToggleSaveStep(role, simulation.id)}
              guardedNavigate={guardedNavigate}
              isViewingSavedSimulation
              savedSimulationId={simulation.id}
              simulationIdForCards={simulation.id}
            />
          ) : (
            <>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                {t('details.labels.nextCareerSteps', { ns: 'dashboard' })}
              </Typography>
              <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} sx={{ alignItems: 'stretch', mb: 2 }}>
                {results.nextSteps.map((role, idx) => {
                  const titleEn = getRoleTitleEnglishForMatch(role.title);
                  const stepId = role.stepId || role.id || stableInstanceIds.get(`${titleEn}-${idx}`) ||
                                `${titleEn.replace(/\s+/g, '-').toLowerCase()}-${idx}-${simulation.id}`;

                  const stepWithInstanceId = {
                    ...role,
                    instanceId: stepId,
                    stepId: role.stepId || role.id || stepId,
                    id: role.id || role.stepId || stepId,
                    isReplacement: false
                  };

                  return (
                    <Grid item xs={12} sm={6} md={6} lg={4} key={stepId} sx={{
                      mb: { xs: 1, sm: 2, md: 2 },
                      px: { xs: 1, sm: 1.5, md: 2 }
                    }}>
                      <CareerStepCardWithReplacement
                        step={stepWithInstanceId}
                        simulationId={simulation.id}
                        category="nextSteps"
                        onSave={() => handleToggleSaveStep(stepWithInstanceId, simulation.id)}
                        isStepSaved={isStepSaved(stepWithInstanceId)}
                        savingStep={isStepSaving(stepWithInstanceId)}
                      />
                    </Grid>
                  );
                })}
              </Grid>
            </>
          )}
        </Box>
      )}

      {/* Outside-the-Box — saved ranking or legacy grid */}
      {results?.outsideTheBox && results.outsideTheBox.length > 0 && (
        <Box sx={{ mb: 4 }}>
          {savedOutsideUsesEvaluationUi ? (
            <SimulationCategoryEvaluation
              title={t('simulation.categories.outsideRoles', { ns: 'dashboard' })}
              categoryKey="outsideTheBox"
              roles={evaluationFlow.outsideTheBox}
              phase={evaluationFlow.phases?.outsideTheBox || 'eval'}
              rankedRows={evaluationFlow.ranked?.outsideTheBox}
              hasStarted={!!evaluationFlow.hasStarted?.outsideTheBox}
              onEvaluate={(stepId, evaluation) =>
                handleEvaluationCommit('outsideTheBox', stepId, evaluation)
              }
              onSeeRanking={() => handleSeeRoleRanking('outsideTheBox')}
              onEditRatings={() => handleEditRoleRanking('outsideTheBox')}
              onReorderRankedRoles={(rows) => handleReorderRankedRoles('outsideTheBox', rows)}
              isStepSaved={isStepSaved}
              isStepSaving={isStepSaving}
              onToggleSave={(role) => handleToggleSaveStep(role, simulation.id)}
              guardedNavigate={guardedNavigate}
              isViewingSavedSimulation
              savedSimulationId={simulation.id}
              simulationIdForCards={simulation.id}
            />
          ) : (
            <>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                {t('details.labels.outsideTheBoxRoles', { ns: 'dashboard' })}
              </Typography>
              <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} sx={{ alignItems: 'stretch', mb: 2 }}>
                {results.outsideTheBox.map((role, idx) => {
                  const titleEn = getRoleTitleEnglishForMatch(role.title);
                  const stepId = role.stepId || role.id || stableInstanceIds.get(`${titleEn}-${idx}`) ||
                                `${titleEn.replace(/\s+/g, '-').toLowerCase()}-${idx}-${simulation.id}`;

                  const stepWithInstanceId = {
                    ...role,
                    instanceId: stepId,
                    stepId: role.stepId || role.id || stepId,
                    id: role.id || role.stepId || stepId,
                    isReplacement: false
                  };

                  return (
                    <Grid item xs={12} sm={6} md={6} lg={4} key={stepId} sx={{
                      mb: { xs: 1, sm: 2, md: 2 },
                      px: { xs: 1, sm: 1.5, md: 2 }
                    }}>
                      <CareerStepCardWithReplacement
                        step={stepWithInstanceId}
                        simulationId={simulation.id}
                        category="outsideTheBox"
                        onSave={() => handleToggleSaveStep(stepWithInstanceId, simulation.id)}
                        isStepSaved={isStepSaved(stepWithInstanceId)}
                        savingStep={isStepSaving(stepWithInstanceId)}
                      />
                    </Grid>
                  );
                })}
              </Grid>
            </>
          )}
        </Box>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('details.dialogs.editSimulationTitle', { ns: 'dashboard' })}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label={t('details.labels.name', { ns: 'dashboard' })}
            fullWidth
            variant="outlined"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            sx={{ mb: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>{t('profilePage.actions.cancel', { ns: 'onboarding' })}</Button>
          <Button onClick={handleEditSave} variant="contained">{t('profilePage.actions.save', { ns: 'onboarding' })}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleCancelDelete}
        aria-labelledby="delete-simulation-dialog-title"
        aria-describedby="delete-simulation-dialog-description"
      >
        <DialogTitle id="delete-simulation-dialog-title">
          {t('simulation.deleteDialog.title', { ns: 'dashboard' })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-simulation-dialog-description">
            {t('simulation.deleteDialog.confirmation', { ns: 'dashboard' })}
          </DialogContentText>
          {simulation && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('simulation.deleteDialog.detailsTitle', { ns: 'dashboard' })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>{t('simulation.deleteDialog.nameLabel', { ns: 'dashboard' })}</strong> {simulation.name || t('simulation.deleteDialog.notSpecified', { ns: 'dashboard' })}
              </Typography>
            </Box>
          )}
          <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 'bold' }}>
            {t('simulation.deleteDialog.warning', { ns: 'dashboard' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={handleCancelDelete}
            variant="outlined"
            color="primary"
            autoFocus
          >
            {t('profilePage.actions.cancel', { ns: 'onboarding' })}
          </Button>
          <Button 
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
          >
            {t('profilePage.photo.editor.delete', { ns: 'onboarding' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Save Changes Dialog */}
      <SaveChangesDialog
        open={saveChangesDialogOpen}
        onClose={handleSaveChangesCancel}
        onConfirm={handleSaveChangesConfirm}
        loading={savingChanges}
        changeSummary={getChangeSummary()}
        simulationName={simulation.name}
      />

      {/* Share Dialog - TODO: Implement simulation sharing */}
      {/* <ShareDialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        simulation={simulation}
      /> */}

      {/* Snackbar */}
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

      <SimulationRankingsCompleteCelebration
        open={rankingsCelebration.open}
        onClose={rankingsCelebration.close}
      />
    </Box>
  );
};

export default SavedSimulationDetails;
