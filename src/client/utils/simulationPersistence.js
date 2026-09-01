/**
 * Simulation Persistence Utilities
 * Handles session storage for simulation results and state management
 */

import { clearSimulationResultDetailsCaches } from './simulationResultSessionStore';
import { clearAllCareerPathPlanning } from './careerPathPlanningSession';
import { clearAllSeenIdentityPieces } from './identityTraitChangeHighlights';
import {
  toPersistedSimulationResults,
  withMaterializedEvaluationFlow,
} from './evaluationFlowModel';

const STORAGE_KEYS = {
  SIMULATION_RESULTS: 'currentSimulationResults',
  SIMULATION_STATE: 'currentSimulationState',
  SIMULATION_METADATA: 'currentSimulationMetadata'
};

const SIMULATION_DETAIL_CONTEXT_KEY = 'currentSimulationDetailContext';

function readSessionJson(key) {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw);
}

function hasObjectResults(value) {
  return Boolean(value && typeof value === 'object');
}

/**
 * Save simulation results to session storage
 * @param {Object} simulationData - The simulation results and metadata
 * @param {string} state - The current simulation state ('clean' | 'modified' | 'saved')
 */
export const saveSimulationToStorage = (simulationData, state = 'clean') => {
  try {
    // Check if sessionStorage is available
    if (typeof sessionStorage === 'undefined') {
      console.warn('⚠️ SessionStorage not available - simulation persistence disabled');
      return false;
    }

    const persistedResults = hasObjectResults(simulationData?.results)
      ? toPersistedSimulationResults(simulationData.results)
      : null;

    const storageData = {
      results: persistedResults,
      metadata: {
        simulationDate: simulationData.simulationDate,
        profileCompletion: simulationData.profileCompletion,
        timestamp: new Date().toISOString()
      },
      state: state
    };

    // Check storage quota before saving
    const dataString = JSON.stringify(storageData);
    if (dataString.length > 5 * 1024 * 1024) { // 5MB limit
      console.warn('⚠️ Simulation data too large for session storage - skipping save');
      return false;
    }

    sessionStorage.setItem(STORAGE_KEYS.SIMULATION_RESULTS, dataString);
    sessionStorage.setItem(STORAGE_KEYS.SIMULATION_STATE, state);
    if (persistedResults) {
      sessionStorage.setItem('currentSimResults', JSON.stringify(persistedResults));
    } else {
      sessionStorage.removeItem('currentSimResults');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error saving simulation to storage:', error);
    
    // Handle specific storage errors
    if (error.name === 'QuotaExceededError') {
      console.warn('⚠️ Session storage quota exceeded - clearing old data and retrying');
      try {
        // Clear old data and retry once
        sessionStorage.clear();
        const storageData = {
          results: persistedResults,
          metadata: {
            simulationDate: simulationData.simulationDate,
            profileCompletion: simulationData.profileCompletion,
            timestamp: new Date().toISOString()
          },
          state: state
        };
        sessionStorage.setItem(STORAGE_KEYS.SIMULATION_RESULTS, JSON.stringify(storageData));
        sessionStorage.setItem(STORAGE_KEYS.SIMULATION_STATE, state);
        if (persistedResults) {
          sessionStorage.setItem('currentSimResults', JSON.stringify(persistedResults));
        } else {
          sessionStorage.removeItem('currentSimResults');
        }
        return true;
      } catch (retryError) {
        console.error('❌ Failed to save simulation even after clearing storage:', retryError);
        return false;
      }
    }
    
    return false;
  }
};

/**
 * Load simulation results from session storage
 * @returns {Object|null} The simulation data or null if not found
 */
export const loadSimulationFromStorage = () => {
  try {
    if (typeof sessionStorage === 'undefined') {
      console.warn('⚠️ SessionStorage not available - cannot load simulation data');
      return null;
    }

    const storedData = sessionStorage.getItem(STORAGE_KEYS.SIMULATION_RESULTS);
    const storedState = sessionStorage.getItem(STORAGE_KEYS.SIMULATION_STATE);
    
    if (!storedData) {
      return null;
    }

    const simulationData = JSON.parse(storedData);
    
    // Validate the loaded data structure
    if ((!simulationData.results && storedState === 'saved') || !simulationData.metadata) {
      return {
        results: null,
        metadata: simulationData.metadata || {},
        state: storedState || 'saved'
      };
    }

    if (!simulationData.results || !simulationData.metadata) {
      console.warn('⚠️ Invalid simulation data structure in storage - clearing');
      clearSimulationFromStorage();
      return null;
    }
    
    return {
      results: withMaterializedEvaluationFlow(simulationData.results),
      metadata: simulationData.metadata,
      state: storedState || 'clean'
    };
  } catch (error) {
    console.error('❌ Error loading simulation from storage:', error);
    
    // If there's a parsing error, clear the corrupted data
    if (error instanceof SyntaxError) {
      console.warn('⚠️ Corrupted simulation data in storage - clearing');
      clearSimulationFromStorage();
    }
    
    return null;
  }
};

/**
 * Clear simulation data from session storage
 */
export const clearSimulationFromStorage = () => {
  try {
    // Check if sessionStorage is available
    if (typeof sessionStorage === 'undefined') {
      console.warn('⚠️ SessionStorage not available - cannot clear simulation data');
      return false;
    }

    sessionStorage.removeItem(STORAGE_KEYS.SIMULATION_RESULTS);
    sessionStorage.removeItem(STORAGE_KEYS.SIMULATION_STATE);
    sessionStorage.removeItem(STORAGE_KEYS.SIMULATION_METADATA);
    sessionStorage.removeItem(SIMULATION_DETAIL_CONTEXT_KEY);
    sessionStorage.removeItem('currentSimResults');
    
    return true;
  } catch (error) {
    console.error('❌ Error clearing simulation from storage:', error);
    return false;
  }
};

/** Session keys set by simulation flows outside this module (see grep: sessionStorage.setItem). */
const EXTRA_SIMULATION_SESSION_KEYS = [
  'currentSimResults',
  'usedReplacements',
  'currentResultDetails',
  'currentStepDetails',
  'currentSimulationId',
];

/**
 * Wipe all browser-held simulation draft/detail caches. Call on login, logout, and when auth fails.
 * sessionStorage is per-tab, not per-user — without this, user B can see user A's in-tab simulation after sign-in.
 */
export const clearSimulationSessionForAuthChange = () => {
  clearSimulationFromStorage();
  clearSimulationResultDetailsCaches();
  clearAllCareerPathPlanning();
  clearAllSeenIdentityPieces();
  if (typeof sessionStorage === 'undefined') return;
  for (const key of EXTRA_SIMULATION_SESSION_KEYS) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
};

/**
 * Persist lightweight navigation context for role-detail round trips.
 * Latest-run results themselves stay in the main simulation snapshot.
 *
 * @param {{ savedSimulationId?: string|null }} [context]
 * @returns {boolean}
 */
export const saveSimulationDetailContext = (context = {}) => {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    const savedSimulationId = context.savedSimulationId
      ? String(context.savedSimulationId)
      : null;
    sessionStorage.setItem(
      SIMULATION_DETAIL_CONTEXT_KEY,
      JSON.stringify({ savedSimulationId })
    );
    return true;
  } catch (error) {
    console.warn('Failed to save simulation detail context:', error);
    return false;
  }
};

