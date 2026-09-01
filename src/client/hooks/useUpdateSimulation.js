import { useState } from 'react';
import { toPersistedSimulationResults } from '../utils/evaluationFlowModel';

/**
 * Hook for updating existing simulation results
 * Handles API calls to save changes to existing simulations
 */
const useUpdateSimulation = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Update an existing simulation with new data
   * @param {string} simulationId - The ID of the simulation to update
   * @param {Object} simulationData - The complete simulation data to save
   * @returns {Promise<Object>} - The updated simulation data
   */
  const updateSimulation = async (simulationId, simulationData) => {
    setLoading(true);
    setError(null);

    try {
      console.log('🔄 Updating simulation:', simulationId);
      console.log('🔄 Simulation data:', simulationData);

      const payload = simulationData?.results
        ? {
            ...simulationData,
            results: toPersistedSimulationResults(simulationData.results),
          }
        : simulationData;

      const response = await fetch(
        `/api/profile/simulation-results/${simulationId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to update simulation');
      }

      console.log('✅ Simulation updated successfully:', result.updatedSimulation);
      return result;

    } catch (err) {
      console.error('❌ Error updating simulation:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Clear any existing error state
   */
  const clearError = () => {
    setError(null);
  };

  return {
    updateSimulation,
    loading,
    error,
    clearError
  };
};

export default useUpdateSimulation;
