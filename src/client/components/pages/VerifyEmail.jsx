import React, { useRef, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Alert, Box, Button, CircularProgress, Container, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

const getVerificationMessageKey = (state, hasToken) => {
  switch (state) {
    case 'verified':
      return 'verifyEmail.messages.verified';
    case 'already_verified':
      return 'verifyEmail.messages.alreadyVerified';
    case 'expired':
      return 'verifyEmail.messages.expired';
    case 'invalid':
      return hasToken ? 'verifyEmail.messages.invalid' : 'verifyEmail.messages.missingToken';
    default:
      return 'verifyEmail.messages.failed';
  }
};

const VerifyEmail = () => {
  const { t } = useTranslation('common');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { refreshUser, resendVerificationEmail } = useAuth();
  const [status, setStatus] = useState(token ? 'idle' : 'invalid');
  const [resendMessage, setResendMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const attemptedTokenRef = useRef(null);
  const activeVerificationRequestIdRef = useRef(0);
  const verificationMessage = t(getVerificationMessageKey(status, Boolean(token)));

  const severity = status === 'verified'
    ? 'success'
    : status === 'already_verified'
      ? 'info'
      : status === 'expired'
        ? 'warning'
        : 'error';

  const handleVerify = async () => {
    if (!token || isSubmitting || attemptedTokenRef.current === token) return;

    attemptedTokenRef.current = token;
    const requestId = activeVerificationRequestIdRef.current + 1;
    activeVerificationRequestIdRef.current = requestId;
    setIsSubmitting(true);
    setResendMessage('');

    try {
      const response = await axios.post('/api/auth/verify-email', { token });
      if (activeVerificationRequestIdRef.current !== requestId) return;

      const state = response.data?.state || 'verified';
      if (state === 'verified' || state === 'already_verified') {
        await refreshUser();
        if (activeVerificationRequestIdRef.current !== requestId) return;
      }
      setStatus(state);
    } catch (error) {
      if (activeVerificationRequestIdRef.current !== requestId) return;

      const responseState = error.response?.data?.state;
      const nextStatus = responseState === 'expired' || responseState === 'invalid'
        ? responseState
        : 'error';
      setStatus(nextStatus);
    } finally {
      if (activeVerificationRequestIdRef.current === requestId) {
        setIsSubmitting(false);
      }
    }
  };

  const handleResend = async () => {
    if (isResending) return;

    setIsResending(true);
    try {
      const result = await resendVerificationEmail(token ? { token } : undefined);
      setResendMessage(
        result.success
          ? (result.message || t('verifyEmail.messages.resent'))
          : (result.error || t('verifyEmail.messages.unableToResend'))
      );
    } finally {
      setIsResending(false);
    }
  };

  return (
    <Container maxWidth="sm">
      <Box sx={{ mt: 8 }}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('verifyEmail.title')}
          </Typography>
          {status === 'idle' && (
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t('verifyEmail.instructions')}
            </Typography>
          )}
          {status !== 'idle' && (
            <Alert severity={severity}>
              {verificationMessage}
            </Alert>
          )}
          {token && status === 'idle' && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Button
                variant="contained"
                color="primary"
                size="large"
                onClick={handleVerify}
                disabled={isSubmitting}
                sx={{
                  fontWeight: 600,
                  px: 3,
                  py: 1.5,
                  fontSize: '1rem',
                  minWidth: 220,
                }}
              >
                {isSubmitting ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={18} color="inherit" />
                    <span>{t('verifyEmail.verifying')}</span>
                  </Box>
                ) : (
                  t('verifyEmail.actions.verify')
                )}
              </Button>
            </Box>
          )}
          {(status === 'verified' || status === 'already_verified') && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Button
                component={RouterLink}
                to="/"
                variant="contained"
                color="primary"
                size="large"
                startIcon={<ArrowForwardIcon />}
                sx={{
                  fontWeight: 600,
                  px: 3,
                  py: 1.5,
                  fontSize: '1rem',
                }}
              >
                {t('verifyEmail.actions.start')}
              </Button>
            </Box>
          )}
          {status === 'expired' && (
            <Button sx={{ mt: 2 }} variant="contained" onClick={handleResend} disabled={isResending}>
              {t('verifyEmail.actions.resendVerificationEmail')}
            </Button>
          )}
          {resendMessage && (
            <Alert sx={{ mt: 2 }} severity="info">
              {resendMessage}
            </Alert>
          )}
        </Paper>
      </Box>
    </Container>
  );
};

export default VerifyEmail;
