import { useState } from 'react';

const useConfirmationDialog = () => {
  const [dialogState, setDialogState] = useState({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    severity: 'warning',
    hideCancel: false,
    loading: false,
    onConfirm: null,
    onCancel: null
  });

  const openDialog = (config) => {
    setDialogState({
      open: true,
      title: config.title || 'Confirm Action',
      message: config.message || 'Are you sure?',
      confirmText: config.confirmText || 'Confirm',
      cancelText: config.cancelText || 'Cancel',
      severity: config.severity || 'warning',
      hideCancel: Boolean(config.hideCancel),
      loading: false,
      onConfirm: config.onConfirm || null,
      onCancel: config.onCancel || null
    });
  };

  const closeDialog = () => {
    setDialogState(prev => ({
      ...prev,
      open: false,
      loading: false
    }));
  };

  const setLoading = (loading) => {
    setDialogState(prev => ({
      ...prev,
      loading
    }));
  };

  const handleConfirm = async () => {
    if (dialogState.onConfirm && typeof dialogState.onConfirm === 'function') {
      setLoading(true);
      try {
        await dialogState.onConfirm();
      } catch (error) {
        console.error('Error in confirmation handler:', error);
      } finally {
        setLoading(false);
        closeDialog();
      }
    } else {
      closeDialog();
    }
  };

  const handleCancel = () => {
    if (dialogState.onCancel && typeof dialogState.onCancel === 'function') {
      dialogState.onCancel();
    }
    closeDialog();
  };

  return {
    dialogState,
    openDialog,
    closeDialog,
    setLoading,
    handleConfirm,
    handleCancel
  };
};

export default useConfirmationDialog;
