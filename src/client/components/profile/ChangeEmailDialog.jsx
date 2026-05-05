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
  CircularProgress,
  Chip,
  IconButton,
  InputAdornment
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import axios from 'axios';
import { useTranslation } from 'react-i18next';

const formatTimeLeft = (ms, t) => {
  if (ms <= 0) return t('loginSecurity.changeEmail.time.expired');
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return t('loginSecurity.changeEmail.time.minutesSeconds', { minutes, seconds });
};

// Email format validation
const validateEmailFormat = (email, t) => {
  if (!email || !email.trim()) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return t('loginSecurity.changeEmail.errors.validEmail');
  }
  return null;
};

const ChangeEmailDialog = ({ open, onClose, pendingChange, onSuccess, currentEmail }) => {
  const { t } = useTranslation('onboarding');
  const [step, setStep] = useState('reauth'); // reauth | email | pending
  const [currentPassword, setCurrentPassword] = useState('');
  const [reauthToken, setReauthToken] = useState(null);
  const [reauthExpiresAt, setReauthExpiresAt] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [localPending, setLocalPending] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [emailErrors, setEmailErrors] = useState({ newEmail: null, confirmEmail: null });
  const [touched, setTouched] = useState({ newEmail: false, confirmEmail: false });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);

  // Track if user is starting a new flow (after reauthentication)
  const [isNewFlow, setIsNewFlow] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setInfoMessage('');
      setIsNewFlow(false);
      // When opening, prioritize pending change if it exists, otherwise check reauth state
      if (pendingChange) {
        setStep('pending');
      } else {
        setStep(reauthToken ? 'email' : 'reauth');
      }
    } else {
      resetState();
    }
  }, [open, pendingChange, reauthToken]);

  useEffect(() => {
    setLocalPending(pendingChange || null);
    
    // If user just started a new flow (reauthenticated), don't jump to pending
    // even if there's a pendingChange from before - let them enter new email first
    if (isNewFlow && reauthToken) {
      setStep('email');
      return;
    }
    
    // Otherwise, handle pending change normally
    if (pendingChange) {
      setVerificationCode('');
      setStep('pending');
    } else {
      setVerificationCode('');
      if (reauthToken) {
        setStep('email');
      } else {
        setStep('reauth');
      }
    }
  }, [pendingChange, reauthToken, isNewFlow]);

  const timeRemaining = useMemo(() => {
    if (!localPending?.expiresAt) return null;
    return new Date(localPending.expiresAt).getTime() - Date.now();
  }, [localPending]);

  const resendTimeRemaining = useMemo(() => {
    if (!localPending?.resendAvailableAt) return 0;
    return Math.max(0, new Date(localPending.resendAvailableAt).getTime() - Date.now());
  }, [localPending]);

  useEffect(() => {
    if (!open || !localPending?.expiresAt) return undefined;
    const interval = setInterval(() => {
      setLocalPending((prev) =>
        prev
          ? {
              ...prev
            }
          : null
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [open, localPending?.expiresAt]);

  const resetState = () => {
    setCurrentPassword('');
    setReauthToken(null);
    setReauthExpiresAt(null);
    setNewEmail('');
    setConfirmEmail('');
    setLocalPending(null);
    setLoading(false);
    setError(null);
    setInfoMessage('');
    setVerificationCode('');
    setEmailErrors({ newEmail: null, confirmEmail: null });
    setTouched({ newEmail: false, confirmEmail: false });
    setIsNewFlow(false);
    setStep('reauth');
  };

  const handleReauth = async () => {
    if (!currentPassword.trim()) {
      setError(t('loginSecurity.changeEmail.errors.currentPasswordRequired'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post('/api/auth/reauth', { currentPassword });
      setReauthToken(res.data.reauthToken);
      setReauthExpiresAt(res.data.expiresAt);
      setIsNewFlow(true); // Mark that user is starting a new flow
      setStep('email'); // Explicitly set to email step
    } catch (err) {
      setError(err.response?.data?.error || t('loginSecurity.changeEmail.errors.verifyPasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Validate email fields in real-time
  useEffect(() => {
    const errors = {};
    
    if (touched.newEmail || newEmail.trim()) {
      const formatError = validateEmailFormat(newEmail, t);
      if (formatError) {
        errors.newEmail = formatError;
      } else if (currentEmail && newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) {
        errors.newEmail = t('loginSecurity.changeEmail.errors.newEmailMustDiffer');
      }
    }
    
    if (touched.confirmEmail || confirmEmail.trim()) {
      const formatError = validateEmailFormat(confirmEmail, t);
      if (formatError) {
        errors.confirmEmail = formatError;
      } else if (newEmail.trim() && confirmEmail.trim() && 
                 newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
        errors.confirmEmail = t('loginSecurity.changeEmail.errors.emailMismatch');
      }
    }
    
    setEmailErrors(errors);
  }, [newEmail, confirmEmail, touched, currentEmail]);

  const handleSubmitNewEmail = async () => {
    if (!reauthToken) {
      setError(t('loginSecurity.changeEmail.errors.reauthBeforeContinue'));
      return;
    }
    
    // Mark fields as touched to show all errors
    setTouched({ newEmail: true, confirmEmail: true });
    
    // Check for validation errors
    const newEmailError = validateEmailFormat(newEmail, t);
    const confirmEmailError = validateEmailFormat(confirmEmail, t);
    
    if (!newEmail.trim() || !confirmEmail.trim()) {
      setError(t('loginSecurity.changeEmail.errors.emailAndConfirmationRequired'));
      return;
    }
    
    if (newEmailError) {
      setError(newEmailError);
      return;
    }
    
    if (confirmEmailError) {
      setError(confirmEmailError);
      return;
    }
    
    if (newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setError(t('loginSecurity.changeEmail.errors.emailMismatch'));
      return;
    }
    
    if (currentEmail && newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) {
      setError(t('loginSecurity.changeEmail.errors.newEmailMustDiffer'));
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post('/api/auth/email-change', {
        newEmail,
        confirmEmail,
        reauthToken
      });
      setLocalPending(res.data.pendingEmailChange);
      setIsNewFlow(false); // Flow completed, no longer a new flow
      setStep('pending');
      setVerificationCode('');
      setInfoMessage(t('loginSecurity.changeEmail.messages.verificationSent'));
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.error || t('loginSecurity.changeEmail.errors.submitFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPending = async () => {
    setLoading(true);
    setError(null);
    try {
      await axios.delete('/api/auth/email-change');
      setLocalPending(null);
      setInfoMessage(t('loginSecurity.changeEmail.messages.pendingCancelled'));
      setVerificationCode('');
      setReauthToken(null);
      setReauthExpiresAt(null);
      setStep('reauth');
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.error || t('loginSecurity.changeEmail.errors.cancelPendingFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post('/api/auth/email-change/resend');
      setLocalPending(res.data.pendingEmailChange);
      setVerificationCode('');
      setInfoMessage(t('loginSecurity.changeEmail.messages.verificationResent'));
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.error || t('loginSecurity.changeEmail.errors.resendFailed'));
    } finally {
      setLoading(false);
    }
  };

  const friendlyCodeErrors = {
    code_invalid: t('loginSecurity.changeEmail.friendlyCodeErrors.codeInvalid'),
    code_expired: t('loginSecurity.changeEmail.friendlyCodeErrors.codeExpired'),
    attempts_exceeded: t('loginSecurity.changeEmail.friendlyCodeErrors.attemptsExceeded'),
    reauth_required: t('loginSecurity.changeEmail.friendlyCodeErrors.reauthRequired'),
    request_not_found: t('loginSecurity.changeEmail.friendlyCodeErrors.requestNotFound')
  };

  const handleVerifyCode = async () => {
    const normalizedCode = verificationCode.replace(/\D/g, '').slice(0, 6);
    if (normalizedCode.length !== 6) {
      setError(t('loginSecurity.changeEmail.errors.enterSixDigitCode'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await axios.post('/api/auth/email-change/verify', { code: normalizedCode });
      setInfoMessage(t('loginSecurity.changeEmail.messages.emailUpdated'));
      setLocalPending(null);
      setVerificationCode('');
      setReauthToken(null);
      setReauthExpiresAt(null);
      setCurrentPassword('');
      setStep('reauth');
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      const serverCode = err.response?.data?.code;
      const attempts = err.response?.data?.attemptsRemaining;
      setError(friendlyCodeErrors[serverCode] || err.response?.data?.error || t('loginSecurity.changeEmail.errors.verifyCodeFailed'));
      if (typeof attempts === 'number') {
        setLocalPending((prev) => (prev ? { ...prev, attemptsRemaining: attempts } : prev));
      }
      if (serverCode && ['attempts_exceeded', 'code_expired', 'reauth_required', 'request_not_found'].includes(serverCode)) {
        setLocalPending(null);
        setVerificationCode('');
        setStep('reauth');
      }
      if (serverCode && ['attempts_exceeded', 'code_expired', 'reauth_required', 'request_not_found'].includes(serverCode) && onSuccess) {
        onSuccess();
      }
    } finally {
      setLoading(false);
    }
  };

  const renderPendingState = () => {
    if (!localPending) return null;
    const attemptsRemaining = typeof localPending.attemptsRemaining === 'number'
      ? localPending.attemptsRemaining
      : null;
    const maxAttempts = typeof localPending.maxAttempts === 'number' ? localPending.maxAttempts : null;
    const resendSeconds = Math.ceil(resendTimeRemaining / 1000);
    const codeHelper =
      attemptsRemaining !== null && maxAttempts !== null
        ? t('loginSecurity.changeEmail.pending.attemptsRemaining', { current: attemptsRemaining, max: maxAttempts })
        : t('loginSecurity.changeEmail.pending.codeHelper');
    return (
      <Box>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('loginSecurity.changeEmail.pending.enterCodeForEmail', { email: localPending.newEmail })}
        </Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('loginSecurity.changeEmail.pending.expiresIn')}: {timeRemaining !== null ? formatTimeLeft(timeRemaining, t) : t('loginSecurity.changeEmail.pending.unknown')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('loginSecurity.changeEmail.pending.requestedAt')}: {localPending.requestedAt ? new Date(localPending.requestedAt).toLocaleString() : t('loginSecurity.changeEmail.pending.notAvailable')}
        </Typography>
        <TextField
          fullWidth
          label={t('loginSecurity.changeEmail.fields.verificationCode')}
          value={verificationCode}
          onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={loading}
          inputProps={{
            inputMode: 'numeric',
            pattern: '[0-9]*',
            maxLength: 6,
            style: { letterSpacing: '0.5rem', textAlign: 'center', fontSize: '1.5rem', fontFamily: 'monospace' }
          }}
          sx={{ mb: 2 }}
          helperText={codeHelper}
        />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            disabled={loading || resendTimeRemaining > 0}
            onClick={handleResendVerification}
          >
            {loading ? (
              <CircularProgress size={20} />
            ) : resendTimeRemaining > 0 ? (
              t('loginSecurity.changeEmail.actions.resendIn', { seconds: resendSeconds })
            ) : (
              t('loginSecurity.changeEmail.actions.resendCode')
            )}
          </Button>
          <Button variant="outlined" color="secondary" disabled={loading} onClick={handleCancelPending}>
            {t('loginSecurity.changeEmail.actions.cancelRequest')}
          </Button>
        </Box>
      </Box>
    );
  };

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('loginSecurity.changeEmail.title')}</DialogTitle>
      <DialogContent dividers>
        <Stepper
          activeStep={
            step === 'reauth' ? 0 :
            step === 'email' ? 1 :
            2
          }
          alternativeLabel
          sx={{ mb: 3 }}
        >
          <Step>
            <StepLabel>{t('loginSecurity.changeEmail.steps.verifyIdentity')}</StepLabel>
          </Step>
          <Step>
            <StepLabel>{t('loginSecurity.changeEmail.steps.newEmail')}</StepLabel>
          </Step>
          <Step>
            <StepLabel>{t('loginSecurity.changeEmail.steps.enterCode')}</StepLabel>
          </Step>
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {infoMessage && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {infoMessage}
          </Alert>
        )}

        {step === 'reauth' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('loginSecurity.changeEmail.reauthDescription')}
            </Typography>
            <TextField
              type={showCurrentPassword ? 'text' : 'password'}
              fullWidth
              label={t('loginSecurity.changeEmail.fields.currentPassword')}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="button"
                      aria-label={showCurrentPassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                      aria-pressed={showCurrentPassword}
                      onClick={() => setShowCurrentPassword((v) => !v)}
                      edge="end"
                      disabled={loading}
                    >
                      {showCurrentPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />
          </Box>
        )}

        {step === 'email' && (
          <Box>
            {currentEmail && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>{t('loginSecurity.changeEmail.currentEmailLabel')}</strong> {currentEmail}
                </Typography>
              </Alert>
            )}
            {pendingChange && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  {t('loginSecurity.changeEmail.pending.existingPending', { email: pendingChange.newEmail })}
                </Typography>
              </Alert>
            )}
            {reauthExpiresAt && (
              <Chip
                label={t('loginSecurity.changeEmail.reauthValidUntil', { time: new Date(reauthExpiresAt).toLocaleTimeString() })}
                color="info"
                variant="outlined"
                sx={{ mb: 2 }}
              />
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('loginSecurity.changeEmail.emailStepDescription')}
            </Typography>
            <TextField
              fullWidth
              type="email"
              label={t('loginSecurity.changeEmail.fields.newEmail')}
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setTouched(prev => ({ ...prev, newEmail: true }));
              }}
              onBlur={() => setTouched(prev => ({ ...prev, newEmail: true }))}
              disabled={loading}
              error={!!emailErrors.newEmail}
              helperText={emailErrors.newEmail || ''}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="email"
              label={t('loginSecurity.changeEmail.fields.confirmNewEmail')}
              value={confirmEmail}
              onChange={(e) => {
                setConfirmEmail(e.target.value);
                setTouched(prev => ({ ...prev, confirmEmail: true }));
              }}
              onBlur={() => setTouched(prev => ({ ...prev, confirmEmail: true }))}
              disabled={loading}
              error={!!emailErrors.confirmEmail}
              helperText={emailErrors.confirmEmail || ''}
            />
          </Box>
        )}

        {step === 'pending' && renderPendingState()}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {t('profilePage.actions.close')}
        </Button>
        {step === 'reauth' && (
          <Button onClick={handleReauth} variant="contained" disabled={loading || !currentPassword.trim()}>
            {loading ? <CircularProgress size={20} /> : t('loginSecurity.changeEmail.actions.verifyPassword')}
          </Button>
        )}
        {step === 'email' && (
          <Button
            onClick={handleSubmitNewEmail}
            variant="contained"
            disabled={
              loading ||
              !newEmail.trim() ||
              !confirmEmail.trim() ||
              !!emailErrors.newEmail ||
              !!emailErrors.confirmEmail ||
              newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase() ||
              (currentEmail && newEmail.trim().toLowerCase() === currentEmail.toLowerCase())
            }
          >
            {loading ? <CircularProgress size={20} /> : t('loginSecurity.changeEmail.actions.sendVerificationCode')}
          </Button>
        )}
        {step === 'pending' && (
          <Button
            onClick={handleVerifyCode}
            variant="contained"
            disabled={loading || verificationCode.length !== 6}
          >
            {loading ? <CircularProgress size={20} /> : t('loginSecurity.changeEmail.actions.verifyCode')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ChangeEmailDialog;

