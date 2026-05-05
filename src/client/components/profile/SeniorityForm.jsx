import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Grid,
  Typography,
  Button,
  FormControl,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions
} from '@mui/material';
import { Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import { hasChanges } from '../../utils/changeDetection';
import { RequiredTextFieldWrapper, RequiredSelectWrapper } from '../common/ValidationComponents';
import { CURRENT_EMPLOYMENT_STATUS_OPTIONS } from '../../../constants/currentEmploymentStatus';
import { HIGHEST_DEGREE_OPTIONS } from '../../../constants/highestDegree';
import { MOST_SENIOR_OPTIONS, YEARS_OPTIONS } from '../../../constants/senioritySelectOptions';

const SeniorityForm = ({ initialData = {}, onSubmit, onCancel, loading, error }) => {
  const { t } = useTranslation('onboarding');
  const [originalData] = useState({
    currentStatus: initialData.currentStatus || '',
    yearsOfExperience: initialData.yearsOfExperience !== undefined && initialData.yearsOfExperience !== null
      ? initialData.yearsOfExperience
      : '',
    highestDegree: initialData.highestDegree || '',
    mostSeniorWorkExperience: initialData.mostSeniorWorkExperience || ''
  });

  const [formData, setFormData] = useState({ ...originalData });
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const hasUnsavedChanges = useMemo(() => hasChanges(originalData, formData), [originalData, formData]);

  const validate = () => {
    const errs = {};
    if (!formData.currentStatus || !formData.currentStatus.trim()) {
      errs.currentStatus = t('profilePage.seniorityForm.errors.currentStatusRequired');
    }
    if (formData.yearsOfExperience !== '' && formData.yearsOfExperience !== undefined && formData.yearsOfExperience !== null) {
      const y = Number(formData.yearsOfExperience);
      if (isNaN(y) || y < 0 || y > 50) {
        errs.yearsOfExperience = t('profilePage.seniorityForm.errors.yearsRange');
      }
    }
    if (!formData.highestDegree || !String(formData.highestDegree).trim()) {
      errs.highestDegree = t('profilePage.seniorityForm.errors.highestDegreeRequired');
    }
    if (!formData.mostSeniorWorkExperience || !String(formData.mostSeniorWorkExperience).trim()) {
      errs.mostSeniorWorkExperience = t('profilePage.seniorityForm.errors.mostSeniorRequired');
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors(prev => ({ ...prev, [name]: null }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    let dataToSend = { ...formData };
    if (dataToSend.yearsOfExperience === '' || dataToSend.yearsOfExperience === undefined || dataToSend.yearsOfExperience === null) {
      dataToSend.yearsOfExperience = null;
    } else {
      dataToSend.yearsOfExperience = parseInt(dataToSend.yearsOfExperience, 10);
    }
    onSubmit(dataToSend);
  };

  const handleCancel = () => {
    if (hasUnsavedChanges) setShowCancelDialog(true);
    else executeCancel();
  };

  const executeCancel = () => {
    setFormData({ ...originalData });
    setFieldErrors({});
    setShowCancelDialog(false);
    if (onCancel) onCancel();
  };

  const isValid = !!formData.currentStatus?.trim() && !!formData.highestDegree?.trim() && !!formData.mostSeniorWorkExperience?.trim();

  const currentEmploymentStatusLabel = (value) => t(`profilePage.seniorityForm.options.currentStatus.${value}`);
  const highestDegreeLabel = (value) => t(`profilePage.seniorityForm.options.highestDegree.${value}`);
  const mostSeniorLabel = (value) => t(`profilePage.seniorityForm.options.mostSenior.${value}`);

  return (
    <Box component="form" onSubmit={handleSubmit}>
      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {typeof error === 'string' ? error : (error?.message || t('profilePage.errors.saveChangesFailed'))}
        </Typography>
      )}
      {error?.errors && Array.isArray(error.errors) && error.errors.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {error.errors.map((err, idx) => (
            <Typography color="error" key={idx}>{err.msg}</Typography>
          ))}
        </Box>
      )}
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6}>
          <Typography
            id="seniority-form-current-status-label"
            variant="body1"
            component="div"
            sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}
          >
            {t('profilePage.seniority.currentEmploymentStatus')}
          </Typography>
          <RequiredSelectWrapper required fullWidth error={fieldErrors.currentStatus} fieldName={t('profilePage.seniority.currentEmploymentStatus')}>
            <Select
              name="currentStatus"
              labelId="seniority-form-current-status-label"
              value={formData.currentStatus}
              onChange={handleChange}
              disabled={loading}
              displayEmpty
              variant="outlined"
            >
              {CURRENT_EMPLOYMENT_STATUS_OPTIONS.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{currentEmploymentStatusLabel(opt.value)}</MenuItem>
              ))}
            </Select>
          </RequiredSelectWrapper>
        </Grid>

        <Grid item xs={12} sm={6}>
          <Typography
            id="seniority-form-years-label"
            variant="body1"
            component="div"
            sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}
          >
            {t('profilePage.seniority.yearsOfWorkExperience')}
          </Typography>
          <FormControl fullWidth variant="outlined">
            <Select
              name="yearsOfExperience"
              labelId="seniority-form-years-label"
              value={formData.yearsOfExperience === '' || formData.yearsOfExperience === null || formData.yearsOfExperience === undefined ? '' : formData.yearsOfExperience}
              onChange={handleChange}
              disabled={loading}
              displayEmpty
              variant="outlined"
            >
              <MenuItem value="">{t('profilePage.seniorityForm.notSpecified')}</MenuItem>
              {YEARS_OPTIONS.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid item xs={12} sm={6}>
          <Typography
            id="seniority-form-highest-degree-label"
            variant="body1"
            component="div"
            sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}
          >
            {t('profilePage.seniority.highestEducationalDegree')}
          </Typography>
          <RequiredSelectWrapper required fullWidth error={fieldErrors.highestDegree} fieldName={t('profilePage.seniority.highestEducationalDegree')}>
            <Select
              name="highestDegree"
              labelId="seniority-form-highest-degree-label"
              value={formData.highestDegree}
              onChange={handleChange}
              disabled={loading}
              displayEmpty
              variant="outlined"
            >
              {HIGHEST_DEGREE_OPTIONS.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{highestDegreeLabel(opt.value)}</MenuItem>
              ))}
            </Select>
          </RequiredSelectWrapper>
        </Grid>

        <Grid item xs={12} sm={6}>
          <Typography
            id="seniority-form-most-senior-label"
            variant="body1"
            component="div"
            sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}
          >
            {t('profilePage.seniority.mostSeniorWorkExperience')}
          </Typography>
          <RequiredSelectWrapper required fullWidth error={fieldErrors.mostSeniorWorkExperience} fieldName={t('profilePage.seniority.mostSeniorWorkExperience')}>
            <Select
              name="mostSeniorWorkExperience"
              labelId="seniority-form-most-senior-label"
              value={formData.mostSeniorWorkExperience}
              onChange={handleChange}
              disabled={loading}
              displayEmpty
              variant="outlined"
            >
              {MOST_SENIOR_OPTIONS.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{mostSeniorLabel(opt.value)}</MenuItem>
              ))}
            </Select>
          </RequiredSelectWrapper>
        </Grid>

        <Grid item xs={12}>
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
            <Button
              type="submit"
              variant="outlined"
              size="small"
              startIcon={<SaveIcon />}
              disabled={loading || !isValid}
            >
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
        </Grid>
      </Grid>

      <Dialog open={showCancelDialog} onClose={() => setShowCancelDialog(false)}>
        <DialogTitle>{t('profilePage.seniorityForm.unsavedDialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('profilePage.seniorityForm.unsavedDialog.description')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCancelDialog(false)} variant="outlined" color="primary">
            {t('profilePage.seniorityForm.unsavedDialog.keepEditing')}
          </Button>
          <Button onClick={executeCancel} variant="contained" color="error">
            {t('profilePage.seniorityForm.unsavedDialog.discardChanges')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SeniorityForm;
