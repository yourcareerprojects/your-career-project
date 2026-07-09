import React, { useCallback, useRef, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useAuth } from '../../contexts/AuthContext';
import {
  handlePasswordVisibilityMouseDown,
  syncControlledPasswordInput,
} from '../../utils/passwordVisibility';
import PageHeader from '../common/PageHeader';

/** Mirrors server `src/server/routes/auth.js` passwordValidation rules */
function validatePasswordPolicy(password, t) {
  if (!password) return t('register.errors.passwordRequired');
  if (password.length < 8) return t('register.errors.passwordMinLength');
  if (!/\d/.test(password)) return t('register.errors.passwordNeedsNumber');
  if (!/[a-z]/.test(password)) return t('register.errors.passwordNeedsLowercase');
  if (!/[A-Z]/.test(password)) return t('register.errors.passwordNeedsUppercase');
  if (!/[!@#$%^&*]/.test(password)) {
    return t('register.errors.passwordNeedsSpecial');
  }
  return '';
}

const Register = () => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showPasswords, setShowPasswords] = useState({
    password: false,
    confirmPassword: false,
  });
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);

  const togglePasswordVisibility = useCallback((field, inputRef) => {
    const el = inputRef.current;
    if (el) {
      syncControlledPasswordInput(field, el.value, setFormData);
    }
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  }, []);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name?.trim()) {
      newErrors.name = t('register.errors.nameRequired');
    } else if (formData.name.trim().length < 2) {
      newErrors.name = t('register.errors.nameMinLength');
    }

    if (!formData.email) {
      newErrors.email = t('register.errors.emailRequired');
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = t('register.errors.emailInvalid');
    }

    const passwordError = validatePasswordPolicy(formData.password, t);
    if (passwordError) {
      newErrors.password = passwordError;
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = t('register.errors.confirmPasswordRequired');
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = t('register.errors.passwordMismatch');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => (prev[name] === value ? prev : { ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const { name, email, password } = formData;
      const result = await register({ name: name.trim(), email, password });

      if (result.success) {
        navigate('/check-email');
      } else {
        setSubmitError(result.error);
      }
    } catch (error) {
      setSubmitError(t('register.errors.unexpected'));
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
          <PageHeader title={t('register.title')} description={t('register.subtitle')} />

          {submitError && (
            <Alert severity="error" sx={{ width: '100%', mb: 2 }}>
              {submitError}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1, width: '100%' }}>
            <TextField
              margin="normal"
              required
              fullWidth
              id="name"
              label={t('register.nameLabel')}
              name="name"
              autoComplete="name"
              autoFocus
              value={formData.name}
              onChange={handleChange}
              error={!!errors.name}
              helperText={errors.name}
              disabled={loading}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              id="email"
              label={t('register.emailLabel')}
              name="email"
              autoComplete="email"
              value={formData.email}
              onChange={handleChange}
              error={!!errors.email}
              helperText={errors.email}
              disabled={loading}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              name="password"
              label={t('register.passwordLabel')}
              type={showPasswords.password ? 'text' : 'password'}
              id="password"
              autoComplete="new-password"
              inputRef={passwordRef}
              value={formData.password}
              onChange={handleChange}
              onInput={handleChange}
              onBlur={handleBlur}
              error={!!errors.password}
              helperText={errors.password || t('register.passwordPolicyHint')}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="button"
                      aria-label={showPasswords.password ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                      aria-pressed={showPasswords.password}
                      onClick={() => togglePasswordVisibility('password', passwordRef)}
                      onMouseDown={handlePasswordVisibilityMouseDown}
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
              label={t('register.confirmPasswordLabel')}
              type={showPasswords.confirmPassword ? 'text' : 'password'}
              id="confirmPassword"
              autoComplete="new-password"
              inputRef={confirmPasswordRef}
              value={formData.confirmPassword}
              onChange={handleChange}
              onInput={handleChange}
              onBlur={handleBlur}
              error={!!errors.confirmPassword}
              helperText={errors.confirmPassword}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="button"
                      aria-label={showPasswords.confirmPassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                      aria-pressed={showPasswords.confirmPassword}
                      onClick={() => togglePasswordVisibility('confirmPassword', confirmPasswordRef)}
                      onMouseDown={handlePasswordVisibilityMouseDown}
                      edge="end"
                      disabled={loading}
                    >
                      {showPasswords.confirmPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                mt: 3,
                width: '100%',
              }}
            >
              <Button
                type="submit"
                variant="contained"
                color="primary"
                size="medium"
                startIcon={loading ? undefined : <ArrowForwardIcon />}
                sx={{
                  fontWeight: 600,
                  px: 3,
                  py: 1.5,
                  fontSize: '1rem',
                  width: { xs: '100%', sm: 'auto' },
                }}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : t('register.submitCta')}
              </Button>
              <Button
                component={RouterLink}
                to="/login"
                variant="outlined"
                size="medium"
                sx={{
                  fontWeight: 600,
                  px: 3,
                  py: 1.5,
                  fontSize: '1rem',
                  width: { xs: '100%', sm: 'auto' },
                }}
              >
                {t('register.loginPrompt')}
              </Button>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default Register;
