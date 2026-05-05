import { useState, useCallback } from 'react';

const useReplaceCareerStep = () => {
  const [replacingStep, setReplacingStep] = useState(false);
  const [replacementData, setReplacementData] = useState(null);

  const replaceCareerStep = useCallback(async (simulationId, stepId, category) => {
    try {
      setReplacingStep(true);
      
      const response = await fetch(`/api/profile/simulation/${simulationId}/replace-career-step/${stepId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ category })
      });

      const data = await response.json();
      
      if (data.success) {
        setReplacementData(data);
        return data;
      } else {
        throw new Error(data.message || 'Failed to replace career step');
      }
    } catch (error) {
      console.error('Error replacing career step:', error);
      throw error;
    } finally {
      setReplacingStep(false);
    }
  }, []);

  const clearReplacementData = useCallback(() => {
    setReplacementData(null);
  }, []);

  return {
    replaceCareerStep,
    replacingStep,
    replacementData,
    clearReplacementData
  };
};

export default useReplaceCareerStep;

