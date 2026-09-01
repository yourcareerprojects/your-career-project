import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  CircularProgress,
  Grid,
  Card,
  CardContent,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  LinearProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  Divider,
  Alert,
  Snackbar,
  Drawer,
  Fab,
  Tooltip,
  DialogContentText
} from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';
import HistoryIcon from '@mui/icons-material/History';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import Autocomplete from '@mui/material/Autocomplete';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SimulationEvaluationFlow from '../common/SimulationEvaluationFlow';
import SimulationStartWizard from '../common/SimulationStartWizard';
import SimulationWizardPausedPrompt from '../common/SimulationWizardPausedPrompt';
import {
  deriveSimulationWizardStep,
  isSimulationWizardActive,
  canResumeSimulationWizard,
} from '../../utils/simulationWizardSteps';
import { navigateToCareerPathPlanning } from '../../utils/careerPathPlanningSession';
import {
  ensureEvaluationFlow,
  areBothSimulationRankingsComplete,
  mergeEvaluationFlowFromResults,
  applyAutoRankingRevealWhenBothComplete,
  pauseSimulationWizard,
  hasSimulationEvaluationProgress,
  withMaterializedEvaluationFlow,
  toPersistedSimulationResults,
} from '../../utils/simulationRoleRanking';
import { useEvaluationFlowWrites } from '../../hooks/useEvaluationFlowWrites';
import { useSimulationRankingsCompleteCelebration } from '../../hooks/useSimulationRankingsCompleteCelebration';
import SaveChangesButton from '../common/SaveChangesButton';
import SaveChangesDialog from '../common/SaveChangesDialog';
import UnsavedChangesIndicator from '../common/UnsavedChangesIndicator';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../../constants/profileCompletion';
import { queryClient } from '../../queryClient';
import {
  fetchProfileCompletion,
  profileCompletionQueryKey,
  invalidateLastSimulationQuery,
  useSavedSimulationsListQuery,
  fetchSavedSimulationsList,
  savedSimulationsListQueryKey,
  invalidateSavedSimulationsListQuery,
  baseUILanguage,
} from '../../hooks/useProfileQueries';
import { invalidateCareerIdentityQueries } from '../../hooks/useCareerIdentityQueries';
import { normalizeTextForI18nMatch } from '../../utils/roleTitleDisplay';
import { storeSimulationResultDetails } from '../../utils/simulationResultSessionStore';
import localizedContentService from '../../utils/localizedContentService';
import { 
  saveSimulationToStorage, 
  loadSimulationFromStorage, 
  clearSimulationFromStorage,
  hasSimulationInStorage,
  getSimulationStateFromStorage,
  updateSimulationStateInStorage,
  loadPreferredSimulationSnapshot,
  saveSimulationDetailContext,
  clearSimulationDetailContext,
} from '../../utils/simulationPersistence';
import {
  schedulePersistLastSimulationProgress,
} from '../../utils/persistLastSimulationProgress';
import useUpdateSimulation from '../../hooks/useUpdateSimulation';
import useChangeDetection from '../../hooks/useChangeDetection';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import { useAuth } from '../../contexts/AuthContext';
import ProfileUpdateRecommendation from '../common/ProfileUpdateRecommendation';
import { waitForSimulationJobCompletion } from '../../utils/simulationJobProgress';
import ProfilePageActionBar from '../profile/ProfilePageActionBar';
import PageHeader from '../common/PageHeader';
import IdentityExplorationDiscoverCta from '../careerIdentity/IdentityExplorationDiscoverCta';
import { applyExplorationRankingToLastSimulation } from '../../utils/applyExplorationRankingToLastSimulation';