/**
 * Read the most recent detail-navigation context.
 * @returns {{ savedSimulationId: string|null }}
 */
export const loadSimulationDetailContext = () => {
  try {
    const parsed = readSessionJson(SIMULATION_DETAIL_CONTEXT_KEY);
    return {
      savedSimulationId: parsed?.savedSimulationId
        ? String(parsed.savedSimulationId)
        : null,
    };
  } catch {
    return { savedSimulationId: null };
  }
};

export const clearSimulationDetailContext = () => {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    sessionStorage.removeItem(SIMULATION_DETAIL_CONTEXT_KEY);
    return true;
  } catch (error) {
    console.warn('Failed to clear simulation detail context:', error);
    return false;
  }
};

/**
 * Check if simulation data exists in session storage
 * @returns {boolean} True if simulation data exists
 */
export const hasSimulationInStorage = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.SIMULATION_RESULTS) !== null;
  } catch (error) {
    console.error('❌ Error checking simulation storage:', error);
    return false;
  }
};

/**
 * Prefer the active session snapshot for the latest run.
 * `currentSimResults` is still read as a legacy fallback until older tabs age out.
 *
 * @returns {{
 *   results: object,
 *   date?: string | Date,
 *   state: string,
 *   source: 'session' | 'legacy-current',
 *   metadata?: object,
 * } | null}
 */
