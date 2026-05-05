import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Navigation Guard Hook
 * Provides protection against accidental navigation when there are unsaved changes
 * Handles both browser-level navigation (beforeunload) and internal navigation (React Router)
 */
const useNavigationGuard = (hasUnsavedChanges, changeSummary = null, options = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [isBlocking, setIsBlocking] = useState(false);
  
  // Refs to track state
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  const changeSummaryRef = useRef(changeSummary);
  const isBlockingRef = useRef(false);
  const originalNavigateRef = useRef(navigate);
  
  // Update refs when props change
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
    changeSummaryRef.current = changeSummary;
  }, [hasUnsavedChanges, changeSummary]);

  // Default options
  const {
    enabled = true,
    message = 'You have unsaved changes. Are you sure you want to leave?',
    title = 'Unsaved Changes Detected',
    confirmText = 'Leave Anyway',
    cancelText = 'Stay on Page',
    saveText = 'Save Changes',
    showSaveOption = false,
    onSave = null,
    onConfirmLeave = null,
    onCancelLeave = null
  } = options;

  /**
   * Handle browser beforeunload event
   * Shows browser's native confirmation dialog
   */
  const handleBeforeUnload = useCallback((event) => {
    if (!enabled || !hasUnsavedChangesRef.current || isBlockingRef.current) {
      return;
    }

    // Standard way to show browser confirmation dialog
    event.preventDefault();
    event.returnValue = message;
    return message;
  }, [enabled, message]);

  /**
   * Guarded navigate function that checks for unsaved changes before navigating
   */
  const guardedNavigate = useCallback((to, options = {}) => {
    console.log('🛡️ Navigation Guard Check:', {
      enabled,
      hasUnsavedChanges: hasUnsavedChangesRef.current,
      isBlocking: isBlockingRef.current,
      targetPath: to,
      currentPath: location.pathname
    });

    if (!enabled || !hasUnsavedChangesRef.current || isBlockingRef.current) {
      // No guard needed, proceed with navigation
      console.log('✅ Navigation allowed - no guard needed');
      return originalNavigateRef.current(to, options);
    }

    // Check if we're navigating to the same page (should be allowed)
    const currentPath = location.pathname;
    const targetPath = typeof to === 'string' ? to : to.pathname || '';
    
    if (currentPath === targetPath) {
      // Same page navigation, allow it
      console.log('✅ Navigation allowed - same page');
      return originalNavigateRef.current(to, options);
    }

    // Block navigation and show confirmation dialog
    console.log('🚫 Navigation blocked - showing confirmation dialog');
    setPendingNavigation({ to, options });
    setShowConfirmationDialog(true);
    setIsBlocking(true);
    isBlockingRef.current = true;
    
    // Don't call navigate - the dialog will handle it
    return;
  }, [enabled, location.pathname]);

  /**
   * Confirm navigation and proceed
   */
  const confirmNavigation = useCallback(() => {
    if (pendingNavigation) {
      // Reset blocking state
      setIsBlocking(false);
      isBlockingRef.current = false;
      
      // Close dialog
      setShowConfirmationDialog(false);
      
      // Execute pending navigation
      const { to, options } = pendingNavigation;
      setPendingNavigation(null);
      
      // Call optional callback
      if (onConfirmLeave) {
        onConfirmLeave(to);
      }
      
      // Navigate to target location
      originalNavigateRef.current(to, options);
    }
  }, [pendingNavigation, onConfirmLeave]);

  /**
   * Cancel navigation and stay on current page
   */
  const cancelNavigation = useCallback(() => {
    // Reset blocking state
    setIsBlocking(false);
    isBlockingRef.current = false;
    
    // Close dialog and clear pending navigation
    setShowConfirmationDialog(false);
    setPendingNavigation(null);
    
    // Call optional callback
    if (onCancelLeave) {
      onCancelLeave();
    }
  }, [onCancelLeave]);

  /**
   * Save changes and then navigate
   */
  const saveAndNavigate = useCallback(async () => {
    if (onSave && typeof onSave === 'function') {
      try {
        await onSave();
        // After successful save, proceed with navigation
        confirmNavigation();
      } catch (error) {
        console.error('Error saving changes:', error);
        // Stay on page if save fails
        cancelNavigation();
      }
    } else {
      // No save function provided, just proceed
      confirmNavigation();
    }
  }, [onSave, confirmNavigation, cancelNavigation]);

  /**
   * Programmatically trigger navigation guard
   * Useful for custom navigation scenarios
   */
  const guardNavigation = useCallback((targetLocation) => {
    return guardedNavigate(targetLocation);
  }, [guardedNavigate]);

  /**
   * Check if navigation is currently being blocked
   */
  const isNavigationBlocked = useCallback(() => {
    return isBlockingRef.current;
  }, []);

  /**
   * Force allow navigation (bypass guard)
   * Useful for system-initiated navigation
   */
  const forceAllowNavigation = useCallback((targetLocation) => {
    setIsBlocking(false);
    isBlockingRef.current = false;
    setShowConfirmationDialog(false);
    setPendingNavigation(null);
    
    if (targetLocation) {
      originalNavigateRef.current(targetLocation);
    }
  }, []);

  // Set up browser beforeunload listener
  useEffect(() => {
    if (!enabled) {
      return;
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [enabled, handleBeforeUnload]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setIsBlocking(false);
      isBlockingRef.current = false;
    };
  }, []);

  return {
    // State
    showConfirmationDialog,
    pendingNavigation,
    isBlocking,
    
    // Actions
    confirmNavigation,
    cancelNavigation,
    saveAndNavigate,
    guardNavigation,
    forceAllowNavigation,
    
    // Utilities
    isNavigationBlocked,
    
    // Guarded navigate function (use this instead of regular navigate)
    guardedNavigate,
    
    // Dialog configuration
    dialogConfig: {
      open: showConfirmationDialog,
      title,
      message,
      confirmText,
      cancelText,
      saveText,
      showSaveOption: showSaveOption && onSave,
      changeSummary: changeSummaryRef.current,
      onConfirm: confirmNavigation,
      onCancel: cancelNavigation,
      onSave: saveAndNavigate
    }
  };
};

export default useNavigationGuard;