/** Simulation UX: `/simulation` is the entry hub; `/puzzle-job` loads the latest run when needed. */
const Simulation = () => {
  const { t } = useTranslation(['dashboard', 'common', 'onboarding']);
  const { user } = useAuth();
  const requestLang = baseUILanguage();
  const localizeAiText = useCallback(
    (field) => localizedContentService.getLocalizedWithFallback(field, requestLang, ''),
    [requestLang]
  );
  
  // State for simulation
  const [simLoading, setSimLoading] = useState(false);
  const [simulationJobState, setSimulationJobState] = useState('idle'); // idle | queued | running
  const [simulationProgress, setSimulationProgress] = useState(0);
  const [simResults, setSimResults] = useState(null);
  const [loadingLast, setLoadingLast] = useState(true);
  const [simError, setSimError] = useState('');
  // Career goal autocomplete (server-side search, supports ESCO altLabels)
  const [simulationDate, setSimulationDate] = useState(null);

  const simulationRunAbortRef = useRef(null);
  /** Latest results for merge/persist races (also updated eagerly inside state updaters). */
  const simResultsRef = useRef(null);
  /** Bumped to cancel stale deferred session persists after exploration merges. */
  const simulationPersistEpochRef = useRef(0);
  const [simulationWizardIntent, setSimulationWizardIntent] = useState(false);

  useEffect(() => {
    return () => {
      simulationRunAbortRef.current?.abort();
    };
  }, []);

  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [selectedSimulation, setSelectedSimulation] = useState(null);

  // State for notifications
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success',
    linkTo: null,
    linkLabel: null
  });

  // State for unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // State to track if current results are from a saved simulation
  const [isViewingSavedSimulation, setIsViewingSavedSimulation] = useState(false);
  const isViewingSavedSimulationRef = useRef(false);
  useEffect(() => {
    isViewingSavedSimulationRef.current = isViewingSavedSimulation;
  }, [isViewingSavedSimulation]);

  /** Card/grid edits on a saved simulation still need the navigation guard; ranking on the latest run auto-persists. */
  const markSavedSimulationDraftDirty = useCallback(() => {
    if (!isViewingSavedSimulationRef.current) return;
    setHasUnsavedChanges(true);
    setSimulationState('modified');
  }, []);
  
  // State for simulation persistence
  const [simulationState, setSimulationState] = useState('clean'); // 'clean' | 'modified' | 'saved'

  // State for save changes functionality
  const [originalSimulationData, setOriginalSimulationData] = useState(null);
  const [saveChangesDialogOpen, setSaveChangesDialogOpen] = useState(false);
  const [savingChanges, setSavingChanges] = useState(false);

  // State for confirmation dialogs
  const [deleteSimulationDialogOpen, setDeleteSimulationDialogOpen] = useState(false);
  const [simulationToDelete, setSimulationToDelete] = useState(null);

  // Hooks for save changes functionality
  const { updateSimulation, loading: updateLoading, error: updateError } = useUpdateSimulation();
  const { hasChanges, resetChanges, getChangeSummary } = useChangeDetection(
    originalSimulationData,
    selectedSimulation
  );

  const persistSimResultsToSession = useCallback(
    (nextResults) => {
      if (!nextResults) return;
      try {
        saveSimulationToStorage(
          {
            results: nextResults,
            simulationDate: simulationDate || new Date(),
            profileCompletion,
          },
          'modified'
        );
      } catch (e) {
        console.warn('Session persistence failed:', e);
      }
      if (!isViewingSavedSimulationRef.current) {
        schedulePersistLastSimulationProgress(nextResults);
      }
    },
    [simulationDate, profileCompletion]
  );

  const getSimResultsFlow = useCallback((prev) => prev?.evaluationFlow, []);
  const putSimResultsFlow = useCallback(
    (prev, nextFlow) => ({ ...prev, evaluationFlow: nextFlow }),
    []
  );
  const persistCommittedSimResults = useCallback(
    (next) => {
      // Persist latest ref at macrotask time so a later exploration merge cannot be
      // overwritten by a stale closed-over snapshot from this commit.
      if (next?.evaluationFlow) {
        simResultsRef.current = next;
      }
      const epochAtSchedule = ++simulationPersistEpochRef.current;
      setTimeout(() => {
        if (epochAtSchedule !== simulationPersistEpochRef.current) return;
        const latest = simResultsRef.current;
        if (!latest?.evaluationFlow) return;
        persistSimResultsToSession(latest);
      }, 0);
    },
    [persistSimResultsToSession]
  );

  const {
    handleEvaluationCommit,
    handleSeeRoleRanking,
    handleUnlockMobileOutsideTheBox,
    handleSkipOutsideTheBox,
    handleResumeOutsideTheBox: resumeOutsideTheBoxFlow,
    handleResumeWizard,
    handleReorderCombinedRankedRoles,
    handleReorderRankedRoles,
  } = useEvaluationFlowWrites({
    setState: setSimResults,
    getFlow: getSimResultsFlow,
    putFlow: putSimResultsFlow,
    onCommitted: persistCommittedSimResults,
    onWrite: markSavedSimulationDraftDirty,
  });

  const handleResumeOutsideTheBox = useCallback(() => {
    resumeOutsideTheBoxFlow();
    setSimulationWizardIntent(true);
  }, [resumeOutsideTheBoxFlow]);

  const simulationWizardStep = useMemo(
    () =>
      deriveSimulationWizardStep({
        simLoading,
        evaluationFlow: simResults?.evaluationFlow,
      }),
    [simLoading, simResults?.evaluationFlow]
  );

  const simulationWizardActive = useMemo(
    () =>
      isSimulationWizardActive({
        simLoading,
        evaluationFlow: simResults?.evaluationFlow,
        simulationWizardIntent,
        hasSimulationResults: Boolean(simResults),
      }),
    [simLoading, simResults, simulationWizardIntent]
  );

  useEffect(() => {
    if (!simulationWizardIntent) return;
    if (
      !isSimulationWizardActive({
        simLoading,
        evaluationFlow: simResults?.evaluationFlow,
        simulationWizardIntent: true,
        hasSimulationResults: Boolean(simResults),
      })
    ) {
      setSimulationWizardIntent(false);
    }
  }, [simLoading, simResults, simulationWizardIntent]);

  const handleWizardSkipOotb = useCallback(() => {
    handleSkipOutsideTheBox();
    setSimulationWizardIntent(false);
  }, [handleSkipOutsideTheBox]);

  const handleWizardContinueOotb = useCallback(() => {
    handleUnlockMobileOutsideTheBox();
  }, [handleUnlockMobileOutsideTheBox]);

  const handleWizardEvaluateNext = useCallback(
    (stepId, evaluation) => {
      handleEvaluationCommit('nextSteps', stepId, evaluation);
    },
    [handleEvaluationCommit]
  );

  const handleWizardEvaluateOotb = useCallback(
    (stepId, evaluation) => {
      handleEvaluationCommit('outsideTheBox', stepId, evaluation);
    },
    [handleEvaluationCommit]
  );

  const handleWizardResume = useCallback(() => {
    handleResumeWizard();
    setSimulationWizardIntent(true);
  }, [handleResumeWizard]);

  // State for per-category display tracking
  const [categoryDisplayCounts, setCategoryDisplayCounts] = useState({
    nextSteps: 3,
    outsideTheBox: 3
  });
  
  // State for per-category display limits
  const [categoryLimits] = useState({
    nextSteps: 10,
    outsideTheBox: 10
  });
  
  // State for profile update recommendation
  const [showProfileRecommendation, setShowProfileRecommendation] = useState(false);
  const [recommendationCategory, setRecommendationCategory] = useState(null);
  const [profileCompletion, setProfileCompletion] = useState(0);

  /** Avoid redundant GET /simulation/last when `{simulationId, lang}` already synced */
  const localizationSyncedRef = useRef({ bundleKey: '' });
  /** Prevent duplicate in-flight GET /simulation/last (e.g. StrictMode double-mount) */
  const fetchLastInFlightRef = useRef(null);

  const markLocalizationSyncedFromResults = useCallback(
    (results, savedId = null) => {
      if (savedId) {
        localizationSyncedRef.current.bundleKey = `saved:${savedId}:${requestLang}`;
      } else if (results?.simulationId) {
        localizationSyncedRef.current.bundleKey = `${results.simulationId}:${requestLang}`;
      }
    },
    [requestLang]
  );

  const applySessionSimulation = useCallback(
    (storedData) => {
      if (!storedData?.results) return false;
      const results = withMaterializedEvaluationFlow(storedData.results);
      setSimResults(results);
      simResultsRef.current = results;
      // Preserve session dirty state so a later localize refresh cannot overwrite
      // exploration merges that are still flushing to the server.
      setSimulationState(storedData.state || 'clean');
      if (storedData.metadata) {
        setSimulationDate(storedData.metadata.simulationDate || new Date());
        setProfileCompletion(storedData.metadata.profileCompletion || 0);
      }
      if (results.categoryDisplayCounts) {
        setCategoryDisplayCounts(results.categoryDisplayCounts);
      }
      markLocalizationSyncedFromResults(results);
      setLoadingLast(false);
      return true;
    },
    [markLocalizationSyncedFromResults]
  );

  useEffect(() => {
    simResultsRef.current = simResults;
  }, [simResults]);

  const handleExplorationRanked = useCallback(
    async ({ sessionId, roles, rankedRows }) => {
      const prev = withMaterializedEvaluationFlow(simResultsRef.current || simResults);
      if (!prev) {
        console.warn('Exploration ranking finished, but no simulation results were loaded to merge into.');
        return { ok: false, reason: 'no-results' };
      }

      const wasWizardPaused = Boolean(prev.evaluationFlow?.wizardPaused);
      const outcome = await applyExplorationRankingToLastSimulation({
        sessionId,
        roles,
        rankedRows,
        results: prev,
        storageMetadata: {
          simulationDate: simulationDate || new Date(),
          profileCompletion,
        },
        persistToServer: !isViewingSavedSimulationRef.current,
      });

      if (!outcome.ok) {
        if (outcome.reason === 'no-roles') {
          console.warn(
            'Exploration ranking finished, but no evaluated roles were available to merge into simulation results.'
          );
        } else if (outcome.reason === 'no-evaluation-flow') {
          console.warn(
            'Exploration ranking finished, but no simulation evaluationFlow was available to merge into.'
          );
        }
        return outcome;
      }

      if (outcome.unchanged) {
        console.warn(
          'Exploration ranking finished, but merge did not change simulation evaluationFlow.',
          {
            sessionId,
            nextRanked: prev.evaluationFlow?.phases?.nextSteps,
            ootbRanked: prev.evaluationFlow?.phases?.outsideTheBox,
          }
        );
        return outcome;
      }

      const resultsToApply = withMaterializedEvaluationFlow(outcome.results);
      // Invalidate any deferred persist scheduled before this merge landed.
      simulationPersistEpochRef.current += 1;
      const next = {
        ...(simResultsRef.current || prev || resultsToApply),
        ...resultsToApply,
        evaluationFlow: resultsToApply.evaluationFlow,
      };
      simResultsRef.current = next;
      setSimResults(next);
      setSimulationState('modified');
      markLocalizationSyncedFromResults(next);
      markSavedSimulationDraftDirty();

      // Mid-eval: reopen the ranking wizard so exploration ratings count toward progress.
      if (
        wasWizardPaused
        && next?.evaluationFlow
        && !areBothSimulationRankingsComplete(next.evaluationFlow)
      ) {
        setSimulationWizardIntent(true);
      }

      return { ...outcome, results: next };
    },
    [
      simResults,
      simulationDate,
      profileCompletion,
      markSavedSimulationDraftDirty,
      markLocalizationSyncedFromResults,
      selectedSimulation?.id,
    ]
  );

  const [profileSimulationGate, setProfileSimulationGate] = useState({
    ready: false,
    belowMin: false,
  });
  const canRunSimulation = profileSimulationGate.ready && !profileSimulationGate.belowMin;

  const { data: savedSimulations = [] } = useSavedSimulationsListQuery({ enabled: canRunSimulation });

  // Global navigation guard context
  const { registerGuard, unregisterGuard, guardedNavigate } = useNavigationGuardContext();
  
  // Navigation guard: block while a run is in flight, or when a saved simulation has unsaved card edits.
  const isSimulationLoadingGuardActive = simLoading;
  const shouldGuardNavigation =
    isSimulationLoadingGuardActive
    || (isViewingSavedSimulation && (hasChanges || simulationState === 'modified'));
  const changeSummary = useMemo(
    () => getChangeSummary(),
    [getChangeSummary, hasChanges, originalSimulationData, selectedSimulation]
  );
  
  useEffect(() => {
    if (shouldGuardNavigation) {
      registerGuard('simulation', {
        enabled: true,
        hasUnsavedChanges: shouldGuardNavigation,
        changeSummary,
        title: isSimulationLoadingGuardActive
          ? t('simulation.navigationGuard.loadingTitle', { ns: 'dashboard' })
          : t('simulation.navigationGuard.unsavedTitle', { ns: 'dashboard' }),
        message: isSimulationLoadingGuardActive
          ? t('simulation.navigationGuard.loadingMessage', { ns: 'dashboard' })
          : t('simulation.navigationGuard.unsavedMessage', { ns: 'dashboard' }),
        confirmText: t('simulation.navigationGuard.leaveAnyway', { ns: 'dashboard' }),
        cancelText: t('simulation.navigationGuard.stayOnPage', { ns: 'dashboard' }),
        saveText: t('simulation.navigationGuard.saveChanges', { ns: 'dashboard' }),
        showSaveOption: false,
        loading: savingChanges,
        onSave: async () => {},
        onConfirmLeave: () => {
          if (isSimulationLoadingGuardActive) return;
          // Clear simulation results when user chooses "Leave Anyway"
          console.log('🚫 User chose to leave anyway - clearing simulation results');
          setSimResults(null);
          setSimulationState('clean');
          setHasUnsavedChanges(false);
          
          // Mark session storage as 'saved' to prevent server fetch on return
          const simulationData = {
            results: null,
            simulationDate: null,
            profileCompletion: 0
          };
          saveSimulationToStorage(simulationData, 'saved');
          
          // Clear any unsaved results from session storage
          try {
            clearSimulationDetailContext();
          } catch (error) {
            console.warn('Failed to clear simulation detail context:', error);
          }
        }
      });
    } else {
      unregisterGuard('simulation');
    }
    
    // Cleanup on unmount
    return () => {
      unregisterGuard('simulation');
    };
  }, [
    shouldGuardNavigation,
    isSimulationLoadingGuardActive,
    isViewingSavedSimulation,
    hasChanges,
    simulationState,
    changeSummary,
    savingChanges,
    registerGuard,
    unregisterGuard,
  ]);

  // Browser-level guard for refresh/tab-close while simulation is loading.
  useEffect(() => {
    if (!simLoading) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = t('simulation.navigationGuard.beforeUnload', { ns: 'dashboard' });
      return event.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [simLoading]);

  const [canonicalEscoByKey, setCanonicalEscoByKey] = useState({});

  const navigate = useNavigate();
  // Note: navigate will be replaced by navigationGuard.navigate below
  const location = useLocation();

  const handlePlanPath = useCallback(
    (role) => {
      navigateToCareerPathPlanning({
        role,
        savedSimulationId: isViewingSavedSimulation ? selectedSimulation?.id : null,
        navigate,
        guardedNavigate,
      });
    },
    [isViewingSavedSimulation, selectedSimulation?.id, navigate, guardedNavigate]
  );

  useEffect(() => {
    if (location.pathname !== '/simulation' || loadingLast || simLoading) return;
    const hasResults =
      (Array.isArray(simResults?.nextSteps) && simResults.nextSteps.length > 0)
      || (Array.isArray(simResults?.outsideTheBox) && simResults.outsideTheBox.length > 0);
    if (hasResults) {
      navigate('/puzzle-job', { replace: true });
    }
  }, [location.pathname, loadingLast, simLoading, simResults, navigate]);

  useSimulationRankingsCompleteCelebration(simResults?.evaluationFlow);

  // Comprehensive state validation function
  const validateAndSanitizeState = () => {
    try {
      // Validate simResults
      if (simResults && typeof simResults === 'object') {
        if (!Array.isArray(simResults.nextSteps)) simResults.nextSteps = [];
        if (!Array.isArray(simResults.outsideTheBox)) simResults.outsideTheBox = [];
        if (!Array.isArray(simResults.outsideComfortZone)) simResults.outsideComfortZone = [];
        if (!Array.isArray(simResults.furtherAdvice)) simResults.furtherAdvice = [];
        if (!Array.isArray(simResults.resources)) simResults.resources = [];
      }
      
      // Validate selectedSimulation
      if (selectedSimulation && typeof selectedSimulation === 'object') {
        if (selectedSimulation.results && typeof selectedSimulation.results === 'object') {
          if (!Array.isArray(selectedSimulation.results.nextSteps)) selectedSimulation.results.nextSteps = [];
          if (!Array.isArray(selectedSimulation.results.outsideTheBox)) selectedSimulation.results.outsideTheBox = [];
          if (!Array.isArray(selectedSimulation.results.outsideComfortZone)) selectedSimulation.results.outsideComfortZone = [];
          if (!Array.isArray(selectedSimulation.results.furtherAdvice)) selectedSimulation.results.furtherAdvice = [];
          if (!Array.isArray(selectedSimulation.results.resources)) selectedSimulation.results.resources = [];
        }
      }
      
      // Validate savedSimulations
      if (Array.isArray(savedSimulations)) {
        savedSimulations.forEach((sim, index) => {
          if (sim && typeof sim === 'object' && sim.results && typeof sim.results === 'object') {
            if (!Array.isArray(sim.results.nextSteps)) sim.results.nextSteps = [];
            if (!Array.isArray(sim.results.outsideTheBox)) sim.results.outsideTheBox = [];
            if (!Array.isArray(sim.results.outsideComfortZone)) sim.results.outsideComfortZone = [];
            if (!Array.isArray(sim.results.furtherAdvice)) sim.results.furtherAdvice = [];
            if (!Array.isArray(sim.results.resources)) sim.results.resources = [];
          }
        });
      }
      
      return true;
    } catch (error) {
      console.error('Error in validateAndSanitizeState:', error);
      return false;
    }
  };

  // Calculate profile completion percentage
  const calculateProfileCompletion = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return 0;

      const data = await queryClient.fetchQuery(profileCompletionQueryKey, fetchProfileCompletion);
      return data.completion?.overall || 0;
    } catch (error) {
      console.error('Error calculating profile completion:', error);
    }
    return 0;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          if (!cancelled) {
            setProfileSimulationGate({ ready: true, belowMin: false });
          }
          return;
        }
        const data = await queryClient.fetchQuery(profileCompletionQueryKey, fetchProfileCompletion);
        const overall = data.completion?.overall ?? 0;
        if (!cancelled) {
          setProfileCompletion(overall);
          setProfileSimulationGate({
            ready: true,
            belowMin: overall < MIN_PROFILE_COMPLETION_REQUIRED,
          });
        }
      } catch (err) {
        console.error('Profile completion gate fetch failed:', err);
        if (!cancelled) {
          setProfileSimulationGate({ ready: true, belowMin: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.isVerified, user?.emailVerified]);

  const sanitizeSimulationResultsPayload = (newResults) => {
    if (!newResults || typeof newResults !== 'object') return null;
    const sanitizedResults = {
      ...newResults,
      nextSteps: Array.isArray(newResults?.nextSteps) ? [...newResults.nextSteps] : [],
      outsideTheBox: Array.isArray(newResults?.outsideTheBox) ? [...newResults.outsideTheBox] : [],
      outsideComfortZone: Array.isArray(newResults?.outsideComfortZone) ? [...newResults.outsideComfortZone] : [],
      furtherAdvice: Array.isArray(newResults?.furtherAdvice) ? [...newResults.furtherAdvice] : [],
      resources: Array.isArray(newResults?.resources) ? [...newResults.resources] : [],
    };
    sanitizedResults.nextSteps = sanitizedResults.nextSteps.filter((item) => item && typeof item === 'object');
    sanitizedResults.outsideTheBox = sanitizedResults.outsideTheBox.filter((item) => item && typeof item === 'object');
    sanitizedResults.outsideComfortZone = sanitizedResults.outsideComfortZone.filter((item) => item && typeof item === 'object');
    sanitizedResults.furtherAdvice = sanitizedResults.furtherAdvice.filter((item) => item && typeof item === 'object');
    sanitizedResults.resources = sanitizedResults.resources.filter((item) => item && typeof item === 'object');
    return sanitizedResults;
  };

  // Safe setter that normalizes result arrays before updating React state.
  const safeSetSimResults = (newResults) => {
    if (!newResults) {
      setSimResults(null);
      return;
    }

    const sanitizedResults = withMaterializedEvaluationFlow(
      sanitizeSimulationResultsPayload(newResults)
    );
    if (!sanitizedResults) return;

    try {
      sessionStorage.setItem(
        'currentSimResults',
        JSON.stringify(toPersistedSimulationResults(sanitizedResults))
      );
    } catch (error) {
      console.warn('Failed to store current results in sessionStorage:', error);
    }

    setSimResults(sanitizedResults);
    simResultsRef.current = sanitizedResults;
  };

  // Ensure simResults arrays are always properly initialized
  useEffect(() => {
    if (!simResults) return;

    const needsSanitize =
      !Array.isArray(simResults.nextSteps)
      || !Array.isArray(simResults.outsideTheBox)
      || !Array.isArray(simResults.outsideComfortZone)
      || !Array.isArray(simResults.furtherAdvice)
      || !Array.isArray(simResults.resources)
      || simResults.nextSteps.some((item) => !item || typeof item !== 'object')
      || simResults.outsideTheBox.some((item) => !item || typeof item !== 'object')
      || simResults.outsideComfortZone.some((item) => !item || typeof item !== 'object')
      || simResults.furtherAdvice.some((item) => !item || typeof item !== 'object')
      || simResults.resources.some((item) => !item || typeof item !== 'object');

    if (!needsSanitize) return;

    setSimResults((prev) => {
      if (!prev) return prev;
      const sanitizedResults = {
        ...prev,
        nextSteps: Array.isArray(prev.nextSteps) ? [...prev.nextSteps] : [],
        outsideTheBox: Array.isArray(prev.outsideTheBox) ? [...prev.outsideTheBox] : [],
        outsideComfortZone: Array.isArray(prev.outsideComfortZone) ? [...prev.outsideComfortZone] : [],
        furtherAdvice: Array.isArray(prev.furtherAdvice) ? [...prev.furtherAdvice] : [],
        resources: Array.isArray(prev.resources) ? [...prev.resources] : [],
      };
      sanitizedResults.nextSteps = sanitizedResults.nextSteps.filter((item) => item && typeof item === 'object');
      sanitizedResults.outsideTheBox = sanitizedResults.outsideTheBox.filter((item) => item && typeof item === 'object');
      sanitizedResults.outsideComfortZone = sanitizedResults.outsideComfortZone.filter((item) => item && typeof item === 'object');
      sanitizedResults.furtherAdvice = sanitizedResults.furtherAdvice.filter((item) => item && typeof item === 'object');
      sanitizedResults.resources = sanitizedResults.resources.filter((item) => item && typeof item === 'object');
      return sanitizedResults;
    });
  }, [simResults]);

  useEffect(() => {
    if (!simResults) return;
    const resultsKey = simResults.simulationId ?? 'local';
    const flowSimId = simResults.evaluationFlow?.simulationId ?? 'local';
    if (simResults.evaluationFlow && flowSimId === resultsKey) {
      const maybeReveal = applyAutoRankingRevealWhenBothComplete(simResults.evaluationFlow);
      if (maybeReveal === simResults.evaluationFlow) return;
      setSimResults((prev) => {
        if (!prev?.evaluationFlow) return prev;
        const revealed = applyAutoRankingRevealWhenBothComplete(prev.evaluationFlow);
        if (revealed === prev.evaluationFlow) return prev;
        const next = { ...prev, evaluationFlow: revealed };
        const epochAtSchedule = ++simulationPersistEpochRef.current;
        setTimeout(() => {
          if (epochAtSchedule !== simulationPersistEpochRef.current) return;
          const latest = simResultsRef.current || next;
          if (!latest?.evaluationFlow) return;
          persistSimResultsToSession(latest);
        }, 0);
        return next;
      });
      return;
    }
    setSimResults((prev) => {
      if (!prev) return prev;
      const key = prev.simulationId ?? 'local';
      const prevFlowId = prev.evaluationFlow?.simulationId ?? 'local';
      if (prev.evaluationFlow && prevFlowId === key) {
        return prev;
      }
      // Id mismatch with an already-ranked membership: align ids, do not rebuild
      // from pools (that drops exploration / later OOTB inserts).
      const flowRoles = prev.evaluationFlow?.roles;
      if (prev.evaluationFlow && Array.isArray(flowRoles) && flowRoles.length > 0) {
        const resolvedId =
          (key && key !== 'local' ? key : null)
          || (prevFlowId && prevFlowId !== 'local' ? prevFlowId : null)
          || key;
        const next = {
          ...prev,
          simulationId: resolvedId,
          evaluationFlow: {
            ...prev.evaluationFlow,
            simulationId: resolvedId,
          },
        };
        const epochAtSchedule = ++simulationPersistEpochRef.current;
        setTimeout(() => {
          if (epochAtSchedule !== simulationPersistEpochRef.current) return;
          const latest = simResultsRef.current || next;
          if (!latest?.evaluationFlow) return;
          persistSimResultsToSession(latest);
        }, 0);
        return next;
      }
      const evaluationFlow = ensureEvaluationFlow(prev);
      if (!evaluationFlow) return prev;
      const next = { ...prev, evaluationFlow };
      const epochAtSchedule = ++simulationPersistEpochRef.current;
        setTimeout(() => {
          if (epochAtSchedule !== simulationPersistEpochRef.current) return;
          const latest = simResultsRef.current || next;
          if (!latest?.evaluationFlow) return;
          persistSimResultsToSession(latest);
        }, 0);
      return next;
    });
  }, [simResults, persistSimResultsToSession]);

  useEffect(() => {
    // Handle navigation state changes
    if (location.state) {
      if (location.state.simulationId) {
        // Load a specific saved simulation
        fetchSimulationById(location.state.simulationId);
      } else if (location.state.refresh) {
        const storedData = loadSimulationFromStorage();
        if (storedData?.results && storedData.state !== 'saved') {
          applySessionSimulation(storedData);
        } else if (location.pathname === '/puzzle-job') {
          fetchLastSimulation();
        } else {
          setLoadingLast(false);
        }
        guardedNavigate(location.pathname, { replace: true });
        return;
      }
    }

    // Default behavior: load last simulation if no special navigation state
    if (!location.state || (!location.state.simulationId && !location.state.refresh)) {
      const storedData = loadSimulationFromStorage();
      console.log('Navigation check - session storage state:', {
        storedData,
        locationState: location.state,
        detailContextPresent: Boolean(
          typeof sessionStorage !== 'undefined'
          && sessionStorage.getItem('currentSimulationDetailContext')
        ),
      });

      if (storedData && storedData.state === 'saved') {
        if (location.pathname === '/puzzle-job') {
          fetchLastSimulation();
        } else {
          console.log('Simulation was saved, not fetching last simulation to prevent restoration', {
            state: storedData.state,
            hasResults: !!storedData.results,
            timestamp: storedData.metadata?.timestamp
          });
        }
      } else if (!storedData) {
        fetchLastSimulation();
      } else if (storedData.results && storedData.state !== 'saved') {
        // Session already holds the current run (e.g. clean/modified after POST /simulation). Do not
        // overwrite with GET /simulation/last — that races with mount load and can drop evaluationFlow.
        console.log('Session has simulation results; skipping fetchLastSimulation on mount');
        applySessionSimulation(storedData);
      } else {
        console.log('Fetching last simulation from server');
        fetchLastSimulation();
      }
    }

    // eslint-disable-next-line
  }, [location.state, location.pathname]);

  // Fetch last simulation result on mount
  const fetchLastSimulation = async (options = {}) => {
    const { forceLocalizationRefresh = false, background = false } = options;
    const fetchKey = `${forceLocalizationRefresh ? 'force' : 'normal'}:${requestLang}`;
    if (fetchLastInFlightRef.current?.key === fetchKey) {
      return fetchLastInFlightRef.current.promise;
    }

    const runFetch = async () => {
    // Clear used replacements when starting fresh
    try {
      sessionStorage.removeItem('usedReplacements');
    } catch (error) {
      console.warn('Failed to clear used replacements:', error);
    }
    
    // Prefer active session / reconciled unsaved snapshot over a server fetch.
    // Plain strings in sessionStorage cannot change locale — bypass when syncing language so GET ?lang= runs.
    if (!isViewingSavedSimulation && !forceLocalizationRefresh) {
      const preferred = loadPreferredSimulationSnapshot();
      if (preferred?.results) {
        if (preferred.source === 'session') {
          applySessionSimulation({
            results: preferred.results,
            metadata: preferred.metadata || { simulationDate: preferred.date },
            state: preferred.state,
          });
        } else {
          safeSetSimResults(preferred.results);
          setSimulationDate(preferred.date);
          setHasUnsavedChanges(true);
          setSimulationState(preferred.state || 'modified');
          markLocalizationSyncedFromResults(preferred.results);
          setLoadingLast(false);
        }
        return;
      }
    }

    const onResultsRoute = location.pathname === '/puzzle-job';
    const storedData = loadSimulationFromStorage();
    console.log('fetchLastSimulation - session storage check:', {
      storedData,
      state: storedData?.state,
      hasResults: !!storedData?.results,
      onResultsRoute,
      forceLocalizationRefresh,
      background
    });

    if (!forceLocalizationRefresh && storedData?.results && storedData.state !== 'saved') {
      console.log('Active session simulation; skip server fetch in fetchLastSimulation');
      applySessionSimulation(storedData);
      return;
    }

    // Never replace a locally modified ranking (incl. exploration merges) with a stale server snapshot.
    if (
      forceLocalizationRefresh
      && storedData?.results
      && storedData.state === 'modified'
      && !isViewingSavedSimulation
    ) {
      const localFlow = storedData.results.evaluationFlow || simResultsRef.current?.evaluationFlow;
      try {
        const res = await fetch(`/api/profile/simulation/last?lang=${encodeURIComponent(requestLang)}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        });
        const data = await res.json();
        if (data?.results) {
          const sanitized = sanitizeSimulationResultsPayload(data.results);
          if (sanitized) {
            const flow = mergeEvaluationFlowFromResults(sanitized, localFlow || sanitized.evaluationFlow);
            const merged = flow ? { ...sanitized, evaluationFlow: flow } : sanitized;
            safeSetSimResults(merged);
            setSimulationDate(data.date || storedData.metadata?.simulationDate);
            setSimulationState('modified');
            markLocalizationSyncedFromResults(merged);
            try {
              saveSimulationToStorage(
                {
                  results: merged,
                  simulationDate: data.date ? new Date(data.date) : new Date(),
                  profileCompletion,
                },
                'modified'
              );
            } catch (e) {
              console.warn('Failed to persist localized simulation to session storage:', e);
            }
            setLoadingLast(false);
            return;
          }
        }
      } catch (err) {
        console.warn('Localization refresh with local merge failed; keeping session results:', err);
      }
      applySessionSimulation(storedData);
      return;
    }

    if (storedData && storedData.state === 'saved' && !onResultsRoute) {
      console.log('Simulation was saved, not fetching from server');
      setLoadingLast(false);
      return;
    }

    if (!background) {
      setLoadingLast(true);
    }
    try {
      const overall = await calculateProfileCompletion();
      if (overall < MIN_PROFILE_COMPLETION_REQUIRED) {
        setLoadingLast(false);
        return;
      }

      const res = await fetch(`/api/profile/simulation/last?lang=${encodeURIComponent(requestLang)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await res.json();
      if (data && data.results) {
        const sanitized = sanitizeSimulationResultsPayload(data.results);
        if (sanitized) {
          const flow = mergeEvaluationFlowFromResults(
            sanitized,
            // Prefer in-memory flow, then session, so a cold remount does not
            // discard exploration / later inserts that the server snapshot lacks.
            simResultsRef.current?.evaluationFlow
              || loadSimulationFromStorage()?.results?.evaluationFlow
              || sanitized.evaluationFlow
          );
          const merged = flow ? { ...sanitized, evaluationFlow: flow } : sanitized;
          safeSetSimResults(merged);
          setSimulationDate(data.date); // Store the simulation date
          setHasUnsavedChanges(false);
          setSimulationState('clean');
          setIsViewingSavedSimulation(false); // Last simulation is not from saved simulations
          markLocalizationSyncedFromResults(merged);
          try {
            const hasProgress = hasSimulationEvaluationProgress(merged.evaluationFlow);
            saveSimulationToStorage(
              {
                results: merged,
                simulationDate: data.date ? new Date(data.date) : new Date(),
                profileCompletion,
              },
              hasProgress ? 'modified' : 'clean'
            );
          } catch (e) {
            console.warn('Failed to persist localized simulation to session storage:', e);
          }
          if (location.pathname === '/simulation') {
            navigate('/puzzle-job', { replace: true });
          }
        }
      }
    } catch (err) {
      console.error('Error fetching last simulation:', err);
    } finally {
      setLoadingLast(false);
    }
    };

    const promise = runFetch();
    fetchLastInFlightRef.current = { key: fetchKey, promise };
    try {
      await promise;
    } finally {
      if (fetchLastInFlightRef.current?.promise === promise) {
        fetchLastInFlightRef.current = null;
      }
    }
  };

  const fetchSimulationById = async (simulationId, options = {}) => {
    const { background = false } = options;
    if (!background) {
      setLoadingLast(true);
    }
    try {
      const res = await fetch(`/api/profile/simulation/saved/${simulationId}?lang=${encodeURIComponent(requestLang)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await res.json();
      if (data.success) {
        safeSetSimResults(data.simulation.results);
        setSelectedSimulation(data.simulation);
        setSimulationDate(data.simulation.timestamp); // Store the simulation timestamp
        setHasUnsavedChanges(false);
        setIsViewingSavedSimulation(true); // This is a saved simulation
        markLocalizationSyncedFromResults(data.simulation.results, simulationId);

        // Initialize category display counts from saved simulation
        if (data.simulation.categoryDisplayCounts) {
          setCategoryDisplayCounts(data.simulation.categoryDisplayCounts);
        } else {
          // Initialize with current display counts
          setCategoryDisplayCounts({
            nextSteps: data.simulation.results?.nextSteps?.length || 10,
            outsideTheBox: data.simulation.results?.outsideTheBox?.length || 10
          });
        }
      } else {
        setSimError(data.message || t('simulation.messages.loadFailed', { ns: 'dashboard' }));
      }
    } catch (err) {
      setSimError(t('simulation.messages.loadFailed', { ns: 'dashboard' }));
    } finally {
      setLoadingLast(false);
    }
  };

  const handleStartSimulation = () => {
    setSimulationWizardIntent(true);
    handleSimulate();
  };

  const handleSimulate = async () => {
    if (profileSimulationGate.ready && profileSimulationGate.belowMin) {
      setSimError(
        t('simulation.messages.profileCompletionRequired', {
          ns: 'dashboard',
          min: MIN_PROFILE_COMPLETION_REQUIRED,
        })
      );
      setSimulationWizardIntent(false);
      return;
    }

    setSimLoading(true);
    setSimulationJobState('queued');
    setSimulationProgress(0);
    setSimResults(null);
    setSimError('');
    setHasUnsavedChanges(false);
    setSimulationState('clean');
    setIsViewingSavedSimulation(false); // New simulation is not from saved simulations
    
    // Clear any existing session storage
    clearSimulationFromStorage();
    
    try {
      const startRes = await fetch(`/api/profile/simulation?lang=${encodeURIComponent(requestLang)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({})
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData?.jobId) {
        const startErrorMsg =
          startData?.message ||
          startData?.error ||
          t('simulation.messages.failedTryAgain', { ns: 'dashboard' });
        setSimError(startErrorMsg);
        setSimulationWizardIntent(false);
        return;
      }

      const token = localStorage.getItem('token');
      const jobId = startData.jobId;
      simulationRunAbortRef.current?.abort();
      const runAbort = new AbortController();
      simulationRunAbortRef.current = runAbort;

      let data = null;
      const fetchLastSimulationPayload = async () => {
        const lastRes = await fetch(
          `/api/profile/simulation/last?lang=${encodeURIComponent(requestLang)}&_ts=${Date.now()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        );
        const lastData = await lastRes.json();
        if (lastRes.ok && lastData?.results) {
          return {
            results: lastData.results,
            profileCompletion: profileCompletion || 0,
          };
        }
        return null;
      };

      const fetchCompletedJobResult = async () => {
        // The status can flip to completed just before the result document is visible.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          // eslint-disable-next-line no-await-in-loop
          const resultRes = await fetch(
            `/api/profile/simulation/jobs/${encodeURIComponent(jobId)}/result?lang=${encodeURIComponent(requestLang)}&_ts=${Date.now()}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            }
          );
          // eslint-disable-next-line no-await-in-loop
          const resultData = await resultRes.json();
          if (resultRes.ok && resultData?.results) return resultData;
          if (resultRes.status !== 409) break;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        return fetchLastSimulationPayload();
      };

      const outcome = await waitForSimulationJobCompletion({
        jobId,
        token,
        lang: requestLang,
        signal: runAbort.signal,
        onJobUpdate: ({ status, progress }) => {
          if (status === 'queued' || status === 'pending') {
            setSimulationJobState('queued');
          } else if (status === 'running') {
            setSimulationJobState('running');
          } else if (status === 'completed') {
            setSimulationProgress(100);
          }
          if (Number.isFinite(progress)) {
            setSimulationProgress((prev) => Math.max(prev, progress));
          }
        },
      });

      if (outcome.kind === 'aborted') {
        return;
      }

      if (outcome.kind === 'poll_http_error') {
        setSimError(
          outcome.message || t('simulation.messages.failedTryAgain', { ns: 'dashboard' })
        );
        setSimulationWizardIntent(false);
        return;
      }

      if (outcome.kind === 'failed') {
        setSimError(
          outcome.error || t('simulation.messages.failedTryAgain', { ns: 'dashboard' })
        );
        setSimulationWizardIntent(false);
        return;
      }

      if (outcome.kind === 'completed' || outcome.kind === 'timeout') {
        data = await fetchCompletedJobResult();
      }

      if (!data) {
        // Final reconciliation before showing failure:
        // 1) Re-check status/result for this job
        // 2) Fallback to the last simulation endpoint
        const finalStatusRes = await fetch(
          `/api/profile/simulation/jobs/${encodeURIComponent(jobId)}/status?lang=${encodeURIComponent(requestLang)}&_ts=${Date.now()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        );
        const finalStatusData = await finalStatusRes.json();
        if (finalStatusRes.ok && finalStatusData?.job?.status === 'completed') {
          data = await fetchCompletedJobResult();
        }

        if (!data) {
          const lastRes = await fetch(
            `/api/profile/simulation/last?lang=${encodeURIComponent(requestLang)}&_ts=${Date.now()}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            }
          );
          const lastData = await lastRes.json();
          if (lastRes.ok && lastData?.results) {
            data = {
              results: lastData.results,
              profileCompletion: profileCompletion || 0,
            };
          }
        }

        if (!data) {
          setSimError(t('simulation.messages.failedTryAgain', { ns: 'dashboard' }));
          setSimulationWizardIntent(false);
          return;
        }
      }

      if (data && data.results) {
        invalidateLastSimulationQuery();
        safeSetSimResults(data.results);
        setSimulationDate(new Date()); // Set current date for new simulation
        setSimulationState('clean'); // New simulation starts in clean state
        
        // Initialize category display counts for new simulation
        setCategoryDisplayCounts({
          nextSteps: data.results?.nextSteps?.length || 10,
          outsideTheBox: data.results?.outsideTheBox?.length || 10
        });
        
        // Save clean simulation results to session storage
        const simulationData = {
          results: data.results,
          simulationDate: new Date(),
          profileCompletion: data.profileCompletion || 0
        };
        
        const saveSuccess = saveSimulationToStorage(simulationData, 'clean');
        if (!saveSuccess) {
          console.warn('⚠️ Failed to save simulation to session storage - persistence disabled');
        }

        markLocalizationSyncedFromResults(data.results);

        // Show generated results on dedicated results screen.
        navigate('/puzzle-job');
      } else {
        const errorMsg =
          (data && data.message) ||
          (data && data.error) ||
          (startRes.status === 403
            ? t('simulation.messages.completeProfileToRun', {
                ns: 'dashboard',
                min: MIN_PROFILE_COMPLETION_REQUIRED,
              })
            : t('simulation.messages.failedTryAgain', { ns: 'dashboard' }));
        setSimError(errorMsg);
        setSimulationWizardIntent(false);
      }
    } catch (err) {
      setSimError(t('simulation.messages.failedCheckConnection', { ns: 'dashboard' }));
      setSimulationWizardIntent(false);
    } finally {
      setSimulationJobState('idle');
      setSimulationProgress(0);
      setSimLoading(false);
    }
  };

  // Re-load last/saved simulation from the server when UI language changes (or when session
  // holds a run that was never synced for the current language). Plain client-side strings
  // cannot switch locale; GET ?lang= runs `localizeSimulationResults` on the server.
  useEffect(() => {
    if (!simResults) return;
    if (simulationState === 'modified') return;

    if (isViewingSavedSimulation && selectedSimulation?.id) {
      const bundleKey = `saved:${selectedSimulation.id}:${requestLang}`;
      if (localizationSyncedRef.current.bundleKey === bundleKey) return;
      fetchSimulationById(selectedSimulation.id, { background: true });
      return;
    }

    const sid = simResults.simulationId;
    if (!sid) return;
    const bundleKey = `${sid}:${requestLang}`;
    if (localizationSyncedRef.current.bundleKey === bundleKey) return;

    fetchLastSimulation({ forceLocalizationRefresh: true, background: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestLang, simResults?.simulationId, simulationState, isViewingSavedSimulation, selectedSimulation?.id]);

  // Handle save changes for existing simulations
  const handleSaveChanges = () => {
    setSaveChangesDialogOpen(true);
  };

  const handleSaveChangesConfirm = async () => {
    if (!selectedSimulation || !hasChanges) return;
    
    setSavingChanges(true);
    try {
      console.log('🔄 Saving changes to simulation:', selectedSimulation.id);
      
      const result = await updateSimulation(selectedSimulation.id, selectedSimulation);
      
      if (result.success) {
        invalidateCareerIdentityQueries();
        // Update the selected simulation with the returned data
        setSelectedSimulation(result.updatedSimulation);
        
        // Update the original data to reflect the saved state
        setOriginalSimulationData(result.updatedSimulation);
        
        // Reset change detection
        resetChanges();
        
        // Close dialog and show success message
        setSaveChangesDialogOpen(false);
        showSnackbar(t('simulation.messages.changesSavedSuccessfully', { ns: 'dashboard' }), 'success');
        
        invalidateSavedSimulationsListQuery();
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

  const handleLoadSimulation = async (simulationId) => {
    try {
      const res = await fetch(`/api/profile/simulation/saved/${simulationId}?lang=${encodeURIComponent(requestLang)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await res.json();
      if (data.success) {
        safeSetSimResults(data.simulation.results);
        setSelectedSimulation(data.simulation);
        setSimulationDate(data.simulation.timestamp); // Store the simulation timestamp
        setHasUnsavedChanges(false);
        setSimulationState('saved'); // Loaded simulation is in saved state
        setIsViewingSavedSimulation(true); // This is a saved simulation
        setHistoryDrawerOpen(false);
        
        // Mark session storage as 'saved' since we're loading a saved simulation
        const simulationData = {
          results: null,
          simulationDate: null,
          profileCompletion: 0
        };
        saveSimulationToStorage(simulationData, 'saved');
        
        // Set original data for change detection
        setOriginalSimulationData(JSON.parse(JSON.stringify(data.simulation)));
        
        // Initialize category display counts from saved simulation
        if (data.simulation.categoryDisplayCounts) {
          setCategoryDisplayCounts(data.simulation.categoryDisplayCounts);
        } else {
          // Initialize with current display counts
          setCategoryDisplayCounts({
            nextSteps: data.simulation.results?.nextSteps?.length || 10,
            outsideTheBox: data.simulation.results?.outsideTheBox?.length || 10
          });
        }
        
        markLocalizationSyncedFromResults(data.simulation.results, simulationId);

        showSnackbar(t('simulation.messages.loadedSuccessfully', { ns: 'dashboard' }), 'success');
      }
    } catch (err) {
      showSnackbar(t('simulation.messages.loadFailed', { ns: 'dashboard' }), 'error');
    }
  };

  const handleDeleteSimulation = async (simulationId) => {
    setSimulationToDelete(simulationId);
    setDeleteSimulationDialogOpen(true);
  };

  const handleConfirmDeleteSimulation = async () => {
    if (!simulationToDelete) return;
    
    try {
      const res = await fetch(`/api/profile/simulation/saved/${simulationToDelete}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (res.ok) {
        invalidateCareerIdentityQueries();
        invalidateSavedSimulationsListQuery();
        showSnackbar(t('simulation.messages.deletedSuccessfully', { ns: 'dashboard' }), 'success');
      } else {
        showSnackbar(t('simulation.messages.deleteFailed', { ns: 'dashboard' }), 'error');
      }
    } catch (err) {
      showSnackbar(t('simulation.messages.deleteFailed', { ns: 'dashboard' }), 'error');
    } finally {
      setDeleteSimulationDialogOpen(false);
      setSimulationToDelete(null);
    }
  };

  const handleCancelDeleteSimulation = () => {
    setDeleteSimulationDialogOpen(false);
    setSimulationToDelete(null);
  };

  const showSnackbar = useCallback((message, severity = 'success', options = {}) => {
    const { linkTo = null, linkLabel = null } = options;
    setSnackbar({ open: true, message, severity, linkTo, linkLabel });
  }, []);

  const handleWizardPauseAndExit = useCallback(() => {
    setSimResults((prev) => {
      if (!prev?.evaluationFlow) return prev;
      const nextFlow = pauseSimulationWizard(prev.evaluationFlow);
      const next = { ...prev, evaluationFlow: nextFlow };
      const epochAtSchedule = ++simulationPersistEpochRef.current;
        setTimeout(() => {
          if (epochAtSchedule !== simulationPersistEpochRef.current) return;
          const latest = simResultsRef.current || next;
          if (!latest?.evaluationFlow) return;
          persistSimResultsToSession(latest);
        }, 0);
      return next;
    });
    setSimulationWizardIntent(false);
    markSavedSimulationDraftDirty();
    showSnackbar(t('simulation.wizard.pauseDialog.savedMessage', { ns: 'dashboard' }), 'success');
  }, [persistSimResultsToSession, markSavedSimulationDraftDirty, showSnackbar, t]);

  /**
   * Saving clears results and navigates to `/simulation`. That route swap remounts this
   * component, which would wipe an in-memory snackbar set in the same handler. Toast
   * payload is passed in `location.state` and applied here, then stripped from history.
   */
  useEffect(() => {
    const pending = location.state?.postSaveSnackbar;
    if (!pending?.message) return;

    showSnackbar(pending.message, pending.severity ?? 'success', {
      linkTo: pending.linkTo ?? null,
      linkLabel: pending.linkLabel ?? null,
    });

    const prev = location.state || {};
    const { postSaveSnackbar: _drop, ...rest } = prev;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: Object.keys(rest).length ? rest : undefined }
    );
  }, [location.state?.postSaveSnackbar, location.pathname, location.search, location.hash, navigate, showSnackbar]);

  // Handle profile update recommendation
  const handleShowProfileRecommendation = async (category) => {
    if (!showProfileRecommendation) {
      const completion = await calculateProfileCompletion();
      setProfileCompletion(completion);
      setRecommendationCategory(category);
      setShowProfileRecommendation(true);
    }
  };

  const handleDismissRecommendation = () => {
    setShowProfileRecommendation(false);
    setRecommendationCategory(null);
  };

  const handleUpdateProfile = () => {
    guardedNavigate('/profile/fill');
  };

  const simulationResultsPageActions = useMemo(() => {
    if (!simResults) return [];

    const actions = [];

    if (!canRunSimulation) {
      actions.push({
        key: 'go-to-profile',
        label: t('simulation.actions.goToProfile', { ns: 'dashboard' }),
        shortLabel: t('simulation.actions.goToProfileShort', { ns: 'dashboard' }),
        variant: 'outlined',
        startIcon: <ArrowForwardIcon />,
        onClick: () => guardedNavigate('/profile'),
        ariaLabel: t('simulation.aria.goToProfile', { ns: 'dashboard' }),
        compactOrder: 0,
      });
    }

    return actions;
  }, [
    simResults,
    isViewingSavedSimulation,
    canRunSimulation,
    t,
    guardedNavigate,
  ]);
  const hasSimulationResultsPageActions = simulationResultsPageActions.length > 0;

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const handleViewDetails = (result, category) => {
    
    // Create a unique result ID based on the result data and category
    const resultId = `${category}-${result.title.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;
    
    // Store the result data in sessionStorage for the details page to access
    const resultData = {
      ...result,
      category,
      resultId,
      createdAt: simulationDate ? (typeof simulationDate === 'string' ? simulationDate : simulationDate.toISOString()) : new Date().toISOString() // Handle both string and Date objects
    };
    
    sessionStorage.setItem('currentResultDetails', JSON.stringify(resultData));
    storeSimulationResultDetails(resultData, [resultId]);
    
    // Determine if the current results are from the loaded saved simulation or from a new simulation
    // We'll use a more reliable approach: check if the simulation date/timestamp matches
    const currentResultsAreFromSavedSimulation = selectedSimulation && 
      selectedSimulation.id && 
      simResults && 
      selectedSimulation.results && 
      simulationDate && 
      selectedSimulation.timestamp &&
      // Compare the simulation dates to see if they're the same
      new Date(simulationDate).getTime() === new Date(selectedSimulation.timestamp).getTime();
    
    
    // Detail pages should reuse the primary latest-run snapshot and only carry
    // lightweight saved-simulation context when needed.
    if (currentResultsAreFromSavedSimulation) {
      saveSimulationDetailContext({ savedSimulationId: selectedSimulation.id });
    } else {
      clearSimulationDetailContext();
    }
    
    // Navigate to the details page with context information
    guardedNavigate(`/simulation/result/${resultId}`, {
      state: {
        fromSaved: currentResultsAreFromSavedSimulation,
        simulationId: currentResultsAreFromSavedSimulation ? selectedSimulation.id : null,
        returnTo: currentResultsAreFromSavedSimulation ? 'saved' : 'unsaved',
        category: category
      }
    });
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

  useEffect(() => {
    const rolesToWarm = [];
    const flow = simResults?.evaluationFlow;
    if (flow?.nextSteps?.length) rolesToWarm.push(...flow.nextSteps);
    if (flow?.outsideTheBox?.length) rolesToWarm.push(...flow.outsideTheBox);
    if (!rolesToWarm.length) return;
    rolesToWarm.forEach((role) => {
      void resolveCanonicalEscoId(role);
    });
  }, [simResults, resolveCanonicalEscoId]);

  // Add error boundary wrapper
  const renderWithErrorBoundary = () => {
    try {
      return (() => {
        try {
          // Validate and sanitize all state before rendering
          if (!validateAndSanitizeState()) {
            console.error('State validation failed, showing error state');
            return (
              <Box sx={{ textAlign: 'center', mt: 6 }}>
                <Typography color="error" variant="h6">
                  {t('simulation.errors.stateValidationFailed', { ns: 'dashboard' })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('simulation.errors.refreshOrContact', { ns: 'dashboard' })}
                </Typography>
              </Box>
            );
          }
          
          // Ensure simResults is safe before rendering
          if (simResults && typeof simResults === 'object') {
            // Double-check that all arrays exist
            if (!Array.isArray(simResults.nextSteps)) simResults.nextSteps = [];
            if (!Array.isArray(simResults.outsideTheBox)) simResults.outsideTheBox = [];
            if (!Array.isArray(simResults.outsideComfortZone)) simResults.outsideComfortZone = [];
            if (!Array.isArray(simResults.furtherAdvice)) simResults.furtherAdvice = [];
            if (!Array.isArray(simResults.resources)) simResults.resources = [];
          }
          
          // Additional safety check - ensure all state variables are valid
          if (typeof simResults !== 'object' && simResults !== null) {
            console.error('Invalid simResults type:', typeof simResults);
            return (
              <Box sx={{ textAlign: 'center', mt: 6 }}>
                <Typography color="error" variant="h6">
                  {t('simulation.errors.invalidSimulationData', { ns: 'dashboard' })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('simulation.errors.refreshOrContact', { ns: 'dashboard' })}
                </Typography>
              </Box>
            );
          }
          
          // Ensure simResults is never null during rendering by providing a safe fallback
          let safeSimResults = simResults || { nextSteps: [], outsideTheBox: [], outsideComfortZone: [], furtherAdvice: [], resources: [] };
          
          // Additional validation to ensure all arrays are actually arrays
          if (!Array.isArray(safeSimResults.nextSteps)) safeSimResults.nextSteps = [];
          if (!Array.isArray(safeSimResults.outsideTheBox)) safeSimResults.outsideTheBox = [];
          if (!Array.isArray(safeSimResults.outsideComfortZone)) safeSimResults.outsideComfortZone = [];
          if (!Array.isArray(safeSimResults.furtherAdvice)) safeSimResults.furtherAdvice = [];
          if (!Array.isArray(safeSimResults.resources)) safeSimResults.resources = [];
          
          // Final validation - ensure safeSimResults is a valid object
          if (!safeSimResults || typeof safeSimResults !== 'object') {
            console.error('safeSimResults is invalid, using fallback:', safeSimResults);
            safeSimResults = { nextSteps: [], outsideTheBox: [], outsideComfortZone: [], furtherAdvice: [], resources: [] };
          }
          
          // State consistency tracking (removed verbose logging)
          
          const resultsHeaderOrder = simResults
            ? { title: { xs: 1, sm: 0 }, subtitle: { xs: 2, sm: 1 }, profileGate: { xs: 3, sm: 2 }, actions: { xs: 0, sm: 4 } }
            : { title: 0, subtitle: 1, profileGate: 2, actions: 3 };

          return (
            <>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {!(loadingLast || simLoading) && simResults && (
                <Box sx={{ order: resultsHeaderOrder.actions, mb: { xs: 2, sm: 4 } }}>
                  {hasSimulationResultsPageActions && (
                    <ProfilePageActionBar
                      actions={simulationResultsPageActions}
                      sx={{ mb: 2, px: { xs: 0.5, sm: 0 } }}
                    />
                  )}
                  <IdentityExplorationDiscoverCta
                    sx={{ mb: 0 }}
                    onExplorationRanked={handleExplorationRanked}
                  />
                </Box>
              )}

              <PageHeader
                title={
                  location.pathname === '/puzzle-job'
                    ? t('simulation.resultsTitle', { ns: 'dashboard' })
                    : t('simulation.pageTitle', { ns: 'dashboard' })
                }
                description={
                  simResults
                    ? t('simulation.subtitle.hasResults', { ns: 'dashboard' })
                    : t('simulation.subtitle.empty', { ns: 'dashboard' })
                }
                titleSx={{ order: resultsHeaderOrder.title }}
                descriptionSx={{ order: resultsHeaderOrder.subtitle }}
              />

              {profileSimulationGate.ready && profileSimulationGate.belowMin && (
                <Alert
                  severity="warning"
                  variant="outlined"
                  sx={{
                    order: resultsHeaderOrder.profileGate,
                    mb: 3,
                    maxWidth: 680,
                    mx: 'auto',
                    borderRadius: 3,
                    px: 2,
                    py: 1.5,
                    borderWidth: 1.5,
                    alignItems: 'center',
                    backgroundColor: 'warning.50'
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.25 }}>
                    {t('simulation.profileGate.title', { ns: 'dashboard' })}
                  </Typography>
                  <Typography variant="body2">
                    {t('simulation.profileGate.description', {
                      ns: 'dashboard',
                      current: profileCompletion,
                      min: MIN_PROFILE_COMPLETION_REQUIRED,
                    })}
                  </Typography>
                </Alert>
              )}

              {/* Action Buttons (pre-simulation only; finished results use ProfilePageActionBar above) */}
              {!(loadingLast || simLoading) && !simResults && (
                <Box
                  sx={{
                    order: resultsHeaderOrder.actions,
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    justifyContent: 'center',
                    alignItems: { xs: 'stretch', sm: 'center' },
                    gap: 2,
                    mb: 4,
                    flexWrap: 'wrap',
                    width: '100%',
                    maxWidth: { xs: 420, sm: 'none' },
                    mx: 'auto',
                    px: { xs: 0.5, sm: 0 },
                    '& > span': { display: { xs: 'block', sm: 'inline' }, width: { xs: '100%', sm: 'auto' } },
                    '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } },
                  }}
                >
                {!simResults && !simLoading && (
                  <Tooltip
                    title={
                      profileSimulationGate.ready && profileSimulationGate.belowMin
                        ? t('simulation.tooltips.completeProfileFirst', {
                            ns: 'dashboard',
                            min: MIN_PROFILE_COMPLETION_REQUIRED,
                          })
                        : t('simulation.tooltips.startSimulation', { ns: 'dashboard' })
                    }
                    arrow
                  >
                    <span>
                      <Button
                        aria-label={t('simulation.aria.startSimulation', { ns: 'dashboard' })}
                        variant="contained"
                        color="primary"
                        size="medium"
                        startIcon={<ExtensionIcon />}
                        onClick={handleStartSimulation}
                        sx={{
                          fontWeight: 600,
                          px: 3,
                          py: 1.5,
                          fontSize: '1rem',
                        }}
                        disabled={
                          simLoading ||
                          (profileSimulationGate.ready && profileSimulationGate.belowMin)
                        }
                      >
                        {t('simulation.actions.start', { ns: 'dashboard' })}
                      </Button>
                    </span>
                  </Tooltip>
                )}
                {!simResults &&
                  !simLoading &&
                  profileSimulationGate.ready &&
                  profileSimulationGate.belowMin && (
                    <Button
                      variant="contained"
                      color="primary"
                      size="medium"
                      startIcon={<ArrowForwardIcon />}
                      onClick={handleUpdateProfile}
                      sx={{
                        fontWeight: 600,
                        px: 3,
                        py: 1.5,
                        fontSize: '1rem',
                      }}
                    >
                      {t('profilePagePrompts.incomplete.cta', { ns: 'onboarding' })}
                    </Button>
                  )}
                {canRunSimulation && (
                  <Tooltip title={t('simulation.tooltips.updateProfile', { ns: 'dashboard' })} arrow>
                    <span>
                      <Button
                        aria-label={t('simulation.aria.goToProfile', { ns: 'dashboard' })}
                        variant="outlined"
                        color="primary"
                        size="medium"
                        startIcon={<ArrowForwardIcon />}
                        onClick={() => guardedNavigate('/profile')}
                        sx={{
                          fontWeight: 600,
                          px: 3,
                          py: 1.5,
                          fontSize: '1rem',
                        }}
                      >
                        {t('simulation.actions.goToProfile', { ns: 'dashboard' })}
                      </Button>
                    </span>
                  </Tooltip>
                )}
                </Box>
              )}
              </Box>

              {/* Delete Simulation Confirmation Dialog */}
              <Dialog
                open={deleteSimulationDialogOpen}
                onClose={handleCancelDeleteSimulation}
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
                  {simulationToDelete && savedSimulations.find(sim => sim.id === simulationToDelete) && (
                    <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                      <Typography variant="subtitle2" gutterBottom>
                        {t('simulation.deleteDialog.detailsTitle', { ns: 'dashboard' })}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>{t('simulation.deleteDialog.nameLabel', { ns: 'dashboard' })}</strong> {savedSimulations.find(sim => sim.id === simulationToDelete)?.name || t('simulation.deleteDialog.notSpecified', { ns: 'dashboard' })}
                      </Typography>
                      {savedSimulations.find(sim => sim.id === simulationToDelete)?.description && (
                        <Typography variant="body2" color="text.secondary">
                          <strong>{t('simulation.deleteDialog.descriptionLabel', { ns: 'dashboard' })}</strong> {savedSimulations.find(sim => sim.id === simulationToDelete)?.description}
                        </Typography>
                      )}
                    </Box>
                  )}
                  <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 'bold' }}>
                    {t('simulation.deleteDialog.warning', { ns: 'dashboard' })}
                  </Typography>
                </DialogContent>
                <DialogActions>
                  <Button 
                    onClick={handleCancelDeleteSimulation}
                    variant="outlined"
                    color="primary"
                    autoFocus
                  >
                    {t('profilePage.actions.cancel', { ns: 'onboarding' })}
                  </Button>
                  <Button 
                    onClick={handleConfirmDeleteSimulation}
                    variant="contained"
                    color="error"
                  >
                    {t('profilePage.photo.editor.delete', { ns: 'onboarding' })}
                  </Button>
                </DialogActions>
              </Dialog>

              {/* Error Display */}
              {simError && (
                <Box sx={{ textAlign: 'center', mt: 4 }}>
                  <Typography color="error" variant="h6">{simError}</Typography>
                </Box>
              )}

              {/* Loading State */}
              {loadingLast || (simLoading && !simulationWizardActive) ? (
                <Box sx={{ textAlign: 'center', mt: 6 }}>
                  {loadingLast && !simLoading && <CircularProgress size={30} />}
                  {simLoading && (
                    <Box sx={{ maxWidth: 440, mx: 'auto' }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                        {simulationJobState === 'queued'
                          ? t('simulation.loadingQueued', { ns: 'dashboard' })
                          : simulationJobState === 'running'
                            ? t('simulation.loadingRunning', { ns: 'dashboard' })
                            : t('simulation.loadingUpdating', { ns: 'dashboard' })}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, Math.max(0, simulationProgress))}
                        sx={{
                          height: 8,
                          borderRadius: 999,
                        }}
                      />
                    </Box>
                  )}
                </Box>
              ) : simResults && (
                <Box sx={{ mt: { xs: 0, sm: 6 } }}>
                  {selectedSimulation && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                        <Chip 
                          label={`Loaded: ${selectedSimulation.name}`} 
                          color="primary" 
                        />
                        <Typography variant="caption" color="text.secondary">
                          {t('simulation.loadedMeta.savedOn', {
                            ns: 'dashboard',
                            date: formatDate(selectedSimulation.timestamp),
                          })}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                  {!selectedSimulation && hasUnsavedChanges && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                      <UnsavedChangesIndicator
                        hasChanges={hasUnsavedChanges}
                        variant="chip"
                      />
                    </Box>
                  )}
                  
                  {/* Save Changes Button and Unsaved Changes Indicator */}
                  {isViewingSavedSimulation && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexWrap: 'wrap',
                        gap: 2,
                        mb: 3,
                        px: { xs: 1, sm: 0 },
                      }}
                    >
                      <UnsavedChangesIndicator
                        hasChanges={hasChanges}
                        variant="chip"
                      />
                      <Tooltip title={t('simulation.tooltips.saveEdits', { ns: 'dashboard' })} arrow>
                        <span>
                          <SaveChangesButton
                            hasChanges={hasChanges}
                            loading={updateLoading || savingChanges}
                            onSave={handleSaveChanges}
                            aria-label={t('simulation.aria.saveEdits', { ns: 'dashboard' })}
                          />
                        </span>
                      </Tooltip>
                    </Box>
                  )}

                  {!safeSimResults.evaluationFlow ? (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                      <CircularProgress size={32} />
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        {t('simulation.preparingRoleEvaluation', { ns: 'dashboard' })}
                      </Typography>
                    </Box>
                  ) : simulationWizardActive ? null : canResumeSimulationWizard(safeSimResults.evaluationFlow) ? (
                    <SimulationWizardPausedPrompt
                      evaluationFlow={safeSimResults.evaluationFlow}
                      onResume={handleWizardResume}
                    />
                  ) : (
                    <>
                      <SimulationEvaluationFlow
                        key={[
                          'eval-flow',
                          safeSimResults?.simulationId || 'local',
                          ...(Array.isArray(safeSimResults.evaluationFlow?.mergedExplorationSessionIds)
                            ? safeSimResults.evaluationFlow.mergedExplorationSessionIds
                            : []),
                          Array.isArray(safeSimResults.evaluationFlow?.roles)
                            ? safeSimResults.evaluationFlow.roles.length
                            : 0,
                        ].join(':')}
                        evaluationFlow={safeSimResults.evaluationFlow}
                        onUnlockMobileOutsideTheBox={handleUnlockMobileOutsideTheBox}
                        onSkipOutsideTheBox={handleSkipOutsideTheBox}
                        onResumeOutsideTheBox={handleResumeOutsideTheBox}
                        nextStepsTitle={t('simulation.categories.nextRoles', { ns: 'dashboard' })}
                        outsideTheBoxTitle={t('simulation.categories.outsideRoles', { ns: 'dashboard' })}
                        onEvaluate={handleEvaluationCommit}
                        onSeeRanking={handleSeeRoleRanking}
                        onReorderRankedRoles={handleReorderRankedRoles}
                        onReorderCombinedRankedRoles={handleReorderCombinedRankedRoles}
                        guardedNavigate={guardedNavigate}
                        isViewingSavedSimulation={isViewingSavedSimulation}
                        savedSimulationId={selectedSimulation?.id}
                        simulationIdForCards={
                          selectedSimulation?.id || safeSimResults?.simulationId || 'local'
                        }
                        onPlanPath={handlePlanPath}
                        nextStepsProfileRecommendation={
                          <ProfileUpdateRecommendation
                            category="nextSteps"
                            profileCompletion={profileCompletion}
                            onUpdateProfile={handleUpdateProfile}
                            onDismiss={handleDismissRecommendation}
                            isVisible={showProfileRecommendation && recommendationCategory === 'nextSteps'}
                          />
                        }
                        outsideTheBoxProfileRecommendation={
                          <ProfileUpdateRecommendation
                            category="outsideTheBox"
                            profileCompletion={profileCompletion}
                            onUpdateProfile={handleUpdateProfile}
                            onDismiss={handleDismissRecommendation}
                            isVisible={showProfileRecommendation && recommendationCategory === 'outsideTheBox'}
                          />
                        }
                      />
                    </>
                  )}
                </Box>
              )}
              <Snackbar
                open={snackbar.open}
                autoHideDuration={8000}
                onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
              >
                <Alert
                  onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
                  severity={snackbar.severity}
                  action={
                    snackbar.linkTo ? (
                      <Button
                        component={RouterLink}
                        to={snackbar.linkTo}
                        color="inherit"
                        size="small"
                        sx={{ fontWeight: 600 }}
                        onClick={() => setSnackbar((prev) => ({ ...prev, open: false }))}
                      >
                        {snackbar.linkLabel || t('simulation.actions.open', { ns: 'dashboard' })}
                      </Button>
                    ) : null
                  }
                >
                  {snackbar.message}
                </Alert>
              </Snackbar>
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </>
          );
        } catch (error) {
          console.error('Error rendering Simulation component:', error);
          return (
            <Box sx={{ textAlign: 'center', mt: 6 }}>
              <Typography color="error" variant="h6">
                {t('simulation.errors.unexpected', { ns: 'dashboard' })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('simulation.errors.refreshOrContact', { ns: 'dashboard' })}
              </Typography>
            </Box>
          );
        }
      })();
    } catch (error) {
      console.error('Critical error in Simulation component:', error);
      return (
        <Box sx={{ textAlign: 'center', mt: 6 }}>
          <Typography color="error" variant="h6">
            {t('simulation.errors.critical', { ns: 'dashboard' })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('simulation.errors.refreshOrContact', { ns: 'dashboard' })}
          </Typography>
        </Box>
      );
    }
  };
  
  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      {renderWithErrorBoundary()}

      {simulationWizardActive && simulationWizardStep ? (
        <SimulationStartWizard
          open
          phase={simulationWizardStep.phase}
          step={simulationWizardStep.step}
          simLoading={simLoading}
          simulationJobState={simulationJobState}
          simulationProgress={simulationProgress}
          evaluationFlow={simResults?.evaluationFlow}
          simError={simError}
          onDismissError={() => setSimError('')}
          onEvaluateNext={handleWizardEvaluateNext}
          onEvaluateOotb={handleWizardEvaluateOotb}
          onSkipOotb={handleWizardSkipOotb}
          onContinueOotb={handleWizardContinueOotb}
          onPauseAndExit={handleWizardPauseAndExit}
          guardedNavigate={guardedNavigate}
          isViewingSavedSimulation={isViewingSavedSimulation}
          savedSimulationId={selectedSimulation?.id}
          simulationIdForCards={
            selectedSimulation?.id || simResults?.simulationId || 'local'
          }
        />
      ) : null}

      {/* Save Changes Dialog */}
      <SaveChangesDialog
        open={saveChangesDialogOpen}
        onClose={handleSaveChangesCancel}
        onConfirm={handleSaveChangesConfirm}
        loading={savingChanges}
        changeSummary={getChangeSummary()}
        simulationName={selectedSimulation?.name || t('simulation.defaultName', { ns: 'dashboard' })}
      />

    </Box>
  );
};

export default Simulation; 
