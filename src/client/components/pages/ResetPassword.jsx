import React, { useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

const ResetPassword = () => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token: routeToken } = useParams();
  const token = String(searchParams.get('token') || routeToken || '').trim();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const hasSubmittedRef = useRef(false);
  const activeRequestIdRef = useRef(0);
  const [showPasswords, setShowPasswords] = useState({
    password: false,
    confirmPassword: false,
  });

  const passwordRules = useMemo(() => ([
    { id: 'length', label: t('loginSecurity.changePassword.requirements.length'), test: (value) => value.length >= 8 },
    { id: 'uppercase', label: t('loginSecurity.changePassword.requirements.uppercase'), test: (value) => /[A-Z]/.test(value) },
    { id: 'lowercase', label: t('loginSecurity.changePassword.requirements.lowercase'), test: (value) => /[a-z]/.test(value) },
    { id: 'number', label: t('loginSecurity.changePassword.requirements.number'), test: (value) => /\d/.test(value) },
    { id: 'symbol', label: t('loginSecurity.changePassword.requirements.symbol'), test: (value) => /[!@#$%^&*]/.test(value) },
  ]), [t]);

  const checklist = passwordRules.map((rule) => ({
    ...rule,
    satisfied: rule.test(password),
  }));
  const checklistPassed = checklist.every((rule) => rule.satisfied);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading || successMessage || hasSubmittedRef.current) {
      return;
    }

    setError('');
    setSuccessMessage('');

    if (!token) {
      setError(t('resetPassword.errors.missingToken'));
      return;
    }
    if (!checklistPassed) {
      setError(t('resetPassword.errors.requirementsNotMet'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('resetPassword.errors.passwordMismatch'));
      return;
    }

    hasSubmittedRef.current = true;
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const response = await axios.post('/api/auth/reset-password', {
        token,
        password,
      });
      if (activeRequestIdRef.current !== requestId) return;

      setSuccessMessage(response.data?.message || t('resetPassword.messages.success'));
    } catch (submitError) {
      if (activeRequestIdRef.current !== requestId) return;

      hasSubmittedRef.current = false;
      const apiError = submitError.response?.data?.error
        || submitError.response?.data?.errors?.[0]?.msg
        || t('resetPassword.errors.unexpected');
      setError(apiError);
    } finally {
      if (activeRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  if (!token) {
    return (
      <Container component="main" maxWidth="xs">
        <Box sx={{ marginTop: 8 }}>
          <Paper sx={{ p: 4 }}>
            <Alert severity="error" sx={{ mb: 2 }}>
              {t('resetPassword.errors.missingToken')}
            </Alert>
            <Button component={RouterLink} to="/forgot-password" variant="contained">
              {t('resetPassword.actions.requestNewLink')}
            </Button>
          </Paper>
        </Box>
      </Container>
    );
  }

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
            {t('resetPassword.title')}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
            {t('resetPassword.description')}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ width: '100%', mb: 2 }}>
              {error}
            </Alert>
          )}

          {successMessage ? (
            <>
              <Alert severity="success" sx={{ width: '100%', mb: 2 }}>
                {successMessage}
              </Alert>
              <Button
                variant="contained"
                color="primary"
                size="large"
                startIcon={<ArrowForwardIcon />}
                onClick={() => navigate('/login')}
                sx={{ fontWeight: 600, px: 3, py: 1.5 }}
              >
                {t('resetPassword.actions.goToLogin')}
              </Button>
            </>
          ) : (
            <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1, width: '100%' }}>
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label={t('resetPassword.passwordLabel')}
                type={showPasswords.password ? 'text' : 'password'}
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        type="button"
                        aria-label={showPasswords.password ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                        onClick={() => setShowPasswords((prev) => ({ ...prev, password: !prev.password }))}
                        edge="end"
                        disabled={loading}
                      >
                        {showPasswords.password ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                name="confirmPassword"
                label={t('resetPassword.confirmPasswordLabel')}
                type={showPasswords.confirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={loading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        type="button"
                        aria-label={showPasswords.confirmPassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                        onClick={() => setShowPasswords((prev) => ({ ...prev, confirmPassword: !prev.confirmPassword }))}
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
              <List dense disablePadding>
                {checklist.map((rule) => (
                  <ListItem key={rule.id} disableGutters sx={{ py: 0.25 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      {rule.satisfied ? (
                        <CheckCircleIcon color="success" fontSize="small" />
                      ) : (
                        <RadioButtonUncheckedIcon color="disabled" fontSize="small" />
                      )}
                    </ListItemIcon>
                    <ListItemText primary={rule.label} />
                  </ListItem>
                ))}
              </List>

              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, mb: 2, width: '100%' }}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="medium"
                  sx={{ fontWeight: 600, px: 3, py: 1.5, fontSize: '1rem' }}
                  disabled={loading}
                >
                  {loading ? <CircularProgress size={24} color="inherit" /> : t('resetPassword.submitCta')}
                </Button>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                <Button component={RouterLink} to="/forgot-password" variant="text">
                  {t('resetPassword.actions.requestNewLink')}
                </Button>
              </Box>
            </Box>
          )}
        </Paper>
      </Box>
    </Container>
  );
};

export default ResetPassword;
