import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Alert, Box, Button, CircularProgress, Container, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

const VerifyEmail = () => {
  const { t } = useTranslation('common');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { isAuthenticated, resendVerificationEmail } = useAuth();
  const [status, setStatus] = useState(token ? 'pending' : 'invalid');
  const [message, setMessage] = useState('');
  const [resendMessage, setResendMessage] = useState('');
  const lastVerifiedTokenRef = useRef('');

  useEffect(() => {
    const verify = async () => {
      if (!token) return;
      // Guard against React.StrictMode double effect invocation in development.
      if (lastVerifiedTokenRef.current === token) return;
      lastVerifiedTokenRef.current = token;
      try {
        const response = await axios.get('/api/auth/verify-email', { params: { token } });
        const state = response.data?.state || 'verified';
        setStatus(state);
        setMessage(
          state === 'already_verified'
            ? t('verifyEmail.messages.alreadyVerified')
            : t('verifyEmail.messages.verified')
        );
      } catch (error) {
        const state = error.response?.data?.state || 'invalid';
        setStatus(state);
        setMessage(error.response?.data?.error || t('verifyEmail.messages.failed'));
      }
    };
    verify();
  }, [token, t]);

  const severity = useMemo(() => {
    if (status === 'verified' || status === 'already_verified') return 'success';
    if (status === 'expired') return 'warning';
    return 'error';
  }, [status]);

  const handleResend = async () => {
    const result = await resendVerificationEmail();
    setResendMessage(
      result.success
        ? (result.message || t('verifyEmail.messages.resent'))
        : (result.error || t('verifyEmail.messages.unableToResend'))
    );
  };

  return (
    <Container maxWidth="sm">
      <Box sx={{ mt: 8 }}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('verifyEmail.title')}
          </Typography>
          {status === 'pending' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography>{t('verifyEmail.verifying')}</Typography>
            </Box>
          ) : (
            <Alert severity={severity}>{message}</Alert>
          )}
          {(status === 'expired' || status === 'invalid') && isAuthenticated && (
            <Button sx={{ mt: 2 }} variant="contained" onClick={handleResend}>
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
