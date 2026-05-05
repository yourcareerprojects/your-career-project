import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Button,
  TextField,
  Divider,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions
} from '@mui/material';
import { Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import { hasChanges } from '../../utils/changeDetection';
import { USER_IDENTITY_FIELDS } from '../../constants/userIdentityFields';

function emptyIdentity() {
  return USER_IDENTITY_FIELDS.reduce((acc, { key }) => ({ ...acc, [key]: '' }), {});
}

function identityFromInitial(initialData = {}) {
  const base = emptyIdentity();
  for (const { key } of USER_IDENTITY_FIELDS) {
    if (initialData[key] != null) base[key] = String(initialData[key]);
  }
  return base;
}

const UserIdentityTextForm = ({ initialData = {}, onSubmit, onCancel, loading, error }) => {
  const { t } = useTranslation('onboarding');
  const [originalData, setOriginalData] = useState(() => identityFromInitial(initialData));
  const [formData, setFormData] = useState(() => identityFromInitial(initialData));
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    const next = identityFromInitial(initialData);
    setOriginalData(next);
    setFormData(next);
    setSubmitError('');
    setFieldErrors({});
  }, [initialData]);

  const hasUnsavedChanges = useMemo(() => hasChanges(originalData, formData), [originalData, formData]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = {};
    const errors = {};
    for (const { key } of USER_IDENTITY_FIELDS) {
      trimmed[key] = String(formData[key] || '').trim();
      if (!trimmed[key]) errors[key] = 'This field is required';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError('Please answer all five questions.');
      return;
    }
    setFieldErrors({});
    setSubmitError('');
    onSubmit(trimmed);
  };

  const handleCancel = () => {
    if (hasUnsavedChanges) setShowCancelDialog(true);
    else executeCancel();
  };

  const executeCancel = () => {
    setFormData(originalData);
    setSubmitError('');
    setFieldErrors({});
    setShowCancelDialog(false);
    if (onCancel) onCancel();
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {typeof error === 'string' ? error : error?.message || 'An error occurred'}
        </Alert>
      )}
      {submitError && (
        <Alert severity="warning" sx={{ mb: 2 }}>{submitError}</Alert>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('profilePage.identityForm.helper')}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {USER_IDENTITY_FIELDS.map(({ key, questionKey }, idx) => {
          const question = t(questionKey);
          return (
            <React.Fragment key={key}>
              <Box sx={{ mt: 2, mb: 1 }}>
                <Typography
                  variant="body1"
                  sx={{
                    color: '#950202',
                    fontWeight: 600,
                    mb: 1.5,
                  }}
                >
                  {question}
                </Typography>
                <TextField
                  fullWidth
                  name={key}
                  multiline
                  minRows={3}
                  sx={{ mt: 0 }}
                  value={formData[key] || ''}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, [key]: e.target.value }));
                    if (submitError) setSubmitError('');
                    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: '' }));
                  }}
                  disabled={loading}
                  required
                  error={Boolean(fieldErrors[key])}
                  inputProps={{ maxLength: 2000, 'aria-label': question }}
                  helperText={fieldErrors[key] || `${(formData[key] || '').length}/2000`}
                  variant="outlined"
                  size="medium"
                />
              </Box>
              {idx < 4 ? <Divider sx={{ my: 3 }} /> : null}
            </React.Fragment>
          );
        })}
      </Box>
      <Box
        sx={{
          mt: 1,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1,
        }}
      >
        <Button type="submit" variant="outlined" size="small" startIcon={<SaveIcon />} disabled={loading}>
          {t('profilePage.actions.save')}
        </Button>
        <Button
          variant="outlined"
          color="error"
          size="small"
          startIcon={<CancelIcon />}
          onClick={handleCancel}
          disabled={loading}
        >
          {t('profilePage.actions.cancel')}
        </Button>
      </Box>
      <Dialog open={showCancelDialog} onClose={() => setShowCancelDialog(false)}>
        <DialogTitle>{t('profilePage.identityForm.unsavedDialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('profilePage.identityForm.unsavedDialog.description')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCancelDialog(false)} variant="outlined">
            {t('profilePage.identityForm.unsavedDialog.keepEditing')}
          </Button>
          <Button onClick={executeCancel} variant="contained" color="error">
            {t('profilePage.identityForm.unsavedDialog.discardChanges')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserIdentityTextForm;
