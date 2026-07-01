import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Paper,
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  InputAdornment
} from '@mui/material';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockIcon from '@mui/icons-material/Lock';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import axios from 'axios';
import ChangeEmailDialog from './ChangeEmailDialog';
import ChangePasswordDialog from './ChangePasswordDialog';
import { useAuth } from '../../contexts/AuthContext';

const InfoRow = ({ icon, label, value, helper, fallbackValue }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 160 }}>
      {icon}
      <Typography variant="subtitle2" color="text.secondary">
        {label}
      </Typography>
    </Box>
    <Box>
      <Typography variant="body1" color={value ? 'text.primary' : 'text.disabled'}>
        {value || fallbackValue}
      </Typography>
      {helper && (
        <Typography variant="caption" color="text.secondary">
          {helper}
        </Typography>
      )}
    </Box>
  </Box>
);

/**
 * @param {'page' | 'dialog'} layout - `page`: full card with title. `dialog`: body only (use with DialogTitle in parent).
 */
const LoginSecuritySection = ({ loginSecurity, loading, error, onRefresh, layout = 'page' }) => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingAction, setPendingAction] = useState(false);

  const handlePendingAction = async (action) => {
    setPendingAction(true);
    setActionError('');
    setActionMessage('');
    try {
      await action();
      if (onRefresh) {
        await onRefresh();
      }
      setActionMessage(t('loginSecurity.messages.requestCompleted'));
    } catch (err) {
      setActionError(err.response?.data?.error || t('loginSecurity.errors.actionFailed'));
    } finally {
      setPendingAction(false);
    }
  };

  const handleCancelPending = () =>
    handlePendingAction(() => axios.delete('/api/auth/email-change'));

  const handlePendingInfoUpdated = () => {
    setActionMessage(t('loginSecurity.messages.emailChangeUpdated'));
    if (onRefresh) {
      onRefresh();
    }
  };

  const resetDeleteDialogState = () => {
    setDeletePassword('');
    setShowDeletePassword(false);
    setDeleteError('');
    setDeleteLoading(false);
  };

  const openDeleteDialog = () => {
    resetDeleteDialogState();
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    if (deleteLoading) return;
    setDeleteDialogOpen(false);
    resetDeleteDialogState();
  };

  const handleDeleteAccount = async () => {
    setDeleteError('');
    setDeleteLoading(true);
    try {
      await axios.delete('/api/auth/account', {
        data: { currentPassword: deletePassword }
      });
      logout();
      navigate('/login', {
        replace: true,
        state: { accountDeleted: true }
      });
    } catch (err) {
      setDeleteError(err.response?.data?.error || t('loginSecurity.deleteAccount.errors.deleteFailed'));
      setDeleteLoading(false);
    }
  };

  const isPage = layout === 'page';
  const body = (
    <>
      {isPage && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <LockIcon color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6">{t('loginSecurity.title')}</Typography>
        </Box>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('loginSecurity.description')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Button variant="outlined" startIcon={<EmailOutlinedIcon />} onClick={() => setEmailDialogOpen(true)}>
          {t('loginSecurity.actions.changeEmail')}
        </Button>
        <Button variant="contained" startIcon={<LockOutlinedIcon />} onClick={() => setPasswordDialogOpen(true)}>
          {t('loginSecurity.actions.changePassword')}
        </Button>
        <Button
          color="error"
          variant="outlined"
          onClick={openDeleteDialog}
        >
          {t('loginSecurity.deleteAccount.actions.openDialog')}
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2">{t('loginSecurity.loadingDetails')}</Typography>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      {actionMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {actionMessage}
        </Alert>
      )}

      {loginSecurity && (
        <Stack spacing={2}>
          <InfoRow
            icon={<EmailOutlinedIcon fontSize="small" color="action" />}
            label={t('loginSecurity.primaryEmail.label')}
            value={loginSecurity.email}
            helper={loginSecurity.isVerified ? t('loginSecurity.primaryEmail.verified') : t('loginSecurity.primaryEmail.pendingVerification')}
            fallbackValue={t('loginSecurity.primaryEmail.notAvailable')}
          />
          {loginSecurity.pendingEmailChange && (
            <Alert
              severity="warning"
              action={
                <Button
                  color="inherit"
                  size="small"
                  disabled={pendingAction}
                  onClick={handleCancelPending}
                >
                  {t('loginSecurity.actions.cancel')}
                </Button>
              }
            >
              <Typography variant="body2">
                {t('loginSecurity.pending.pendingFor', { email: loginSecurity.pendingEmailChange.newEmail })}
              </Typography>
              <Typography variant="caption" display="block">
                {t('loginSecurity.pending.codeExpires')}{' '}
                {loginSecurity.pendingEmailChange.expiresAt
                  ? new Date(loginSecurity.pendingEmailChange.expiresAt).toLocaleString()
                  : t('loginSecurity.pending.soon')}
                {'.'}
              </Typography>
              {typeof loginSecurity.pendingEmailChange.attemptsRemaining === 'number' &&
                typeof loginSecurity.pendingEmailChange.maxAttempts === 'number' && (
                  <Typography variant="caption" display="block">
                    {t('loginSecurity.pending.attemptsRemaining', {
                      current: loginSecurity.pendingEmailChange.attemptsRemaining,
                      max: loginSecurity.pendingEmailChange.maxAttempts
                    })}
                  </Typography>
              )}
              {loginSecurity.pendingEmailChange.resendAvailableAt && (
                <Typography variant="caption" display="block">
                  {t('loginSecurity.pending.nextResendAt')}{' '}
                  {new Date(loginSecurity.pendingEmailChange.resendAvailableAt).toLocaleTimeString()}
                </Typography>
              )}
            </Alert>
          )}
        </Stack>
      )}

      <ChangeEmailDialog
        open={emailDialogOpen}
        onClose={() => setEmailDialogOpen(false)}
        pendingChange={loginSecurity?.pendingEmailChange}
        onSuccess={handlePendingInfoUpdated}
        currentEmail={loginSecurity?.email}
      />

      <ChangePasswordDialog
        open={passwordDialogOpen}
        onClose={() => setPasswordDialogOpen(false)}
        onSuccess={() => {
          setPasswordDialogOpen(false);
          setActionMessage(t('loginSecurity.messages.passwordUpdated'));
          if (onRefresh) {
            onRefresh();
          }
        }}
      />

      <Dialog open={deleteDialogOpen} onClose={closeDeleteDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{t('loginSecurity.deleteAccount.dialogTitle')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('loginSecurity.deleteAccount.warning')}
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('loginSecurity.deleteAccount.reauthDescription')}
          </Typography>
          <TextField
            type={showDeletePassword ? 'text' : 'password'}
            fullWidth
            autoComplete="current-password"
            label={t('loginSecurity.deleteAccount.fields.currentPassword')}
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            margin="dense"
            disabled={deleteLoading}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    type="button"
                    aria-label={showDeletePassword ? t('passwordVisibility.hide') : t('passwordVisibility.show')}
                    aria-pressed={showDeletePassword}
                    onClick={() => setShowDeletePassword((v) => !v)}
                    edge="end"
                    disabled={deleteLoading}
                  >
                    {showDeletePassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              )
            }}
          />
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog} disabled={deleteLoading}>
            {t('loginSecurity.actions.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteAccount}
            disabled={deleteLoading || !deletePassword.trim()}
          >
            {deleteLoading ? t('loginSecurity.deleteAccount.actions.deleting') : t('loginSecurity.deleteAccount.actions.confirmDelete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );

  if (isPage) {
    return (
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 4 }} elevation={1}>
        {body}
      </Paper>
    );
  }

  return <Box sx={{ pt: 0 }}>{body}</Box>;
};

export default LoginSecuritySection;

