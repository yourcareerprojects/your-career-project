import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for detecting changes in simulation data
 * Compares current state with original state to determine if changes have been made
 */
const useChangeDetection = (originalData, currentData) => {
  const [hasChanges, setHasChanges] = useState(false);

  /**
   * Deep comparison function to detect changes in simulation data
   * @param {Object} original - Original simulation data
   * @param {Object} current - Current simulation data
   * @returns {boolean} - True if changes detected
   */
  const detectChanges = useCallback((original, current) => {
    if (!original || !current) {
      return false;
    }

    // Compare results structure
    const originalResults = original.results || {};
    const currentResults = current.results || {};

    // Check if results have changed
    const resultsChanged = JSON.stringify(originalResults) !== JSON.stringify(currentResults);

    // Check if other important fields have changed
    const otherFieldsChanged =
      original.name !== current.name ||
      original.description !== current.description;

    return resultsChanged || otherFieldsChanged;
  }, []);

  // Update change detection when data changes
  useEffect(() => {
    const changesDetected = detectChanges(originalData, currentData);
    setHasChanges(changesDetected);
  }, [originalData, currentData, detectChanges]);

  /**
   * Reset change detection (call after successful save)
   */
  const resetChanges = useCallback(() => {
    setHasChanges(false);
  }, []);

  /**
   * Get a summary of changes made
   * @returns {Object} - Summary of changes
   */
  const getChangeSummary = useCallback(() => {
    if (!hasChanges || !originalData || !currentData) {
      return { hasChanges: false, changes: [] };
    }

    const changes = [];
    const originalResults = originalData.results || {};
    const currentResults = currentData.results || {};

    // Check for changes in each category
    if (JSON.stringify(originalResults.nextSteps) !== JSON.stringify(currentResults.nextSteps)) {
      const originalCount = originalResults.nextSteps?.length || 0;
      const currentCount = currentResults.nextSteps?.length || 0;
      changes.push({
        category: 'Next Career Steps',
        type: 'count_change',
        original: originalCount,
        current: currentCount,
        difference: currentCount - originalCount
      });
    }

    if (JSON.stringify(originalResults.outsideTheBox) !== JSON.stringify(currentResults.outsideTheBox)) {
      const originalCount = originalResults.outsideTheBox?.length || 0;
      const currentCount = currentResults.outsideTheBox?.length || 0;
      changes.push({
        category: 'Outside the Box Roles',
        type: 'count_change',
        original: originalCount,
        current: currentCount,
        difference: currentCount - originalCount
      });
    }

    if (JSON.stringify(originalResults.furtherAdvice) !== JSON.stringify(currentResults.furtherAdvice)) {
      const originalCount = originalResults.furtherAdvice?.length || 0;
      const currentCount = currentResults.furtherAdvice?.length || 0;
      changes.push({
        category: 'Further Advice',
        type: 'count_change',
        original: originalCount,
        current: currentCount,
        difference: currentCount - originalCount
      });
    }

    // Check for metadata changes
    if (originalData.name !== currentData.name) {
      changes.push({
        category: 'Name',
        type: 'text_change',
        original: originalData.name,
        current: currentData.name
      });
    }

    if (originalData.description !== currentData.description) {
      changes.push({
        category: 'Description',
        type: 'text_change',
        original: originalData.description,
        current: currentData.description
      });
    }

    return {
      hasChanges: true,
      changes,
      totalChanges: changes.length
    };
  }, [hasChanges, originalData, currentData]);

  return {
    hasChanges,
    resetChanges,
    getChangeSummary
  };
};

export default useChangeDetection;
