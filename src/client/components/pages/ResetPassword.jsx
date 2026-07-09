import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import PageHeader from '../common/PageHeader';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  GlobalStyles,
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
import {
  handlePasswordAutofillAnimation,
  handlePasswordVisibilityPointerDown,
  PASSWORD_AUTOFILL_ANIMATION,
  readPasswordInputValue,
  toggleControlledPasswordVisibility,
} from '../../utils/passwordVisibility';

const ResetPassword = () => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token: routeToken } = useParams();
  const token = String(searchParams.get('token') || routeToken || '').trim();
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const hasSubmittedRef = useRef(false);
  const activeRequestIdRef = useRef(0);
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);
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

  const readPasswordFieldsFromDom = useCallback(() => ({
    password: readPasswordInputValue(passwordRef),
    confirmPassword: readPasswordInputValue(confirmPasswordRef),
  }), []);

  const syncPasswordFieldsFromDom = useCallback(() => {
    const { password, confirmPassword } = readPasswordFieldsFromDom();
    setFormData((prev) => {
      if (prev.password === password && prev.confirmPassword === confirmPassword) {
        return prev;
      }
      return { ...prev, password, confirmPassword };
    });
    return { password, confirmPassword };
  }, [readPasswordFieldsFromDom]);

  const togglePasswordVisibility = useCallback((field, inputRef) => {
    toggleControlledPasswordVisibility({
      field,
      inputRef,
      setFormData,
      setShowPasswords,
    });
  }, []);

  const checklist = passwordRules.map((rule) => ({
    ...rule,
    satisfied: rule.test(formData.password),
  }));
  const checklistPassed = checklist.every((rule) => rule.satisfied);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleBlur = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => (prev[name] === value ? prev : { ...prev, [name]: value }));
  };

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

    const { password, confirmPassword } = syncPasswordFieldsFromDom();

    if (!passwordRules.every((rule) => rule.test(password))) {
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

  const passwordInputProps = {
    className: 'password-input-autofill-detect',
    onAnimationStart: (event) => handlePasswordAutofillAnimation(event, handleChange),
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
          <PageHeader
            title={t('resetPassword.title')}
            description={t('resetPassword.description')}
          />

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
                id="password"
                autoComplete="new-password"
                autoFocus
                inputRef={passwordRef}
                defaultValue=""
                onChange={handleChange}
                onInput={handleChange}
                onBlur={handleBlur}
                inputProps={passwordInputProps}
                disabled={loading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        type="button"
                        aria-label={showPasswords.password ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                        aria-pressed={showPasswords.password}
                        onClick={() => togglePasswordVisibility('password', passwordRef)}
                        onMouseDown={handlePasswordVisibilityPointerDown}
                        onTouchStart={handlePasswordVisibilityPointerDown}
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
                id="confirmPassword"
                autoComplete="new-password"
                inputRef={confirmPasswordRef}
                defaultValue=""
                onChange={handleChange}
                onInput={handleChange}
                onBlur={handleBlur}
                inputProps={passwordInputProps}
                disabled={loading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        type="button"
                        aria-label={showPasswords.confirmPassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                        aria-pressed={showPasswords.confirmPassword}
                        onClick={() => togglePasswordVisibility('confirmPassword', confirmPasswordRef)}
                        onMouseDown={handlePasswordVisibilityPointerDown}
                        onTouchStart={handlePasswordVisibilityPointerDown}
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
