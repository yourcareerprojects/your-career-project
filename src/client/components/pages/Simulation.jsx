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
  TextField,
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
import SaveIcon from '@mui/icons-material/Save';
import HistoryIcon from '@mui/icons-material/History';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ViewListIcon from '@mui/icons-material/ViewList';
import Autocomplete from '@mui/material/Autocomplete';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import SimulationCategoryEvaluation from '../common/SimulationCategoryEvaluation';
import {
  ensureEvaluationFlow,
  buildRankedRows,
  buildRankedRowsFromOrderedRoles,
  isEvaluationComplete,
  mergeEvaluationFlowFromResults,
} from '../../utils/simulationRoleRanking';
import SaveChangesButton from '../common/SaveChangesButton';
import SaveChangesDialog from '../common/SaveChangesDialog';
import UnsavedChangesIndicator from '../common/UnsavedChangesIndicator';
import { generateStepId } from '../../utils/stepIdUtils';
import { getMatchScoreFieldsForSave } from '../../utils/careerStepMatchScore';
import { pickUserEvaluationForSave } from '../../utils/savedCareerStepUserEvaluation';
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
  useSavedCareerStepsListQuery,
  setSavedCareerStepsListQueryData,
  invalidateSavedCareerStepsListQuery,
  baseUILanguage,
} from '../../hooks/useProfileQueries';
import { normalizeTextForI18nMatch } from '../../utils/roleTitleDisplay';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import { storeSimulationResultDetails } from '../../utils/simulationResultSessionStore';
import { findMatchingSavedCareerStep } from '../../utils/savedCareerStepIdentity';
import localizedContentService from '../../utils/localizedContentService';
import { 
  saveSimulationToStorage, 
  loadSimulationFromStorage, 
  clearSimulationFromStorage,
  hasSimulationInStorage,
  getSimulationStateFromStorage,
  updateSimulationStateInStorage
} from '../../utils/simulationPersistence';
import useUpdateSimulation from '../../hooks/useUpdateSimulation';
import useChangeDetection from '../../hooks/useChangeDetection';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import ProfileUpdateRecommendation from '../common/ProfileUpdateRecommendation';

