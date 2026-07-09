import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Typography,
} from '@mui/material';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../common/PageHeader';

const CheckEmail = () => {
  const { t } = useTranslation(['onboarding', 'common']);
  const { user, isAuthenticated, loading, resendVerificationEmail } = useAuth();
  const [resendMessage, setResendMessage] = useState('');
  const [isResending, setIsResending] = useState(false);

  if (loading) {
    return (
      <Container component="main" maxWidth="xs">
        <Box sx={{ mt: 8, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('common:app.loading')}</Typography>
        </Box>
      </Container>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.isVerified || user?.emailVerified) {
    return <Navigate to="/" replace />;
  }

  const displayName = user?.name?.trim() || t('checkEmail.fallbackName');

  const handleResend = async () => {
    if (isResending) return;

    setIsResending(true);
    setResendMessage('');
    try {
      const result = await resendVerificationEmail();
      setResendMessage(
        result.success
          ? t('common:emailVerification.resendNotice')
          : (result.error || t('checkEmail.messages.unableToResend'))
      );
    } finally {
      setIsResending(false);
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper
          elevation={3}
          sx={{
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <MailOutlineIcon color="primary" sx={{ fontSize: 48, mb: 2 }} />

          <PageHeader
            title={t('checkEmail.greeting', { name: displayName })}
            description={t('checkEmail.message')}
          />

          {user?.email && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 2 }}>
              {t('checkEmail.emailSentTo', { email: user.email })}
            </Typography>
          )}

          {resendMessage && (
            <Alert severity="info" sx={{ width: '100%', mb: 2 }}>
              {resendMessage}
            </Alert>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', mt: 1 }}>
            <Button
              variant="text"
              size="small"
              onClick={handleResend}
              disabled={isResending}
              sx={{
                textTransform: 'none',
                fontWeight: 500,
                color: 'var(--color-primary)',
                '&:hover': {
                  color: 'var(--color-primary-hover)',
                  bgcolor: 'transparent',
                },
              }}
            >
              {isResending ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                t('checkEmail.resendCta')
              )}
            </Button>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default CheckEmail;
