/**
 * Simulation Persistence Utilities
 * Handles session storage for simulation results and state management
 */

import { clearSimulationResultDetailsCaches } from './simulationResultSessionStore';

const STORAGE_KEYS = {
  SIMULATION_RESULTS: 'currentSimulationResults',
  SIMULATION_STATE: 'currentSimulationState',
  SIMULATION_METADATA: 'currentSimulationMetadata'
};

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

    const storageData = {
      results: simulationData.results,
      metadata: {
        careerGoal: simulationData.careerGoal,
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
    
    console.log('💾 Simulation saved to session storage:', { state, timestamp: storageData.metadata.timestamp });
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
          results: simulationData.results,
          metadata: {
            careerGoal: simulationData.careerGoal,
            simulationDate: simulationData.simulationDate,
            profileCompletion: simulationData.profileCompletion,
            timestamp: new Date().toISOString()
          },
          state: state
        };
        sessionStorage.setItem(STORAGE_KEYS.SIMULATION_RESULTS, JSON.stringify(storageData));
        sessionStorage.setItem(STORAGE_KEYS.SIMULATION_STATE, state);
        console.log('💾 Simulation saved to session storage after clearing:', { state });
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
    // Check if sessionStorage is available
    if (typeof sessionStorage === 'undefined') {
      console.warn('⚠️ SessionStorage not available - cannot load simulation data');
      return null;
    }

    const storedData = sessionStorage.getItem(STORAGE_KEYS.SIMULATION_RESULTS);
    const storedState = sessionStorage.getItem(STORAGE_KEYS.SIMULATION_STATE);
    
    if (!storedData) {
      console.log('📭 No simulation data found in session storage');
      return null;
    }

    const simulationData = JSON.parse(storedData);
    
    // Validate the loaded data structure
    if (!simulationData.results || !simulationData.metadata) {
      console.warn('⚠️ Invalid simulation data structure in storage - clearing');
      clearSimulationFromStorage();
      return null;
    }
    
    console.log('📂 Simulation loaded from session storage:', { 
      state: storedState, 
      timestamp: simulationData.metadata?.timestamp 
    });
    
    return {
      results: simulationData.results,
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
    
    console.log('🗑️ Simulation data cleared from session storage');
    return true;
  } catch (error) {
    console.error('❌ Error clearing simulation from storage:', error);
    return false;
  }
};

/** Session keys set by simulation flows outside this module (see grep: sessionStorage.setItem). */
const EXTRA_SIMULATION_SESSION_KEYS = [
  'currentUnsavedResults',
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
 * True when this tab has an in-progress (non-saved) simulation, or staged unsaved results
 * from the details flow (`currentUnsavedResults`).
 */
export const hasActiveCareerSimulationSession = () => {
  const stored = loadSimulationFromStorage();
  if (stored?.results && stored.state !== 'saved') {
    return true;
  }
  try {
    return Boolean(sessionStorage.getItem('currentUnsavedResults'));
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
    console.log('🔄 Simulation state updated in storage:', state);
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
  getSimulationStateFromStorage,
  updateSimulationStateInStorage,
  STORAGE_KEYS
};