/** Simulation UX: `/simulation` is the entry hub; `/simulation/results` loads the latest run when needed. */
const Simulation = () => {
  const { t } = useTranslation(['dashboard', 'common', 'onboarding']);
  const requestLang = baseUILanguage();
  const localizeAiText = useCallback(
    (field) => localizedContentService.getLocalizedWithFallback(field, requestLang, ''),
    [requestLang]
  );
  
  // State for simulation
  const [simLoading, setSimLoading] = useState(false);
  const [simulationJobState, setSimulationJobState] = useState('idle'); // idle | queued | running
  const [simResults, setSimResults] = useState(null);
  const [loadingLast, setLoadingLast] = useState(true);
  const [backendGoal, setBackendGoal] = useState('');
  const [simError, setSimError] = useState('');
  // Career goal autocomplete (server-side search, supports ESCO altLabels)
  const [simulationDate, setSimulationDate] = useState(null);

  const { data: savedSimulations = [] } = useSavedSimulationsListQuery();
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [selectedSimulation, setSelectedSimulation] = useState(null);
  // State for save dialog
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [simulationName, setSimulationName] = useState('');
  const [saving, setSaving] = useState(false);

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
  
  // State for simulation persistence
  const [simulationState, setSimulationState] = useState('clean'); // 'clean' | 'modified' | 'saved'

  // State for save changes functionality
  const [originalSimulationData, setOriginalSimulationData] = useState(null);
  const [saveChangesDialogOpen, setSaveChangesDialogOpen] = useState(false);
  const [savingChanges, setSavingChanges] = useState(false);

  // State for confirmation dialogs
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const [deleteSimulationDialogOpen, setDeleteSimulationDialogOpen] = useState(false);
  const [simulationToDelete, setSimulationToDelete] = useState(null);
  const getNextSimulationName = useCallback(() => {
    const savedCount = Array.isArray(savedSimulations) ? savedSimulations.length : 0;
    return t('simulation.defaultNameWithIndex', { ns: 'dashboard', index: savedCount + 1 });
  }, [savedSimulations, t]);

  const getNextSimulationNameFromServer = useCallback(async () => {
    try {
      const serverSimulations = await queryClient.fetchQuery(
        savedSimulationsListQueryKey,
        fetchSavedSimulationsList,
        { staleTime: 5 * 60 * 1000 }
      );
      const list = Array.isArray(serverSimulations) ? serverSimulations : [];
      return t('simulation.defaultNameWithIndex', { ns: 'dashboard', index: list.length + 1 });
    } catch (error) {
      console.warn('Failed to fetch saved simulation count for default name:', error);
      return getNextSimulationName();
    }
  }, [getNextSimulationName, t]);

  // Hooks for save changes functionality
  const { updateSimulation, loading: updateLoading, error: updateError } = useUpdateSimulation();
  const { hasChanges, resetChanges, getChangeSummary } = useChangeDetection(
    originalSimulationData,
    selectedSimulation
  );

  const persistSimResultsToSession = useCallback(
    (nextResults) => {
      try {
        saveSimulationToStorage(
          {
            results: nextResults,
            careerGoal: backendGoal,
            simulationDate: simulationDate || new Date(),
            profileCompletion,
          },
          'modified'
        );
      } catch (e) {
        console.warn('Session persistence failed:', e);
      }
    },
    [backendGoal, simulationDate, profileCompletion]
  );

  const handleEvaluationCommit = useCallback(
    (categoryKey, stepId, evaluation) => {
      setSimResults((prev) => {
        if (!prev?.evaluationFlow) return prev;
        const flow = prev.evaluationFlow;
        const roles = flow[categoryKey].map((r) =>
          r.id === stepId ? { ...r, userEvaluation: evaluation } : r
        );
        const hasStarted = { ...flow.hasStarted, [categoryKey]: true };
        const nextFlow = { ...flow, [categoryKey]: roles, hasStarted };
        const next = { ...prev, evaluationFlow: nextFlow };
        setTimeout(() => persistSimResultsToSession(next), 0);
        return next;
      });
      setHasUnsavedChanges(true);
      setSimulationState('modified');
    },
    [persistSimResultsToSession]
  );

  const handleSeeRoleRanking = useCallback(
    (categoryKey) => {
      setSimResults((prev) => {
        if (!prev?.evaluationFlow) return prev;
        const flow = prev.evaluationFlow;
        const roles = flow[categoryKey];
        if (!isEvaluationComplete(roles)) return prev;
        const rankSlug = categoryKey === 'nextSteps' ? 'next' : 'out_of_the_box';
        const ranked = buildRankedRows(roles, rankSlug);
        const nextFlow = {
          ...flow,
          phases: { ...flow.phases, [categoryKey]: 'ranked' },
          ranked: { ...flow.ranked, [categoryKey]: ranked },
        };
        const next = { ...prev, evaluationFlow: nextFlow };
        setTimeout(() => persistSimResultsToSession(next), 0);
        return next;
      });
      setHasUnsavedChanges(true);
      setSimulationState('modified');
    },
    [persistSimResultsToSession]
  );

  const handleEditRoleRanking = useCallback(
    (categoryKey) => {
      setSimResults((prev) => {
        if (!prev?.evaluationFlow) return prev;
        const flow = prev.evaluationFlow;
        const nextFlow = {
          ...flow,
          phases: { ...flow.phases, [categoryKey]: 'eval' },
        };
        const next = { ...prev, evaluationFlow: nextFlow };
        setTimeout(() => persistSimResultsToSession(next), 0);
        return next;
      });
      setHasUnsavedChanges(true);
      setSimulationState('modified');
    },
    [persistSimResultsToSession]
  );

  const handleReorderRankedRoles = useCallback(
    (categoryKey, reorderedRows) => {
      setSimResults((prev) => {
        if (!prev?.evaluationFlow || !Array.isArray(reorderedRows) || !reorderedRows.length) return prev;
        const flow = prev.evaluationFlow;
        const currentRoles = Array.isArray(flow[categoryKey]) ? flow[categoryKey] : [];
        const byId = new Map(currentRoles.map((role) => [role.id, role]));
        const nextRoles = reorderedRows
          .map((row) => {
            const existing = byId.get(row.id);
            if (!existing) return null;
            return {
              ...existing,
              userEvaluation: row.userEvaluation,
            };
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
        const next = { ...prev, evaluationFlow: nextFlow };
        setTimeout(() => persistSimResultsToSession(next), 0);
        return next;
      });
      setHasUnsavedChanges(true);
      setSimulationState('modified');
    },
    [persistSimResultsToSession]
  );

  // State to track if save was triggered by navigation guard
  const [saveTriggeredByNavigationGuard, setSaveTriggeredByNavigationGuard] = useState(false);
  
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

  /** Latest results for merging evaluationFlow when re-fetching localized payloads from the server */
  const simResultsRef = useRef(null);
  /** Avoid redundant GET /simulation/last when `{simulationId, lang}` already synced */
  const localizationSyncedRef = useRef({ bundleKey: '' });

  useEffect(() => {
    simResultsRef.current = simResults;
  }, [simResults]);
  const [profileSimulationGate, setProfileSimulationGate] = useState({
    ready: false,
    belowMin: false,
  });

  // Global navigation guard context
  const { registerGuard, unregisterGuard, guardedNavigate } = useNavigationGuardContext();
  
  // Navigation guard for unsaved changes or in-flight simulation loading
  const isSimulationLoadingGuardActive = simLoading;
  const shouldGuardNavigation = simulationState === 'modified' || isSimulationLoadingGuardActive;
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
        showSaveOption: !isSimulationLoadingGuardActive,
        loading: saving || savingChanges,
        onSave: async () => {
          if (isSimulationLoadingGuardActive) return;
          return new Promise((resolve, reject) => {
            // Set flag to track that save was triggered by navigation guard
            setSaveTriggeredByNavigationGuard(true);

            (async () => {
              const nextName = await getNextSimulationNameFromServer();
              setSimulationName(nextName);

              // Store resolve/reject functions globally for the save dialog
              window.navigationGuardSaveResolve = resolve;
              window.navigationGuardSaveReject = reject;

              // Open save dialog
              setSaveDialogOpen(true);
            })();
          });
        },
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
            careerGoal: '',
            simulationDate: null,
            profileCompletion: 0
          };
          saveSimulationToStorage(simulationData, 'saved');
          
          // Clear any unsaved results from session storage
          try {
            sessionStorage.removeItem('currentUnsavedResults');
          } catch (error) {
            console.warn('Failed to clear currentUnsavedResults:', error);
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
    changeSummary,
    saving,
    savingChanges,
    registerGuard,
    unregisterGuard,
    getNextSimulationNameFromServer,
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

  // Load simulation data from session storage on component mount
  useEffect(() => {
    const loadStoredSimulation = () => {
      const storedData = loadSimulationFromStorage();
      
      if (storedData && storedData.results && storedData.state !== 'saved') {
        console.log('📂 Loading simulation from session storage:', {
          state: storedData.state,
          hasResults: !!storedData.results,
          timestamp: storedData.metadata?.timestamp
        });
        
        // Set simulation results
        setSimResults(storedData.results);
        setSimulationState(storedData.state);
        
        // Set metadata if available
        if (storedData.metadata) {
          setBackendGoal(localizeAiText(storedData.metadata.careerGoal || ''));
          setSimulationDate(storedData.metadata.simulationDate || new Date());
          setProfileCompletion(storedData.metadata.profileCompletion || 0);
        }
        
        // Initialize category display counts if available
        if (storedData.results.categoryDisplayCounts) {
          setCategoryDisplayCounts(storedData.results.categoryDisplayCounts);
        }
        
        // Clear loading state
        setLoadingLast(false);
      } else {
        console.log('📭 No stored simulation found or simulation was saved, starting fresh');
        setLoadingLast(false);
      }
    };

    loadStoredSimulation();
  }, []); // Only run on mount

  const { data: savedCareerSteps = [] } = useSavedCareerStepsListQuery();
  const savedCareerStepsRef = useRef([]);
  useEffect(() => {
    savedCareerStepsRef.current = savedCareerSteps;
  }, [savedCareerSteps]);

  // State to track which career steps are being saved/unsaved
  const [savingSteps, setSavingSteps] = useState(new Set());
  const [canonicalEscoByKey, setCanonicalEscoByKey] = useState({});

  const navigate = useNavigate();
  // Note: navigate will be replaced by navigationGuard.navigate below
  const location = useLocation();

  // State update queue to prevent conflicts
  const stateUpdateQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);
  
  // State update lock to prevent re-rendering during updates
  const isUpdatingStateRef = useRef(false);
  
  // Complete render lock to prevent any rendering during state updates
  const isRenderingLockedRef = useRef(false);
  
  // Additional state update tracking
  const pendingStateUpdatesRef = useRef(0);
  const isStateUpdatingRef = useRef(false);

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
          if (!cancelled) setProfileSimulationGate({ ready: true, belowMin: false });
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
        if (!cancelled) setProfileSimulationGate({ ready: true, belowMin: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Safe setter function that ensures arrays are never undefined
  const safeSetSimResults = (newResults) => {
    if (!newResults) {
      setSimResults(null);
      return;
    }

    // Set update lock to prevent re-rendering
    isUpdatingStateRef.current = true;

    const sanitizedResults = sanitizeSimulationResultsPayload(newResults);
    if (!sanitizedResults) {
      isUpdatingStateRef.current = false;
      return;
    }

    // Store current results in sessionStorage for replacement tracking
    try {
      sessionStorage.setItem('currentSimResults', JSON.stringify(sanitizedResults));
    } catch (error) {
      console.warn('Failed to store current results in sessionStorage:', error);
    }
    
    // Queue the state update to prevent conflicts
    queueStateUpdate(() => {
      setSimResults(sanitizedResults);
      
      // Release lock after state update
      setTimeout(() => {
        isUpdatingStateRef.current = false;
      }, 100);
    });
    
    // Fallback: ensure lock is released even if queue fails
    setTimeout(() => {
      if (isUpdatingStateRef.current) {
        isUpdatingStateRef.current = false;
      }
    }, 500);
  };
  
  // Queue state updates to prevent conflicts
  const queueStateUpdate = (updateFunction) => {
    stateUpdateQueueRef.current.push(updateFunction);
    
    if (!isProcessingQueueRef.current) {
      processStateUpdateQueue();
    }
  };
  
  // Process the state update queue
  const processStateUpdateQueue = () => {
    if (isProcessingQueueRef.current || stateUpdateQueueRef.current.length === 0) {
      return;
    }
    
    isProcessingQueueRef.current = true;
    
    // Process updates one by one with delays
    const processNext = () => {
      if (stateUpdateQueueRef.current.length === 0) {
        isProcessingQueueRef.current = false;
        return;
      }
      
      const updateFunction = stateUpdateQueueRef.current.shift();
      
      try {
        updateFunction();
      } catch (error) {
        console.error('Error processing state update:', error);
      }
      
      // Process next update after a short delay
      setTimeout(processNext, 10);
    };
    
    processNext();
  };

  useEffect(() => {
    // Handle navigation state changes
    if (location.state) {
      if (location.state.simulationId) {
        // Load a specific saved simulation
        fetchSimulationById(location.state.simulationId);
      } else if (location.state.showUnsavedResults) {
        // Return from unsaved simulation details - restore unsaved results
        setSelectedSimulation(null);
        setIsViewingSavedSimulation(false);

        // Check if simulation was saved - if so, don't restore unsaved results
        const storedData = loadSimulationFromStorage();
        if (storedData && storedData.state === 'saved') {
          console.log('Simulation was saved, not restoring unsaved results');
          invalidateSavedCareerStepsListQuery();
          guardedNavigate(location.pathname, { replace: true });
          return;
        }

        // Restore the unsaved simulation results from sessionStorage
        const storedUnsavedResults = sessionStorage.getItem('currentUnsavedResults');
        if (storedUnsavedResults) {
          try {
            const parsedResults = JSON.parse(storedUnsavedResults);
            setSimResults(parsedResults.results);
            setBackendGoal(localizeAiText(parsedResults.selectedGoal || ''));
            setSimulationDate(parsedResults.date);
            setHasUnsavedChanges(true);
          } catch (err) {
            console.error('Error parsing stored unsaved results:', err);
            fetchLastSimulation();
          }
        } else {
          fetchLastSimulation();
        }

        invalidateSavedCareerStepsListQuery();
        guardedNavigate(location.pathname, { replace: true });
        return;
      } else if (location.state.refresh) {
        invalidateSavedCareerStepsListQuery();
        guardedNavigate(location.pathname, { replace: true });
        return;
      }
    }

    // Default behavior: load last simulation if no special navigation state
    if (!location.state || (!location.state.simulationId && !location.state.showUnsavedResults && !location.state.refresh)) {
      const storedData = loadSimulationFromStorage();
      console.log('Navigation check - session storage state:', {
        storedData,
        locationState: location.state,
        currentUnsavedResults: sessionStorage.getItem('currentUnsavedResults')
      });

      if (storedData && storedData.state === 'saved') {
        if (location.pathname === '/simulation/results') {
          fetchLastSimulation();
        } else {
          console.log('Simulation was saved, not fetching last simulation to prevent restoration', {
            state: storedData.state,
            hasResults: !!storedData.results,
            timestamp: storedData.metadata?.timestamp
          });
        }
      } else if (!storedData) {
        if (location.pathname === '/simulation/results') {
          fetchLastSimulation();
        } else {
          console.log('No session storage data found (likely cleared after save), keeping page cleared');
        }
      } else if (storedData.results && storedData.state !== 'saved') {
        // Session already holds the current run (e.g. clean/modified after POST /simulation). Do not
        // overwrite with GET /simulation/last — that races with mount load and can drop evaluationFlow.
        console.log('Session has simulation results; skipping fetchLastSimulation on mount');
      } else {
        console.log('Fetching last simulation from server');
        fetchLastSimulation();
      }
    }

    invalidateSavedCareerStepsListQuery();
    // eslint-disable-next-line
  }, [location.state, location.pathname]);

  // Refresh saved career steps when the page becomes visible (e.g., when returning from details page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        invalidateSavedCareerStepsListQuery();
      }
    };

    const handleFocus = () => {
      invalidateSavedCareerStepsListQuery();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Ensure simResults arrays are always properly initialized
  useEffect(() => {
    if (isProcessingQueueRef.current || isUpdatingStateRef.current) {
      return;
    }
    
    if (simResults) {
      const sanitizedResults = {
        ...simResults,
        nextSteps: Array.isArray(simResults.nextSteps) ? [...simResults.nextSteps] : [],
        outsideTheBox: Array.isArray(simResults.outsideTheBox) ? [...simResults.outsideTheBox] : [],
        outsideComfortZone: Array.isArray(simResults.outsideComfortZone) ? [...simResults.outsideComfortZone] : [],
        furtherAdvice: Array.isArray(simResults.furtherAdvice) ? [...simResults.furtherAdvice] : [],
        resources: Array.isArray(simResults.resources) ? [...simResults.resources] : []
      };
      
      // Additional validation - ensure all arrays have valid items
      sanitizedResults.nextSteps = sanitizedResults.nextSteps.filter(item => item && typeof item === 'object');
      sanitizedResults.outsideTheBox = sanitizedResults.outsideTheBox.filter(item => item && typeof item === 'object');
      sanitizedResults.outsideComfortZone = sanitizedResults.outsideComfortZone.filter(item => item && typeof item === 'object');
      sanitizedResults.furtherAdvice = sanitizedResults.furtherAdvice.filter(item => item && typeof item === 'object');
      sanitizedResults.resources = sanitizedResults.resources.filter(item => item && typeof item === 'object');
      
      // Only update if there's a meaningful difference to avoid infinite loops
      const currentString = JSON.stringify(simResults);
      const sanitizedString = JSON.stringify(sanitizedResults);
      
      if (currentString !== sanitizedString) {
        queueStateUpdate(() => setSimResults(sanitizedResults));
      }
    }
  }, [simResults]);

  useEffect(() => {
    if (!simResults) return;
    const resultsKey = simResults.simulationId ?? 'local';
    if (
      simResults.evaluationFlow &&
      simResults.evaluationFlow.simulationId === resultsKey
    ) {
      return;
    }
    queueStateUpdate(() => {
      setSimResults((prev) => {
        if (!prev) return prev;
        const key = prev.simulationId ?? 'local';
        if (prev.evaluationFlow && prev.evaluationFlow.simulationId === key) {
          return prev;
        }
        const evaluationFlow = ensureEvaluationFlow(prev);
        if (!evaluationFlow) return prev;
        return { ...prev, evaluationFlow };
      });
    });
  }, [simResults]);

  // Fetch last simulation result on mount
  const fetchLastSimulation = async (options = {}) => {
    const { forceLocalizationRefresh = false } = options;
    // Clear used replacements when starting fresh
    try {
      sessionStorage.removeItem('usedReplacements');
    } catch (error) {
      console.warn('Failed to clear used replacements:', error);
    }
    
    // Check if we have unsaved results that should be preserved
    const storedUnsavedResults = sessionStorage.getItem('currentUnsavedResults');
    // Plain strings in sessionStorage cannot change locale — bypass when syncing language so GET ?lang= runs.
    if (storedUnsavedResults && !isViewingSavedSimulation && !forceLocalizationRefresh) {
      try {
        const parsedResults = JSON.parse(storedUnsavedResults);
        safeSetSimResults(parsedResults.results);
        setBackendGoal(localizeAiText(parsedResults.selectedGoal || ''));
        setSimulationDate(parsedResults.date);
        setHasUnsavedChanges(true);
        setLoadingLast(false);
        return; // Don't fetch from server if we have unsaved results
      } catch (err) {
        console.error('Error parsing stored unsaved results:', err);
        // Continue with normal fetch if parsing fails
      }
    }
    
    const onResultsRoute = location.pathname === '/simulation/results';
    const storedData = loadSimulationFromStorage();
    console.log('fetchLastSimulation - session storage check:', {
      storedData,
      state: storedData?.state,
      hasResults: !!storedData?.results,
      onResultsRoute,
      forceLocalizationRefresh
    });

    if (!forceLocalizationRefresh && storedData?.results && storedData.state !== 'saved') {
      console.log('Active session simulation; skip server fetch in fetchLastSimulation');
      setLoadingLast(false);
      return;
    }

    if (storedData && storedData.state === 'saved' && !onResultsRoute) {
      console.log('Simulation was saved, not fetching from server');
      setLoadingLast(false);
      return;
    }

    if (!storedData && !onResultsRoute) {
      console.log('No session storage data; skip server fetch off results route');
      setLoadingLast(false);
      return;
    }

        setLoadingLast(true);
    try {
      const res = await fetch(`/api/profile/simulation/last?lang=${encodeURIComponent(requestLang)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await res.json();
      if (data && data.results) {
        const sanitized = sanitizeSimulationResultsPayload(data.results);
        if (sanitized) {
          const flow = mergeEvaluationFlowFromResults(sanitized, simResultsRef.current?.evaluationFlow);
          const merged = flow ? { ...sanitized, evaluationFlow: flow } : sanitized;
          safeSetSimResults(merged);
          const goalDisplay = localizeAiText(data.selectedGoal || '');
          setBackendGoal(goalDisplay);
          setSimulationDate(data.date); // Store the simulation date
          setHasUnsavedChanges(false);
          setIsViewingSavedSimulation(false); // Last simulation is not from saved simulations
          if (data.results.simulationId) {
            localizationSyncedRef.current.bundleKey = `${data.results.simulationId}:${requestLang}`;
          }
          try {
            saveSimulationToStorage(
              {
                results: merged,
                careerGoal: goalDisplay,
                simulationDate: data.date ? new Date(data.date) : new Date(),
                profileCompletion,
              },
              simulationState
            );
          } catch (e) {
            console.warn('Failed to persist localized simulation to session storage:', e);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching last simulation:', err);
    } finally {
      setLoadingLast(false);
    }
  };

  const fetchSimulationById = async (simulationId) => {
    setLoadingLast(true);
    try {
      const res = await fetch(`/api/profile/simulation/saved/${simulationId}?lang=${encodeURIComponent(requestLang)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await res.json();
      if (data.success) {
        safeSetSimResults(data.simulation.results);
        setBackendGoal(localizeAiText(data.simulation.careerGoal || ''));
        setSelectedSimulation(data.simulation);
        setSimulationDate(data.simulation.timestamp); // Store the simulation timestamp
        setHasUnsavedChanges(false);
        setIsViewingSavedSimulation(true); // This is a saved simulation
        localizationSyncedRef.current.bundleKey = `saved:${simulationId}:${requestLang}`;

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
    const hasUnsavedLocalResults = Boolean(simResults) && !isViewingSavedSimulation;
    if (hasUnsavedChanges || hasUnsavedLocalResults) {
      setUnsavedChangesDialogOpen(true);
    } else {
      handleSimulate();
    }
  };

  const handleConfirmUnsavedChanges = () => {
    setSimResults(null);
    setHasUnsavedChanges(false);
    setSimulationState('clean');
    setIsViewingSavedSimulation(false);
    setSelectedSimulation(null);
    localizationSyncedRef.current.bundleKey = '';
    clearSimulationFromStorage();
    setUnsavedChangesDialogOpen(false);
    handleSimulate();
  };

  const handleCancelUnsavedChanges = () => {
    setUnsavedChangesDialogOpen(false);
  };

  const handleSimulate = async () => {
    if (profileSimulationGate.ready && profileSimulationGate.belowMin) {
      setSimError(
        t('simulation.messages.profileCompletionRequired', {
          ns: 'dashboard',
          min: MIN_PROFILE_COMPLETION_REQUIRED,
        })
      );
      return;
    }

    setSimLoading(true);
    setSimulationJobState('queued');
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
        return;
      }

      const token = localStorage.getItem('token');
      const jobId = startData.jobId;
      const pollDeadlineMs = Date.now() + (10 * 60 * 1000);
      let data = null;

      while (Date.now() < pollDeadlineMs) {
        const pollTs = Date.now();
        const statusRes = await fetch(
          `/api/profile/simulation/jobs/${encodeURIComponent(jobId)}/status?lang=${encodeURIComponent(requestLang)}&_ts=${pollTs}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        );
        const statusData = await statusRes.json();
        if (!statusRes.ok) {
          setSimError(
            statusData?.message ||
            statusData?.error ||
            t('simulation.messages.failedTryAgain', { ns: 'dashboard' })
          );
          return;
        }

        const jobStatus = statusData?.job?.status;
        if (jobStatus === 'queued' || jobStatus === 'pending') {
          setSimulationJobState('queued');
        } else if (jobStatus === 'running') {
          setSimulationJobState('running');
        }
        if (jobStatus === 'completed') {
          const resultRes = await fetch(
            `/api/profile/simulation/jobs/${encodeURIComponent(jobId)}/result?lang=${encodeURIComponent(requestLang)}&_ts=${Date.now()}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            }
          );
          data = await resultRes.json();
          if (!resultRes.ok) {
            setSimError(
              data?.message ||
              data?.error ||
              t('simulation.messages.failedTryAgain', { ns: 'dashboard' })
            );
            return;
          }
          break;
        }

        if (jobStatus === 'failed') {
          setSimError(
            statusData?.job?.error ||
            t('simulation.messages.failedTryAgain', { ns: 'dashboard' })
          );
          return;
        }

        // Keep polling while pending/running.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (!data) {
        setSimError(t('simulation.messages.failedTryAgain', { ns: 'dashboard' }));
        return;
      }

      if (data && data.results) {
        invalidateLastSimulationQuery();
        const careerGoalFromProfile = localizeAiText(data.careerGoal || '');
        setSimResults(data.results);
        setBackendGoal(careerGoalFromProfile);
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
          careerGoal: careerGoalFromProfile,
          simulationDate: new Date(),
          profileCompletion: data.profileCompletion || 0
        };
        
        const saveSuccess = saveSimulationToStorage(simulationData, 'clean');
        if (!saveSuccess) {
          console.warn('⚠️ Failed to save simulation to session storage - persistence disabled');
        }

        if (data.results.simulationId) {
          localizationSyncedRef.current.bundleKey = `${data.results.simulationId}:${requestLang}`;
        }

        // Show generated results on dedicated results screen.
        navigate('/simulation/results');
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
      }
    } catch (err) {
      setSimError(t('simulation.messages.failedCheckConnection', { ns: 'dashboard' }));
    } finally {
      setSimulationJobState('idle');
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
      fetchSimulationById(selectedSimulation.id);
      return;
    }

    const sid = simResults.simulationId;
    if (!sid) return;
    const bundleKey = `${sid}:${requestLang}`;
    if (localizationSyncedRef.current.bundleKey === bundleKey) return;

    fetchLastSimulation({ forceLocalizationRefresh: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestLang, simResults?.simulationId, simulationState, isViewingSavedSimulation, selectedSimulation?.id]);

  const handleSaveDialogClose = () => {
    setSaveDialogOpen(false);
    setSaveTriggeredByNavigationGuard(false);
    
    // Reject navigation guard promise if user cancels save dialog
    if (window.navigationGuardSaveReject) {
      window.navigationGuardSaveReject(
        new Error(t('simulation.messages.saveCancelledByUser', { ns: 'dashboard' }))
      );
      window.navigationGuardSaveResolve = null;
      window.navigationGuardSaveReject = null;
    }
  };

  const handleSaveSimulation = async () => {
    if (!simResults) return;

    const nextName = await getNextSimulationNameFromServer();
    setSimulationName(nextName);
    setSaveDialogOpen(true);
  };

  const handleSaveConfirm = async () => {
    if (!simulationName.trim()) return;
    const resultsPayload = simResultsRef.current;
    if (!resultsPayload) return;

    setSaving(true);
    try {
      const res = await fetch('/api/profile/simulation/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          name: simulationName,
          results: resultsPayload,
          careerGoal: backendGoal,
          profileCompletion: 100
        })
      });
      
      const data = await res.json();
      if (data.success) {
        invalidateLastSimulationQuery();
        setHasUnsavedChanges(false);
        setSimulationState('saved');
        setSaveDialogOpen(false);
        setSaveTriggeredByNavigationGuard(false);
        
        // Clear simulation results after saving (simulation "moved" to saved list)
        setSimResults(null);
        setBackendGoal('');
        setSimulationDate(null);
        setSelectedSimulation(null);
        setIsViewingSavedSimulation(false);
        
        // Clear ALL session storage to prevent any restoration
        try {
          clearSimulationFromStorage();
          sessionStorage.removeItem('currentUnsavedResults');
          console.log('🗑️ Cleared all session storage after saving');
        } catch (error) {
          console.warn('Failed to clear session storage:', error);
        }
        
        // Additional debugging to verify session storage state
        console.log('💾 After saving - session storage state:', {
          storedData: loadSimulationFromStorage(),
          currentUnsavedResults: sessionStorage.getItem('currentUnsavedResults')
        });
        
        invalidateSavedSimulationsListQuery();
        const savedSimulationId =
          data.savedSimulation?.id ||
          (typeof data.savedSimulation?._id === 'string' ? data.savedSimulation._id : data.savedSimulation?._id?.toString?.());

        const postSaveSnackbar = {
          message: t('simulation.messages.savedSuccessfully', { ns: 'dashboard' }),
          severity: 'success',
          ...(savedSimulationId
            ? {
                linkTo: `/simulation/${savedSimulationId}`,
                linkLabel: t('simulation.actions.openSavedSimulation', { ns: 'dashboard' }),
              }
            : {}),
        };

        // Resolve navigation guard promise if save was triggered by navigation guard
        if (saveTriggeredByNavigationGuard && window.navigationGuardSaveResolve) {
          window.navigationGuardSaveResolve();
          window.navigationGuardSaveResolve = null;
          window.navigationGuardSaveReject = null;
        }

        // Use navigate (not guardedNavigate): guard still reads stale registration until the next
        // render after setSimulationState('saved'), which would block leaving /simulation/results.
        if (!saveTriggeredByNavigationGuard) {
          navigate('/simulation', { replace: true, state: { postSaveSnackbar } });
        } else {
          showSnackbar(postSaveSnackbar.message, postSaveSnackbar.severity, {
            linkTo: postSaveSnackbar.linkTo ?? null,
            linkLabel: postSaveSnackbar.linkLabel ?? null,
          });
        }
      } else {
        showSnackbar(data.message || t('simulation.messages.saveFailed', { ns: 'dashboard' }), 'error');
        
        // Reject navigation guard promise if save failed
        if (saveTriggeredByNavigationGuard && window.navigationGuardSaveReject) {
          window.navigationGuardSaveReject(
            new Error(data.message || t('simulation.messages.saveFailed', { ns: 'dashboard' }))
          );
          window.navigationGuardSaveResolve = null;
          window.navigationGuardSaveReject = null;
        }
      }
    } catch (err) {
      showSnackbar(t('simulation.messages.saveFailed', { ns: 'dashboard' }), 'error');
      
      // Reject navigation guard promise if save failed
      if (saveTriggeredByNavigationGuard && window.navigationGuardSaveReject) {
        window.navigationGuardSaveReject(err);
        window.navigationGuardSaveResolve = null;
        window.navigationGuardSaveReject = null;
      }
    } finally {
      setSaving(false);
    }
  };

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
        setBackendGoal(localizeAiText(data.simulation.careerGoal));
        setSelectedSimulation(data.simulation);
        setSimulationDate(data.simulation.timestamp); // Store the simulation timestamp
        setHasUnsavedChanges(false);
        setSimulationState('saved'); // Loaded simulation is in saved state
        setIsViewingSavedSimulation(true); // This is a saved simulation
        setHistoryDrawerOpen(false);
        
        // Mark session storage as 'saved' since we're loading a saved simulation
        const simulationData = {
          results: null,
          careerGoal: '',
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
        
        localizationSyncedRef.current.bundleKey = `saved:${simulationId}:${requestLang}`;

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
    guardedNavigate('/profile/fill?mode=full-update');
  };

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
    
    
    // Store the current simulation ID if we're viewing a saved simulation
    if (currentResultsAreFromSavedSimulation) {
      sessionStorage.setItem('currentSimulationId', selectedSimulation.id);
      sessionStorage.removeItem('currentUnsavedResults');
    } else {
      sessionStorage.removeItem('currentSimulationId');
      // Store the current unsaved simulation results
      sessionStorage.setItem('currentUnsavedResults', JSON.stringify({
        results: simResults,
        selectedGoal: backendGoal,
        date: simulationDate
      }));
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
    const rolesToWarm = [];
    const flow = simResults?.evaluationFlow;
    if (flow?.nextSteps?.length) rolesToWarm.push(...flow.nextSteps);
    if (flow?.outsideTheBox?.length) rolesToWarm.push(...flow.outsideTheBox);
    if (!rolesToWarm.length) return;
    rolesToWarm.forEach((role) => {
      void resolveCanonicalEscoId(role);
    });
  }, [simResults, resolveCanonicalEscoId]);

  const findMatchingSavedStep = (role, savedSteps) => {
    return findMatchingSavedCareerStep(role, savedSteps);
  };

  const findMatchingSavedStepWithCanonical = (role, savedSteps) => {
    const byDefault = findMatchingSavedStep(role, savedSteps);
    if (byDefault) return byDefault;
    const roleEsco = resolveCanonicalEscoIdFromCache(role);
    if (!roleEsco) return null;
    return (
      savedSteps.find((step) => {
        const stepEsco = resolveCanonicalEscoIdFromCache(step);
        return !!stepEsco && stepEsco === roleEsco;
      }) || null
    );
  };

  const isStepSaved = (role) => {
    const currentSavedSteps = savedCareerStepsRef.current;
    if (!Array.isArray(currentSavedSteps) || currentSavedSteps.length === 0) return false;

    const byDefault = findMatchingSavedStep(role, currentSavedSteps);
    if (byDefault) return true;

    const roleEsco = resolveCanonicalEscoIdFromCache(role);
    if (roleEsco && savedCanonicalEscoIds.has(roleEsco)) return true;

    return false;
  };

  // Helper function to check if a specific step is being saved/unsaved
  const isStepSaving = (role) => {
    const stepId = role.instanceId || generateStepId(
      role.title, 
      selectedSimulation?.id || 'local', 
      'nextSteps', 
      0
    );
    return savingSteps.has(stepId);
  };

  const handleToggleSaveStep = async (role, simulationResultId) => {
    
    // Use the instanceId if available, otherwise generate a consistent stepId
    const stepId = role.instanceId || generateStepId(
      role.title, 
      selectedSimulation?.id || 'local', 
      'nextSteps', 
      0
    );
    
    // Set loading state for this specific step
    setSavingSteps(prev => new Set(prev).add(stepId));
    
    try {
      if (isStepSaved(role)) {
        // Remove - find the saved step to get its stepId
        const currentSavedSteps = savedCareerStepsRef.current;
        if (!currentSavedSteps || !Array.isArray(currentSavedSteps)) {
          showSnackbar(t('simulation.messages.noSavedCareerSteps', { ns: 'dashboard' }), 'error');
          return;
        }
        const savedStep = findMatchingSavedStepWithCanonical(role, currentSavedSteps);
        
        if (!savedStep) {
          console.error('❌ Could not find saved step to delete:', {
            role: {
              title: role.title,
              description: role.description,
              instanceId: role.instanceId,
              stepId: role.stepId
            },
            simulationId: simulationResultId || (selectedSimulation && selectedSimulation.id),
            availableSteps: currentSavedSteps.map(step => ({
              stepId: step.stepId,
              title: step.title,
              simulationResultId: step.simulationResultId
            }))
          });
          showSnackbar(t('simulation.messages.careerStepNotFound', { ns: 'dashboard' }), 'error');
          return {
            success: false,
            action: 'error',
            error: t('simulation.messages.careerStepNotFound', { ns: 'dashboard' }),
          };
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
          const updatedSteps = data.savedCareerSteps || [];
          setSavedCareerStepsListQueryData(updatedSteps);
          savedCareerStepsRef.current = updatedSteps;
          showSnackbar(t('simulation.messages.careerStepRemoved', { ns: 'dashboard' }), 'info');
          return { success: true, action: 'unsaved' };
        } else {
          showSnackbar(data.message || t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }), 'error');
          return {
            success: false,
            action: 'error',
            error: data.message || t('simulation.messages.careerStepRemoveFailed', { ns: 'dashboard' }),
          };
        }
      } else {
        // Save - use the instanceId as stepId for consistency
        const saveData = {
          stepId: stepId,
          title: role.title,
          description: role.description,
          escoId: role.escoId || null,
          simulationResultId: simulationResultId || (selectedSimulation && selectedSimulation.id),
          category: role.category || 'nextSteps',
          industry: role.industry || 'Career Development',
          savedAt: new Date().toISOString(),
          requiredSkills: role.requiredSkills || [],
          altTitles: role.altTitles || [],
          hiddenTitles: role.hiddenTitles || [],
          seniority: role.seniority || null,
          keyResponsibilities: role.keyResponsibilities || null,
          skillDomains: role.skillDomains || null,
          skillModel: role.skillModel || null,
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
              return {
                success: false,
                action: 'duplicate',
                message: duplicateData.message || t('simulation.messages.alreadySaved', { ns: 'dashboard' }),
              };
            } catch {
              return {
                success: false,
                action: 'duplicate',
                message: t('simulation.messages.alreadySaved', { ns: 'dashboard' }),
              };
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
          return { success: true, action: 'saved' };
        } else if (data.message === 'Career step already saved' || res.status === 409) {
          // Handle duplicate detection response
          if (data.duplicateType === 'semantic' && data.similarity < 1.0) {
            showSnackbar(
              `${data.message} ${t('simulation.messages.similaritySuffix', {
                ns: 'dashboard',
                percent: Math.round(data.similarity * 100),
              })}`,
              'warning'
            );
          } else {
            showSnackbar(data.message || t('simulation.messages.alreadySaved', { ns: 'dashboard' }), 'info');
          }
          return {
            success: false,
            action: 'duplicate',
            message: data.message || t('simulation.messages.alreadySaved', { ns: 'dashboard' }),
          };
        } else {
          console.error('❌ Save failed with data:', data);
          showSnackbar(data.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }), 'error');
          return {
            success: false,
            action: 'error',
            error: data.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' }),
          };
        }
      }
    } catch (err) {
      console.error('Error in handleToggleSaveStep:', err);
      const errorMessage = err.message || t('simulation.messages.careerStepSaveFailed', { ns: 'dashboard' });
      showSnackbar(errorMessage, 'error');
      return { success: false, action: 'error', error: errorMessage };
    } finally {
      // Clear loading state for this specific step
      setSavingSteps(prev => {
        const newSet = new Set(prev);
        newSet.delete(stepId);
        return newSet;
      });
    }
  };

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
          
          return (
            <>
              <Typography
                variant="h4"
                sx={{
                  mb: 3,
                  fontWeight: 700,
                  textAlign: 'center',
                  typography: { xs: 'h5', sm: 'h4' },
                  px: { xs: 1, sm: 0 },
                  wordBreak: 'break-word',
                }}
              >
                {location.pathname === '/simulation/results'
                  ? t('simulation.resultsTitle', { ns: 'dashboard' })
                  : t('simulation.pageTitle', { ns: 'dashboard' })}
              </Typography>
              <Typography variant="body1" sx={{ mb: 4, textAlign: 'center', px: { xs: 1, sm: 0 } }}>
                {simResults
                  ? t('simulation.subtitle.hasResults', { ns: 'dashboard' })
                  : t('simulation.subtitle.empty', { ns: 'dashboard' })}
              </Typography>

              {profileSimulationGate.ready && profileSimulationGate.belowMin && (
                <Alert
                  severity="warning"
                  variant="outlined"
                  sx={{
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

              {simResults && (
                <Alert severity="info" sx={{ mb: 3, maxWidth: 860, mx: 'auto' }}>
                  {t('simulation.info.updateProfileHint', { ns: 'dashboard' })}
                </Alert>
              )}

              {/* Action Buttons */}
              {!(loadingLast || simLoading) && (
                <Box
                  sx={{
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
                {!simResults &&
                  !simLoading &&
                  !(profileSimulationGate.ready && profileSimulationGate.belowMin) && (
                  <Tooltip title={t('simulation.tooltips.savedSimulations', { ns: 'dashboard' })} arrow>
                    <span>
                      <Button
                        aria-label={t('simulation.aria.savedSimulations', { ns: 'dashboard' })}
                        variant="outlined"
                        color="primary"
                        size="medium"
                        startIcon={<ViewListIcon />}
                        onClick={() => guardedNavigate('/simulations')}
                        sx={{
                          fontWeight: 600,
                          px: 3,
                          py: 1.5,
                          fontSize: '1rem',
                        }}
                      >
                        {t('saved.simulations', { ns: 'dashboard' })}
                      </Button>
                    </span>
                  </Tooltip>
                )}
                {simResults && !isViewingSavedSimulation && (
                  <Tooltip title={t('simulation.tooltips.saveResults', { ns: 'dashboard' })} arrow>
                    <span>
                      <Button
                        aria-label={t('simulation.aria.saveResults', { ns: 'dashboard' })}
                        variant="contained"
                        color="primary"
                        size="medium"
                        startIcon={<SaveIcon />}
                        onClick={handleSaveSimulation}
                        sx={{
                          fontWeight: 600,
                          px: 3,
                          py: 1.5,
                          fontSize: '1rem',
                        }}
                        disabled={saving}
                      >
                        {t('simulation.actions.saveResults', { ns: 'dashboard' })}
                      </Button>
                    </span>
                  </Tooltip>
                )}
                {simResults && (
                  <Tooltip title={t('simulation.tooltips.clearAndRestart', { ns: 'dashboard' })} arrow>
                    <span>
                      <Button
                        aria-label={t('simulation.aria.clearAndRestart', { ns: 'dashboard' })}
                        variant="outlined"
                        color="primary"
                        size="medium"
                        startIcon={<ArrowForwardIcon />}
                        onClick={handleStartSimulation}
                        sx={{
                          fontWeight: 600,
                          px: 3,
                          py: 1.5,
                          fontSize: '1rem',
                        }}
                      >
                        {t('simulation.actions.clearAndRestart', { ns: 'dashboard' })}
                      </Button>
                    </span>
                  </Tooltip>
                )}
                {!(profileSimulationGate.ready && profileSimulationGate.belowMin) && (
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

              {/* Save Dialog */}
              <Dialog open={saveDialogOpen} onClose={handleSaveDialogClose}>
                <DialogTitle>{t('simulation.saveDialog.title', { ns: 'dashboard' })}</DialogTitle>
                <DialogContent>
                  <TextField
                    autoFocus
                    margin="dense"
                    label={t('simulation.saveDialog.nameLabel', { ns: 'dashboard' })}
                    fullWidth
                    variant="outlined"
                    value={simulationName}
                    onChange={(e) => setSimulationName(e.target.value)}
                    sx={{ mb: 1 }}
                  />
                </DialogContent>
                <DialogActions>
                  <Button onClick={handleSaveDialogClose}>{t('profilePage.actions.cancel', { ns: 'onboarding' })}</Button>
                  <Button 
                    onClick={handleSaveConfirm} 
                    variant="contained" 
                    color="primary"
                    disabled={!simulationName.trim() || saving}
                  >
                    {saving ? <CircularProgress size={20} /> : t('profilePage.actions.save', { ns: 'onboarding' })}
                  </Button>
                </DialogActions>
              </Dialog>

              {/* Unsaved Changes Confirmation Dialog */}
              <Dialog
                open={unsavedChangesDialogOpen}
                onClose={handleCancelUnsavedChanges}
                aria-labelledby="unsaved-changes-dialog-title"
                aria-describedby="unsaved-changes-dialog-description"
              >
                <DialogTitle id="unsaved-changes-dialog-title">
                  {t('simulation.unsavedDialog.title', { ns: 'dashboard' })}
                </DialogTitle>
                <DialogContent>
                  <DialogContentText id="unsaved-changes-dialog-description">
                    {t('simulation.unsavedDialog.description', { ns: 'dashboard' })}
                  </DialogContentText>
                  <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 'bold' }}>
                    {t('simulation.unsavedDialog.warning', { ns: 'dashboard' })}
                  </Typography>
                </DialogContent>
                <DialogActions>
                  <Button 
                    onClick={handleCancelUnsavedChanges}
                    variant="outlined"
                    color="primary"
                    autoFocus
                  >
                    {t('profilePage.actions.cancel', { ns: 'onboarding' })}
                  </Button>
                  <Button 
                    onClick={handleConfirmUnsavedChanges}
                    variant="contained"
                    color="error"
                  >
                    {t('simulation.actions.startNew', { ns: 'dashboard' })}
                  </Button>
                </DialogActions>
              </Dialog>

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
              {loadingLast || simLoading ? (
                <Box sx={{ textAlign: 'center', mt: 6 }}>
                  <CircularProgress size={30} />
                  {simLoading && (
                    <Box sx={{ maxWidth: 440, mx: 'auto', mt: 2 }}>
                      <LinearProgress
                        variant="indeterminate"
                        sx={{
                          height: 6,
                          borderRadius: 999,
                          mb: 1.25,
                        }}
                      />
                    </Box>
                  )}
                  {simLoading && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                      {simulationJobState === 'queued'
                        ? t('simulation.loadingQueued', { ns: 'dashboard' })
                        : simulationJobState === 'running'
                          ? t('simulation.loadingRunning', { ns: 'dashboard' })
                          : t('simulation.loadingUpdating', { ns: 'dashboard' })}
                    </Typography>
                  )}
                </Box>
              ) : simResults && (
                <Box sx={{ mt: 6 }}>
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
                  {!selectedSimulation && (
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
                  
                  {backendGoal && (
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        mb: 4,
                        px: { xs: 1, sm: 0 },
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    >
                      <Card
                        sx={{
                          backgroundColor: 'var(--color-surface-info)',
                          borderLeft: '6px solid var(--color-primary)',
                          minWidth: 0,
                          maxWidth: '100%',
                          width: { xs: '100%', sm: 'auto' },
                        }}
                      >
                        <CardContent>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'primary.main' }}>
                            {t('simulation.sloganTitle', { ns: 'dashboard' })}
                          </Typography>
                          <Typography variant="h6" sx={{ fontWeight: 700 }}>{backendGoal}</Typography>
                        </CardContent>
                      </Card>
                    </Box>
                  )}

                  {!safeSimResults.evaluationFlow ? (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                      <CircularProgress size={32} />
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        {t('simulation.preparingRoleEvaluation', { ns: 'dashboard' })}
                      </Typography>
                    </Box>
                  ) : (
                    <>
                      <ProfileUpdateRecommendation
                        category="nextSteps"
                        profileCompletion={profileCompletion}
                        onUpdateProfile={handleUpdateProfile}
                        onDismiss={handleDismissRecommendation}
                        isVisible={showProfileRecommendation && recommendationCategory === 'nextSteps'}
                      />
                      <SimulationCategoryEvaluation
                        title={t('simulation.categories.nextRoles', { ns: 'dashboard' })}
                        categoryKey="nextSteps"
                        roles={safeSimResults.evaluationFlow.nextSteps}
                        phase={safeSimResults.evaluationFlow.phases?.nextSteps || 'eval'}
                        rankedRows={safeSimResults.evaluationFlow.ranked?.nextSteps}
                        hasStarted={!!safeSimResults.evaluationFlow.hasStarted?.nextSteps}
                        onEvaluate={(stepId, evaluation) =>
                          handleEvaluationCommit('nextSteps', stepId, evaluation)
                        }
                        onSeeRanking={() => handleSeeRoleRanking('nextSteps')}
                        onEditRatings={() => handleEditRoleRanking('nextSteps')}
                        onReorderRankedRoles={(rows) => handleReorderRankedRoles('nextSteps', rows)}
                        isStepSaved={(role) => isStepSaved(role)}
                        isStepSaving={(role) => isStepSaving(role)}
                        onToggleSave={(role) => handleToggleSaveStep(role, selectedSimulation?.id)}
                        guardedNavigate={guardedNavigate}
                        isViewingSavedSimulation={isViewingSavedSimulation}
                        savedSimulationId={selectedSimulation?.id}
                        simulationIdForCards={
                          selectedSimulation?.id || safeSimResults?.simulationId || 'local'
                        }
                      />
                      <Divider sx={{ my: 4 }} />
                      <ProfileUpdateRecommendation
                        category="outsideTheBox"
                        profileCompletion={profileCompletion}
                        onUpdateProfile={handleUpdateProfile}
                        onDismiss={handleDismissRecommendation}
                        isVisible={showProfileRecommendation && recommendationCategory === 'outsideTheBox'}
                      />
                      <SimulationCategoryEvaluation
                        title={t('simulation.categories.outsideRoles', { ns: 'dashboard' })}
                        categoryKey="outsideTheBox"
                        roles={safeSimResults.evaluationFlow.outsideTheBox}
                        phase={safeSimResults.evaluationFlow.phases?.outsideTheBox || 'eval'}
                        rankedRows={safeSimResults.evaluationFlow.ranked?.outsideTheBox}
                        hasStarted={!!safeSimResults.evaluationFlow.hasStarted?.outsideTheBox}
                        onEvaluate={(stepId, evaluation) =>
                          handleEvaluationCommit('outsideTheBox', stepId, evaluation)
                        }
                        onSeeRanking={() => handleSeeRoleRanking('outsideTheBox')}
                        onEditRatings={() => handleEditRoleRanking('outsideTheBox')}
                        onReorderRankedRoles={(rows) => handleReorderRankedRoles('outsideTheBox', rows)}
                        isStepSaved={(role) => isStepSaved(role)}
                        isStepSaving={(role) => isStepSaving(role)}
                        onToggleSave={(role) => handleToggleSaveStep(role, selectedSimulation?.id)}
                        guardedNavigate={guardedNavigate}
                        isViewingSavedSimulation={isViewingSavedSimulation}
                        savedSimulationId={selectedSimulation?.id}
                        simulationIdForCards={
                          selectedSimulation?.id || safeSimResults?.simulationId || 'local'
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