export const loadPreferredSimulationSnapshot = () => {
  const stored = loadSimulationFromStorage();
  if (stored?.results && stored.state !== 'saved') {
    return {
      results: stored.results,
      date: stored.metadata?.simulationDate,
      state: stored.state || 'modified',
      source: 'session',
      metadata: stored.metadata,
    };
  }

  try {
    const legacyResults = readSessionJson('currentSimResults');
    if (!legacyResults || typeof legacyResults !== 'object') return null;
    return {
      results: withMaterializedEvaluationFlow(legacyResults),
      date: stored?.metadata?.simulationDate,
      state:
        (typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem(STORAGE_KEYS.SIMULATION_STATE)
          : null) || 'modified',
      source: 'legacy-current',
      metadata: {
        simulationDate: stored?.metadata?.simulationDate,
        profileCompletion: stored?.metadata?.profileCompletion,
      },
    };
  } catch (error) {
    console.warn('Failed to parse currentSimResults:', error);
    return null;
  }
};

/**
 * Apply a pure updater to the latest in-progress simulation snapshot and persist it
 * through the single primary session-storage path.
 *
 * @param {(results: object) => object|null|undefined} updater
 * @param {{
 *   simulationDate?: string|Date|null,
 *   profileCompletion?: number|null,
 *   state?: 'clean'|'modified'|'saved',
 * }} [options]
 * @returns {{ results: object, metadata: object, state: string } | null}
 */
export const updateLatestSimulationSnapshot = (updater, options = {}) => {
  if (typeof updater !== 'function') return null;
  const preferred = loadPreferredSimulationSnapshot();
  if (!preferred?.results || typeof preferred.results !== 'object') return null;

  const nextResults = updater(preferred.results);
  if (!nextResults || nextResults === preferred.results) {
    return {
      results: preferred.results,
      metadata: preferred.metadata || {},
      state: preferred.state || 'modified',
    };
  }

  const simulationDate =
    options.simulationDate !== undefined
      ? options.simulationDate
      : preferred.metadata?.simulationDate ?? preferred.date ?? null;
  const profileCompletion =
    options.profileCompletion !== undefined
      ? options.profileCompletion
      : preferred.metadata?.profileCompletion ?? null;
  const state = options.state || preferred.state || 'modified';

  saveSimulationToStorage(
    {
      results: nextResults,
      simulationDate,
      profileCompletion,
    },
    state
  );

  return {
    results: nextResults,
    metadata: {
      ...(preferred.metadata || {}),
      simulationDate,
      profileCompletion,
    },
    state,
  };
};

/** True when this tab has an in-progress (non-saved) simulation. */
export const hasActiveCareerSimulationSession = () => {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    if (sessionStorage.getItem('currentSimResults')) {
      return true;
    }
    const storedData = sessionStorage.getItem(STORAGE_KEYS.SIMULATION_RESULTS);
    if (!storedData) return false;
    const storedState = sessionStorage.getItem(STORAGE_KEYS.SIMULATION_STATE) || 'clean';
    if (storedState === 'saved') return false;
    const simulationData = JSON.parse(storedData);
    return Boolean(simulationData?.results);
  } catch {
    return false;
  }
};

/**
 * Get current simulation state from storage
 * @returns {string} The current simulation state
 */
export const getSimulationStateFromStorage = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.SIMULATION_STATE) || 'clean';
  } catch (error) {
    console.error('❌ Error getting simulation state from storage:', error);
    return 'clean';
  }
};

/**
 * Update simulation state in storage
 * @param {string} state - The new simulation state
 */
export const updateSimulationStateInStorage = (state) => {
  try {
    sessionStorage.setItem(STORAGE_KEYS.SIMULATION_STATE, state);
    return true;
  } catch (error) {
    console.error('❌ Error updating simulation state in storage:', error);
    return false;
  }
};

export default {
  saveSimulationToStorage,
  loadSimulationFromStorage,
  clearSimulationFromStorage,
  clearSimulationSessionForAuthChange,
  hasSimulationInStorage,
  hasActiveCareerSimulationSession,
  saveSimulationDetailContext,
  loadSimulationDetailContext,
  clearSimulationDetailContext,
  loadPreferredSimulationSnapshot,
  updateLatestSimulationSnapshot,
  getSimulationStateFromStorage,
  updateSimulationStateInStorage,
  STORAGE_KEYS,
  SIMULATION_DETAIL_CONTEXT_KEY,
};
