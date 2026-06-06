import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MailOutlineIcon from '@mui/icons-material/MailOutline';

const ForgotPassword = () => {
  const { t } = useTranslation('onboarding');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const validateEmail = () => {
    if (!email.trim()) {
      setError(t('forgotPassword.errors.emailRequired'));
      return false;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError(t('forgotPassword.errors.emailInvalid'));
      return false;
    }
    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!validateEmail()) {
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post('/api/auth/request-password-reset', { email: email.trim() });
      setSuccessMessage(response.data?.message || t('forgotPassword.messages.emailSent'));
    } catch (submitError) {
      const apiError = submitError.response?.data?.error
        || submitError.response?.data?.errors?.[0]?.msg
        || t('forgotPassword.errors.unexpected');
      setError(apiError);
    } finally {
      setLoading(false);
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
          <Typography component="h1" variant="h5" gutterBottom>
            {t('forgotPassword.title')}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
            {t('forgotPassword.description')}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ width: '100%', mb: 2 }}>
              {error}
            </Alert>
          )}

          {successMessage && (
            <Alert severity="success" sx={{ width: '100%', mb: 2 }}>
              {successMessage}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1, width: '100%' }}>
            <TextField
              margin="normal"
              required
              fullWidth
              id="email"
              label={t('forgotPassword.emailLabel')}
              name="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError('');
              }}
              disabled={loading || Boolean(successMessage)}
            />
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, mb: 2, width: '100%' }}>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                size="medium"
                startIcon={loading ? undefined : <MailOutlineIcon />}
                sx={{
                  fontWeight: 600,
                  px: 3,
                  py: 1.5,
                  fontSize: '1rem',
                }}
                disabled={loading || Boolean(successMessage)}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : t('forgotPassword.submitCta')}
              </Button>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
              <Button
                component={RouterLink}
                to="/login"
                variant="text"
                startIcon={<ArrowBackIcon />}
              >
                {t('forgotPassword.backToLogin')}
              </Button>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default ForgotPassword;
