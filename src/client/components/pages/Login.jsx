import React, { useCallback, useRef, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Box,
  TextField,
  Button,
  Paper,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
  GlobalStyles,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useAuth } from '../../contexts/AuthContext';
import { fetchAuthenticatedStartPath } from '../../hooks/useAuthenticatedStartPath';
import {
  handlePasswordAutofillAnimation,
  handlePasswordVisibilityPointerDown,
  PASSWORD_AUTOFILL_ANIMATION,
  readPasswordInputValue,
  toggleControlledPasswordVisibility,
} from '../../utils/passwordVisibility';
import PageHeader from '../common/PageHeader';

const Login = () => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef(null);

  const syncPasswordFromDom = useCallback(() => {
    const password = readPasswordInputValue(passwordRef);
    setFormData((prev) => (prev.password === password ? prev : { ...prev, password }));
    return password;
  }, []);

  const togglePasswordVisibility = useCallback(() => {
    toggleControlledPasswordVisibility({
      field: 'password',
      inputRef: passwordRef,
      setFormData,
      setShowPasswords: (updater) => {
        setShowPassword((prev) => {
          const next = updater({ password: prev });
          return next.password;
        });
      },
    });
  }, []);

  const validateForm = (data = formData) => {
    const newErrors = {};
    if (!data.email) {
      newErrors.email = t('login.errors.emailRequired');
    } else if (!/\S+@\S+\.\S+/.test(data.email)) {
      newErrors.email = t('login.errors.emailInvalid');
    }
    if (!data.password) {
      newErrors.password = t('login.errors.passwordRequired');
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

    const password = syncPasswordFromDom();
    const submissionData = { ...formData, password };

    if (!validateForm(submissionData)) {
      return;
    }

    setLoading(true);
    try {
      const result = await login(submissionData.email, submissionData.password);
      if (result.success) {
        const user = result.user;
        const target = !user?.isVerified && !user?.emailVerified
          ? '/check-email'
          : await fetchAuthenticatedStartPath(user);
        navigate(target);
      } else {
        setSubmitError(result.error);
      }
    } catch {
      setSubmitError(t('login.errors.unexpected'));
    } finally {
      setLoading(false);
    }
  };

  const passwordInputProps = {
    className: 'password-input-autofill-detect',
    onAnimationStart: (event) => handlePasswordAutofillAnimation(event, handleChange),
  };

  return (
    <Container component="main" maxWidth="xs">
      <GlobalStyles
        styles={{
          '@keyframes password-autofill-start': {
            from: { opacity: 1 },
            to: { opacity: 1 },
          },
          'input.password-input-autofill-detect:-webkit-autofill': {
            animationName: PASSWORD_AUTOFILL_ANIMATION,
            animationDuration: '0.01s',
          },
        }}
      />
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
          <PageHeader title={t('login.title')} />

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
              id="email"
              label={t('login.emailLabel')}
              name="email"
              autoComplete="email"
              autoFocus
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
              label={t('login.passwordLabel')}
              type={showPassword ? 'text' : 'password'}
              id="password"
              autoComplete="current-password"
              inputRef={passwordRef}
              defaultValue=""
              onChange={handleChange}
              onInput={handleChange}
              onBlur={handleBlur}
              inputProps={passwordInputProps}
              error={!!errors.password}
              helperText={errors.password}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="button"
                      aria-label={showPassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                      aria-pressed={showPassword}
                      onClick={togglePasswordVisibility}
                      onMouseDown={handlePasswordVisibilityPointerDown}
                      onTouchStart={handlePasswordVisibilityPointerDown}
                      edge="end"
                      disabled={loading}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
              <Button
                component={RouterLink}
                to="/forgot-password"
                variant="text"
                size="small"
                sx={{ mt: 0.5, textTransform: 'none' }}
              >
                {t('login.forgotPasswordLink')}
              </Button>
            </Box>
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
                {loading ? <CircularProgress size={24} color="inherit" /> : t('login.submitCta')}
              </Button>
              <Button
                component={RouterLink}
                to="/register"
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
                {t('login.registerPrompt')}
              </Button>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default Login;
