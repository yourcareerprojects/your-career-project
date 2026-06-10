import React, { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useTheme,
  useMediaQuery,
  Button,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Home as HomeIcon,
  Person as PersonIcon,
  Edit as EditIcon,
  ExitToApp as LogoutIcon,
  DarkModeOutlined,
  LightModeOutlined,
} from '@mui/icons-material';
import ExtensionIcon from '@mui/icons-material/Extension';
import StarIcon from '@mui/icons-material/Star';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../../constants/profileCompletion';
import { hasActiveCareerSimulationSession } from '../../utils/simulationPersistence';
import { useProfileCompletionQuery, useLastSimulationQuery } from '../../hooks/useProfileQueries';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { useThemeMode } from '../../contexts/ThemeModeContext';
const drawerWidth = 240;

const Layout = ({ children }) => {
  const { t } = useTranslation(['common', 'dashboard']);
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const location = useLocation();
  const { isAuthenticated, user, logout, resendVerificationEmail } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const { guardedNavigate } = useNavigationGuardContext();

  const completionQuery = useProfileCompletionQuery({ enabled: isAuthenticated });
  const lastSimEnabled = isAuthenticated && !hasActiveCareerSimulationSession();
  const lastSimQuery = useLastSimulationQuery({ enabled: lastSimEnabled });

  const canAccessSavedPages = useMemo(() => {
    if (!isAuthenticated || !completionQuery.data) return false;
    return Number(completionQuery.data?.completion?.overall || 0) >= MIN_PROFILE_COMPLETION_REQUIRED;
  }, [isAuthenticated, completionQuery.data]);

  const careerSimulationPath = useMemo(() => {
    if (hasActiveCareerSimulationSession()) return '/simulation/results';
    if (lastSimQuery.isError || lastSimQuery.data == null) return '/simulation';
    return lastSimQuery.data?.results ? '/simulation/results' : '/simulation';
  }, [lastSimQuery.data, lastSimQuery.isError]);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleNavigation = (path) => {
    guardedNavigate(path);
    if (isMobile) {
      setMobileOpen(false);
    }
  };
  const [resendMessage, setResendMessage] = useState('');

  const handleResend = async () => {
    const result = await resendVerificationEmail();
    setResendMessage(
      result.success
        ? (result.message || t('emailVerification.resendSuccessFallback', { ns: 'common' }))
        : (result.error || t('emailVerification.resendErrorFallback', { ns: 'common' }))
    );
  };

  const menuItems = [
    { text: t('navigation.home', { ns: 'common' }), icon: <HomeIcon />, path: '/' },
    ...(isAuthenticated
      ? [
          {
            text: t('simulation.menuLabel', { ns: 'dashboard' }),
            icon: <ExtensionIcon />,
            path: careerSimulationPath,
            isCareerSimulation: true,
          },
          { text: t('navigation.profile', { ns: 'common' }), icon: <PersonIcon />, path: '/profile' },
          ...(canAccessSavedPages
            ? [
                { text: t('roleSearch.menuLabel', { ns: 'dashboard' }), icon: <SearchIcon />, path: '/explore-roles' },
                { text: t('saved.simulations', { ns: 'dashboard' }), icon: <EditIcon />, path: '/simulations' },
                { text: t('saved.careerSteps', { ns: 'dashboard' }), icon: <StarIcon />, path: '/saved-steps' },
              ]
            : []),
        ]
      : []),
  ];
  const derivedPageTitle = (() => {
    if (location.pathname === '/simulation') {
      return t('simulation.pageTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/simulation/results') {
      return t('simulation.resultsTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/explore-roles') {
      return t('roleSearch.pageTitle', { ns: 'dashboard' });
    }
    if (location.pathname.startsWith('/role/')) {
      return t('roleSearch.detailPageTitle', { ns: 'dashboard' });
    }
    const match = menuItems.find((item) =>
      item.isCareerSimulation
        ? location.pathname === '/simulation' || location.pathname === '/simulation/results'
        : item.path === location.pathname
    );
    return match?.text || t('app.name', { ns: 'common' });
  })();

  const drawer = (
    <div>
      <Toolbar>
        <Typography variant="h6" noWrap component="div">
          {t('app.name', { ns: 'common' })}
        </Typography>
      </Toolbar>
      <List>
        {menuItems.map((item) => (
          <ListItem
            button
            key={item.text}
            onClick={() => handleNavigation(item.path)}
            selected={
              item.isCareerSimulation
                ? location.pathname === '/simulation' || location.pathname === '/simulation/results'
                : location.pathname === item.path
            }
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.text} />
          </ListItem>
        ))}
      </List>
    </div>
  );

  return (
    <Box
      sx={{ display: 'flex', width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}
      className="app-layout print-layout"
    >
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          maxWidth: '100vw',
          ml: { sm: `${drawerWidth}px` },
          bgcolor: 'var(--color-header-brand-bg)',
          color: 'var(--color-header-brand-fg)',
        }}
      >
        <Toolbar sx={{ overflow: 'hidden', minWidth: 0, gap: 0.5, px: { xs: 1, sm: 2 } }}>
          <IconButton
            color="inherit"
            aria-label={t('navigation.openDrawer', { ns: 'common', defaultValue: 'open drawer' })}
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{
              flexGrow: 1,
              minWidth: 0,
              color: 'var(--color-header-brand-headline)',
            }}
          >
            {derivedPageTitle}
          </Typography>
          <Tooltip
            title={
              mode === 'dark'
                ? t('theme.toggleLight', { ns: 'common' })
                : t('theme.toggleDark', { ns: 'common' })
            }
          >
            <IconButton
              color="inherit"
              onClick={toggleMode}
              aria-label={
                mode === 'dark'
                  ? t('theme.toggleLight', { ns: 'common' })
                  : t('theme.toggleDark', { ns: 'common' })
              }
              sx={{ mr: 0.5 }}
            >
              {mode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
            </IconButton>
          </Tooltip>
          <LanguageSwitcher compact={isMobile} />
          {isAuthenticated ? (
            <Button
              color="inherit"
              size="small"
              startIcon={isMobile ? undefined : <LogoutIcon />}
              onClick={() => {
                logout();
                guardedNavigate('/login');
              }}
              sx={{ flexShrink: 0, minWidth: 0, px: { xs: 1, sm: 2 } }}
            >
              {t('auth.logout', { ns: 'common' })}
            </Button>
          ) : (
            <Box sx={{ display: 'flex', flexShrink: 0, gap: { xs: 0, sm: 0.5 } }}>
              <Button
                color="inherit"
                size="small"
                onClick={() => handleNavigation('/login')}
                sx={{ minWidth: 0, px: { xs: 1, sm: 2 } }}
              >
                {t('auth.login', { ns: 'common' })}
              </Button>
              <Button
                color="inherit"
                size="small"
                onClick={() => handleNavigation('/register')}
                sx={{ minWidth: 0, px: { xs: 1, sm: 2 } }}
              >
                {t('auth.register', { ns: 'common' })}
              </Button>
            </Box>
          )}
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant={isMobile ? 'temporary' : 'permanent'}
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        className="app-main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          maxWidth: '100%',
          overflowX: 'hidden',
          boxSizing: 'border-box',
          p: { xs: 2, sm: 3 },
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          mt: '64px', // Height of AppBar
        }}
      >
        {isAuthenticated && user && !user.isVerified && (
          <Alert
            severity="info"
            sx={{
              mb: 2,
              width: '100%',
              maxWidth: '100%',
              alignItems: { xs: 'flex-start', sm: 'center' },
              flexDirection: { xs: 'column', sm: 'row' },
              '& .MuiAlert-message': {
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
                width: '100%',
              },
              '& .MuiAlert-action': {
                pt: { xs: 1, sm: 0 },
                pl: { xs: 0, sm: 2 },
                m: 0,
                alignSelf: { xs: 'stretch', sm: 'center' },
                '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } },
              },
            }}
            action={
              <Button color="inherit" size="small" onClick={handleResend}>
                {t('emailVerification.resendCta', { ns: 'common' })}
              </Button>
            }
          >
            {t('emailVerification.notice', { ns: 'common' })}
            {resendMessage ? ` ${resendMessage}` : ''}
          </Alert>
        )}
        {children}
      </Box>
    </Box>
  );
};

export default Layout; 