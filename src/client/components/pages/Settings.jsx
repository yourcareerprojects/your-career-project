import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  IconButton,
  Button,
  Divider,
} from '@mui/material';
import {
  DarkModeOutlined,
  LightModeOutlined,
  Language as LanguageIcon,
  ExitToApp as LogoutIcon,
  Login as LoginIcon,
  PersonAdd as RegisterIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useThemeMode } from '../../contexts/ThemeModeContext';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import LanguageSwitcher from '../common/LanguageSwitcher';
import PageHeader from '../common/PageHeader';

const Settings = () => {
  const { t } = useTranslation('common');
  const { isAuthenticated, logout } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const { guardedNavigate } = useNavigationGuardContext();

  const handleLogout = () => {
    logout();
    guardedNavigate('/login');
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto' }}>
      <PageHeader title={t('settings.pageTitle')} />

      <Paper sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: 'block', px: 2, pt: 2 }}
        >
          {t('settings.appearance')}
        </Typography>
        <List disablePadding>
          <ListItem>
            <ListItemIcon>
              {mode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
            </ListItemIcon>
            <ListItemText
              primary={t('settings.theme')}
              secondary={
                mode === 'dark' ? t('settings.themeDark') : t('settings.themeLight')
              }
            />
            <ListItemSecondaryAction>
              <IconButton
                edge="end"
                onClick={toggleMode}
                aria-label={
                  mode === 'dark' ? t('theme.toggleLight') : t('theme.toggleDark')
                }
              >
                {mode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
              </IconButton>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Paper>

      <Paper sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: 'block', px: 2, pt: 2 }}
        >
          {t('settings.languageSection')}
        </Typography>
        <Box sx={{ px: 2, py: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LanguageIcon color="action" />
            <Typography variant="body1">{t('language.switchLabel')}</Typography>
          </Box>
          <LanguageSwitcher />
        </Box>
      </Paper>

      <Paper>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: 'block', px: 2, pt: 2 }}
        >
          {t('settings.account')}
        </Typography>
        <List disablePadding>
          {isAuthenticated ? (
            <ListItem>
              <ListItemIcon>
                <LogoutIcon />
              </ListItemIcon>
              <ListItemText primary={t('auth.logout')} />
              <ListItemSecondaryAction>
                <Button
                  variant="outlined"
                  color="inherit"
                  size="small"
                  startIcon={<LogoutIcon />}
                  onClick={handleLogout}
                >
                  {t('auth.logout')}
                </Button>
              </ListItemSecondaryAction>
            </ListItem>
          ) : (
            <>
              <ListItem>
                <ListItemIcon>
                  <LoginIcon />
                </ListItemIcon>
                <ListItemText primary={t('auth.login')} />
                <ListItemSecondaryAction>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => guardedNavigate('/login')}
                  >
                    {t('auth.login')}
                  </Button>
                </ListItemSecondaryAction>
              </ListItem>
              <Divider component="li" />
              <ListItem>
                <ListItemIcon>
                  <RegisterIcon />
                </ListItemIcon>
                <ListItemText primary={t('auth.register')} />
                <ListItemSecondaryAction>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => guardedNavigate('/register')}
                  >
                    {t('auth.register')}
                  </Button>
                </ListItemSecondaryAction>
              </ListItem>
            </>
          )}
        </List>
      </Paper>
    </Box>
  );
};

export default Settings;
