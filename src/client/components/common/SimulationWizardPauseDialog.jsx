import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Confirms exiting the simulation ranking wizard while keeping session progress.
 */
export default function SimulationWizardPauseDialog({ open, onStay, onSaveAndExit }) {
  const { t } = useTranslation('dashboard');

  return (
    <Dialog
      open={open}
      onClose={onStay}
      aria-labelledby="simulation-wizard-pause-dialog-title"
      aria-describedby="simulation-wizard-pause-dialog-description"
    >
      <DialogTitle id="simulation-wizard-pause-dialog-title">
        {t('simulation.wizard.pauseDialog.title')}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="simulation-wizard-pause-dialog-description">
          {t('simulation.wizard.pauseDialog.description')}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onStay} variant="outlined">
          {t('simulation.wizard.pauseDialog.stay')}
        </Button>
        <Button onClick={onSaveAndExit} variant="contained" color="error">
          {t('simulation.wizard.pauseDialog.saveAndExit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
