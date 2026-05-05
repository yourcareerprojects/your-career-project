import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  Typography,
  Box,
  Stepper,
  Step,
  StepLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  IconButton,
  InputAdornment,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

const ChangePasswordDialog = ({ open, onClose, onSuccess }) => {
  const { t } = useTranslation('onboarding');
  const { updateUser, user } = useAuth();
  const [step, setStep] = useState('reauth'); // reauth | password | success
  const [currentPassword, setCurrentPassword] = useState('');
  const [reauthToken, setReauthToken] = useState(null);
  const [reauthExpiresAt, setReauthExpiresAt] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [showPasswords, setShowPasswords] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });

  useEffect(() => {
    if (open) {
      setStep(reauthToken ? 'password' : 'reauth');
      setError(null);
      setSuccessMessage('');
    } else {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setReauthToken(null);
      setReauthExpiresAt(null);
      setStep('reauth');
      setError(null);
      setSuccessMessage('');
    }
  }, [open, reauthToken]);

  const timeUntilExpiry = useMemo(() => {
    if (!reauthExpiresAt) return null;
    const diff = new Date(reauthExpiresAt).getTime() - Date.now();
    return diff > 0 ? Math.floor(diff / 1000) : 0;
  }, [reauthExpiresAt]);

  const passwordRules = [
    { id: 'length', label: t('loginSecurity.changePassword.requirements.length'), test: (value) => value.length >= 8 },
    { id: 'uppercase', label: t('loginSecurity.changePassword.requirements.uppercase'), test: (value) => /[A-Z]/.test(value) },
    { id: 'lowercase', label: t('loginSecurity.changePassword.requirements.lowercase'), test: (value) => /[a-z]/.test(value) },
    { id: 'number', label: t('loginSecurity.changePassword.requirements.number'), test: (value) => /\d/.test(value) },
    { id: 'symbol', label: t('loginSecurity.changePassword.requirements.symbol'), test: (value) => /[!@#$%^&*]/.test(value) }
  ];

  const checklist = passwordRules.map((rule) => ({
    ...rule,
    satisfied: rule.test(newPassword)
  }));

  const checklistPassed = checklist.every((rule) => rule.satisfied);

  const handleReauth = async () => {
    if (!currentPassword.trim()) {
      setError(t('loginSecurity.changePassword.errors.currentPasswordRequired'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post('/api/auth/reauth', { currentPassword });
      setReauthToken(res.data.reauthToken);
      setReauthExpiresAt(res.data.expiresAt);
      setStep('password');
      setSuccessMessage('');
    } catch (err) {
      setError(err.response?.data?.error || t('loginSecurity.changePassword.errors.verifyPasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async () => {
    if (!reauthToken) {
      setError(t('loginSecurity.changePassword.errors.reauthBeforeChange'));
      return;
    }
    if (!checklistPassed) {
      setError(t('loginSecurity.changePassword.errors.requirementsNotMet'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('loginSecurity.changePassword.errors.passwordMismatch'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post('/api/auth/password-change', {
        newPassword,
        confirmPassword,
        reauthToken
      });

      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
      }

      if (res.data.lastPasswordChangeAt) {
        updateUser({
          security: {
            ...(user?.security || {}),
            lastPasswordChangeAt: res.data.lastPasswordChangeAt
          }
        });
      }

      setSuccessMessage(res.data.message || t('loginSecurity.changePassword.messages.passwordUpdated'));
      setStep('success');
      setReauthToken(null);
      setReauthExpiresAt(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.error || t('loginSecurity.changePassword.errors.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('loginSecurity.changePassword.title')}</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step === 'reauth' ? 0 : step === 'password' ? 1 : 2} alternativeLabel sx={{ mb: 3 }}>
          <Step>
            <StepLabel>{t('loginSecurity.changePassword.steps.verifyIdentity')}</StepLabel>
          </Step>
          <Step>
            <StepLabel>{t('loginSecurity.changePassword.steps.setNewPassword')}</StepLabel>
          </Step>
          <Step>
            <StepLabel>{t('loginSecurity.changePassword.steps.confirmation')}</StepLabel>
          </Step>
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === 'reauth' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('loginSecurity.changePassword.reauthDescription')}
            </Typography>
            <TextField
              fullWidth
              type={showPasswords.currentPassword ? 'text' : 'password'}
              label={t('loginSecurity.changePassword.fields.currentPassword')}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="button"
                      aria-label={showPasswords.currentPassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                      aria-pressed={showPasswords.currentPassword}
                      onClick={() =>
                        setShowPasswords((prev) => ({
                          ...prev,
                          currentPassword: !prev.currentPassword,
                        }))
                      }
                      edge="end"
                      disabled={loading}
                    >
                      {showPasswords.currentPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        )}

        {step === 'password' && (
          <Box>
            {timeUntilExpiry !== null && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('loginSecurity.changePassword.reauthValidFor', { seconds: timeUntilExpiry })}
              </Alert>
            )}
            <TextField
              fullWidth
              type={showPasswords.newPassword ? 'text' : 'password'}
              label={t('loginSecurity.changePassword.fields.newPassword')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loading}
              sx={{ mb: 2 }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="button"
                      aria-label={showPasswords.newPassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                      aria-pressed={showPasswords.newPassword}
                      onClick={() =>
                        setShowPasswords((prev) => ({ ...prev, newPassword: !prev.newPassword }))
                      }
                      edge="end"
                      disabled={loading}
                    >
                      {showPasswords.newPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              fullWidth
              type={showPasswords.confirmPassword ? 'text' : 'password'}
              label={t('loginSecurity.changePassword.fields.confirmNewPassword')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="button"
                      aria-label={showPasswords.confirmPassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                      aria-pressed={showPasswords.confirmPassword}
                      onClick={() =>
                        setShowPasswords((prev) => ({
                          ...prev,
                          confirmPassword: !prev.confirmPassword,
                        }))
                      }
                      edge="end"
                      disabled={loading}
                    >
                      {showPasswords.confirmPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              {t('loginSecurity.changePassword.requirements.title')}
            </Typography>
            <List dense>
              {checklist.map((rule) => (
                <ListItem key={rule.id} sx={{ py: 0.5 }}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    {rule.satisfied ? (
                      <CheckCircleIcon fontSize="small" color="success" />
                    ) : (
                      <RadioButtonUncheckedIcon fontSize="small" color="disabled" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={rule.label}
                    primaryTypographyProps={{
                      variant: 'body2',
                      color: rule.satisfied ? 'text.primary' : 'text.secondary'
                    }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {step === 'success' && (
          <Alert severity="success">
            {successMessage || t('loginSecurity.changePassword.messages.updatedSignedOutOthers')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {step === 'success' ? t('profilePage.actions.close') : t('profilePage.actions.cancel')}
        </Button>
        {step === 'reauth' && (
          <Button onClick={handleReauth} variant="contained" disabled={loading || !currentPassword.trim()}>
            {loading ? <CircularProgress size={20} /> : t('loginSecurity.changePassword.actions.verifyPassword')}
          </Button>
        )}
        {step === 'password' && (
          <Button
            onClick={handlePasswordUpdate}
            variant="contained"
            disabled={loading || !checklistPassed || newPassword !== confirmPassword}
          >
            {loading ? <CircularProgress size={20} /> : t('loginSecurity.changePassword.actions.updatePassword')}
          </Button>
        )}
        {step === 'success' && (
          <Button onClick={handleClose} variant="contained">
            {t('loginSecurity.changePassword.actions.done')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ChangePasswordDialog;

