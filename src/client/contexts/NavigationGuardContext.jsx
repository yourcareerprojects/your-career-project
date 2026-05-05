import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Global Navigation Guard Context
 * Provides application-wide navigation protection for unsaved changes
 */
const NavigationGuardContext = createContext();

export const useNavigationGuardContext = () => {
  const context = useContext(NavigationGuardContext);
  if (!context) {
    throw new Error('useNavigationGuardContext must be used within a NavigationGuardProvider');
  }
  return context;
};

export const NavigationGuardProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // State for global navigation guard
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [isBlocking, setIsBlocking] = useState(false);
  
  // Registry of components that have unsaved changes
  const [registeredGuards, setRegisteredGuards] = useState(new Map());
  const registeredGuardsRef = useRef(new Map());
  
  // Update ref when state changes
  useEffect(() => {
    registeredGuardsRef.current = registeredGuards;
  }, [registeredGuards]);

  /**
   * Register a component as having unsaved changes
   * @param {string} componentId - Unique identifier for the component
   * @param {Object} guardConfig - Configuration for the guard
   */
  const registerGuard = useCallback((componentId, guardConfig) => {
    setRegisteredGuards(prev => {
      const newMap = new Map(prev);
      newMap.set(componentId, {
        ...guardConfig,
        registeredAt: Date.now()
      });
      return newMap;
    });
  }, []);

  /**
   * Unregister a component's guard
   * @param {string} componentId - Unique identifier for the component
   */
  const unregisterGuard = useCallback((componentId) => {
    setRegisteredGuards(prev => {
      const newMap = new Map(prev);
      newMap.delete(componentId);
      return newMap;
    });
  }, []);

  /**
   * Check if any registered guards are active
   */
  const hasActiveGuards = useCallback(() => {
    const guards = registeredGuardsRef.current;
    for (const [componentId, guardConfig] of guards) {
      if (guardConfig.enabled && guardConfig.hasUnsavedChanges) {
        return { componentId, guardConfig };
      }
    }
    return null;
  }, []);

  /**
   * Global guarded navigate function
   */
  const guardedNavigate = useCallback((to, options = {}) => {
    console.log('🛡️ Global Navigation Guard Check:', {
      targetPath: to,
      currentPath: location.pathname,
      registeredGuards: Array.from(registeredGuardsRef.current.keys())
    });

    // Check if we're navigating to the same page (should be allowed)
    const currentPath = location.pathname;
    const targetPath = typeof to === 'string' ? to : to.pathname || '';
    
    if (currentPath === targetPath) {
      console.log('✅ Navigation allowed - same page');
      return navigate(to, options);
    }

    // Check for active guards
    const activeGuard = hasActiveGuards();
    
    if (!activeGuard) {
      // No active guards, proceed with navigation
      console.log('✅ Navigation allowed - no active guards');
      return navigate(to, options);
    }

    // In-flow role detail pages (session-backed) should not require confirming "leave simulation".
    // Evaluation progress is persisted on the simulation results screen separately.
    const normalizedTarget = (typeof targetPath === 'string' ? targetPath : String(targetPath || '')).split('?')[0];
    const isSimulationRoleDetail =
      normalizedTarget.startsWith('/simulation/result/') ||
      /^\/saved-simulation\/[^/]+\/career-step\//.test(normalizedTarget);
    if (isSimulationRoleDetail) {
      console.log('✅ Navigation allowed - simulation role detail (guard bypass)');
      return navigate(to, options);
    }

    // Block navigation and show confirmation dialog
    console.log('🚫 Navigation blocked - showing confirmation dialog', {
      componentId: activeGuard.componentId,
      guardConfig: activeGuard.guardConfig
    });
    
    setPendingNavigation({ to, options });
    setShowConfirmationDialog(true);
    setIsBlocking(true);
    
    // Don't call navigate - the dialog will handle it
    return;
  }, [navigate, location.pathname, hasActiveGuards]);

  /**
   * Confirm navigation and proceed
   */
  const confirmNavigation = useCallback(() => {
    if (pendingNavigation) {
      // Reset blocking state
      setIsBlocking(false);
      
      // Close dialog
      setShowConfirmationDialog(false);
      
      // Execute pending navigation
      const { to, options } = pendingNavigation;
      setPendingNavigation(null);
      
      // Navigate to target location
      navigate(to, options);
    }
  }, [pendingNavigation, navigate]);

  /**
   * Cancel navigation and stay on current page
   */
  const cancelNavigation = useCallback(() => {
    // Reset blocking state
    setIsBlocking(false);
    
    // Close dialog and clear pending navigation
    setShowConfirmationDialog(false);
    setPendingNavigation(null);
  }, []);

  /**
   * Save changes and then navigate
   */
  const saveAndNavigate = useCallback(async () => {
    const activeGuard = hasActiveGuards();
    
    if (activeGuard && activeGuard.guardConfig.onSave && typeof activeGuard.guardConfig.onSave === 'function') {
      try {
        await activeGuard.guardConfig.onSave();
        // After successful save, proceed with navigation
        confirmNavigation();
      } catch (error) {
        console.error('Error saving changes:', error);
        // Don't proceed with navigation if save failed
      }
    } else {
      // No save function available, just proceed
      confirmNavigation();
    }
  }, [hasActiveGuards, confirmNavigation]);

  // Get the current active guard's configuration for the dialog
  const getDialogConfig = useCallback(() => {
    const activeGuard = hasActiveGuards();
    
    if (!activeGuard) {
      return {
        open: false,
        title: 'Unsaved Changes Detected',
        message: 'You have unsaved changes. Are you sure you want to leave?',
        confirmText: 'Leave Anyway',
        cancelText: 'Stay on Page',
        saveText: 'Save Changes',
        showSaveOption: false,
        changeSummary: null,
        loading: false,
        onConfirm: confirmNavigation,
        onCancel: cancelNavigation,
        onSave: saveAndNavigate
      };
    }

    const { guardConfig } = activeGuard;
    
    return {
      open: showConfirmationDialog,
      title: guardConfig.title || 'Unsaved Changes Detected',
      message: guardConfig.message || 'You have unsaved changes. Are you sure you want to leave?',
      confirmText: guardConfig.confirmText || 'Leave Anyway',
      cancelText: guardConfig.cancelText || 'Stay on Page',
      saveText: guardConfig.saveText || 'Save Changes',
      showSaveOption: guardConfig.showSaveOption || false,
      changeSummary: guardConfig.changeSummary || null,
      loading: guardConfig.loading || false,
      onConfirm: confirmNavigation,
      onCancel: cancelNavigation,
      onSave: saveAndNavigate
    };
  }, [showConfirmationDialog, hasActiveGuards, confirmNavigation, cancelNavigation, saveAndNavigate]);

  const contextValue = {
    registerGuard,
    unregisterGuard,
    guardedNavigate,
    hasActiveGuards,
    getDialogConfig,
    isBlocking
  };

  return (
    <NavigationGuardContext.Provider value={contextValue}>
      {children}
    </NavigationGuardContext.Provider>
  );
};

export default NavigationGuardContext;
