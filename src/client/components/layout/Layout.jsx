import React from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useTheme,
  useMediaQuery,
  Button,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  Home as HomeIcon,
  Person as PersonIcon,
  ExitToApp as LogoutIcon,
  DarkModeOutlined,
  LightModeOutlined,
  Bookmark as SavedSearchIcon,
} from '@mui/icons-material';
import ExtensionIcon from '@mui/icons-material/Extension';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import { useThemeMode } from '../../contexts/ThemeModeContext';
import { useAppNavigation, isSavedSearchPath } from '../../hooks/useAppNavigation';
import LanguageSwitcher from '../common/LanguageSwitcher';
import MobileBottomNav, { MOBILE_BOTTOM_NAV_HEIGHT } from './MobileBottomNav';
import IdentityExplorationGlobalListener from '../careerIdentity/IdentityExplorationGlobalListener';

const drawerWidth = 240;

const Layout = ({ children }) => {
  const { t } = useTranslation(['common', 'dashboard']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const location = useLocation();
  const { isAuthenticated, logout } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const { guardedNavigate } = useNavigationGuardContext();
  const { careerSimulationPath } = useAppNavigation();

  const handleNavigation = (path) => {
    guardedNavigate(path);
  };

  const menuItems = [
    { text: t('navigation.home', { ns: 'common' }), icon: <HomeIcon />, path: '/' },
    ...(isAuthenticated
      ? [
          { text: t('navigation.profile', { ns: 'common' }), icon: <PersonIcon />, path: '/profile' },
          {
            text: t('careerIdentity.menuLabel', { ns: 'dashboard' }),
            icon: <HubOutlinedIcon />,
            path: '/puzzle-you',
          },
          {
            text: t('simulation.menuLabel', { ns: 'dashboard' }),
            icon: <ExtensionIcon />,
            path: careerSimulationPath,
            isCareerSimulation: true,
          },
          {
            text: t('careerPuzzle.menuLabel', { ns: 'dashboard' }),
            icon: <ExtensionOutlinedIcon />,
            path: '/puzzle-path',
          },
          {
            text: t('savedSearch.menuLabel', { ns: 'dashboard' }),
            icon: <SavedSearchIcon />,
            path: '/saved-search',
            isSavedSearch: true,
          },
        ]
      : []),
  ];

  const derivedPageTitle = (() => {
    if (location.pathname === '/simulation') {
      return t('simulation.pageTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/puzzle-job') {
      return t('simulation.resultsTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/puzzle-path') {
      return t('careerPuzzle.pageTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/puzzle-you') {
      return t('careerIdentity.pageTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/saved-paths') {
      return t('saved.careerPaths', { ns: 'dashboard' });
    }
    if (location.pathname.startsWith('/saved-paths/')) {
      return t('savedLists.savedCareerPaths.editTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/explore-roles') {
      return t('roleSearch.pageTitle', { ns: 'dashboard' });
    }
    if (location.pathname.startsWith('/role/')) {
      return t('roleSearch.detailPageTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/saved-search') {
      return t('savedSearch.pageTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/history') {
      return t('history.pageTitle', { ns: 'dashboard' });
    }
    if (location.pathname === '/settings') {
      return t('settings.pageTitle', { ns: 'common' });
    }
    const match = menuItems.find((item) =>
      item.isCareerSimulation
        ? location.pathname === '/simulation' || location.pathname === '/puzzle-job'
        : item.isSavedSearch
          ? isSavedSearchPath(location.pathname)
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
                ? location.pathname === '/simulation' || location.pathname === '/puzzle-job'
                : item.isSavedSearch
                  ? isSavedSearchPath(location.pathname)
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

  const showMobileBottomNav = isMobile && isAuthenticated;
  const mobileBottomPadding = `calc(${MOBILE_BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px))`;
  const brandName = t('app.name', { ns: 'common' });
  // Guests on mobile: brand is the Home affordance; keep Login/Register as the other two entries.
  const showGuestBrandHome = isMobile && !isAuthenticated;
  const headerTitle = showGuestBrandHome ? brandName : derivedPageTitle;

  return (
    <Box
      sx={{ display: 'flex', width: '100%', maxWidth: '100vw', overflowX: 'clip' }}
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
          <Typography
            variant="h6"
            noWrap
            component={showGuestBrandHome ? 'button' : 'div'}
            type={showGuestBrandHome ? 'button' : undefined}
            onClick={showGuestBrandHome ? () => handleNavigation('/') : undefined}
            aria-label={showGuestBrandHome ? t('navigation.home', { ns: 'common' }) : undefined}
            sx={{
              flexGrow: 1,
              minWidth: 0,
              color: 'var(--color-header-brand-headline)',
              ...(showGuestBrandHome
                ? {
                    cursor: 'pointer',
                    border: 'none',
                    background: 'none',
                    padding: 0,
                    font: 'inherit',
                    textAlign: 'left',
                  }
                : {}),
            }}
          >
            {headerTitle}
          </Typography>
          {!isMobile && (
            <>
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
              <LanguageSwitcher />
              {isAuthenticated ? (
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<LogoutIcon />}
                  onClick={() => {
                    logout();
                    guardedNavigate('/login');
                  }}
                  sx={{ flexShrink: 0, minWidth: 0, px: 2 }}
                >
                  {t('auth.logout', { ns: 'common' })}
                </Button>
              ) : (
                <Box sx={{ display: 'flex', flexShrink: 0, gap: 0.5 }}>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => handleNavigation('/login')}
                    sx={{ minWidth: 0, px: 2 }}
                  >
                    {t('auth.login', { ns: 'common' })}
                  </Button>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => handleNavigation('/register')}
                    sx={{ minWidth: 0, px: 2 }}
                  >
                    {t('auth.register', { ns: 'common' })}
                  </Button>
                </Box>
              )}
            </>
          )}
          {isMobile && !isAuthenticated && (
            <Box sx={{ display: 'flex', flexShrink: 0, gap: 0.5 }}>
              <Button
                color="inherit"
                size="small"
                onClick={() => handleNavigation('/login')}
                sx={{ minWidth: 0, px: 1 }}
              >
                {t('auth.login', { ns: 'common' })}
              </Button>
              <Button
                color="inherit"
                size="small"
                onClick={() => handleNavigation('/register')}
                sx={{ minWidth: 0, px: 1 }}
              >
                {t('auth.register', { ns: 'common' })}
              </Button>
            </Box>
          )}
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 }, display: { xs: 'none', sm: 'block' } }}
      >
        <Drawer
          variant="permanent"
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
          overflowX: 'clip',
          boxSizing: 'border-box',
          p: { xs: 2, sm: 3 },
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          mt: '64px',
          pb: {
            xs: showMobileBottomNav ? `calc(${mobileBottomPadding} + 16px)` : 2,
            sm: 3,
          },
        }}
      >
        {children}
      </Box>
      {showMobileBottomNav && <MobileBottomNav />}
      {isAuthenticated && <IdentityExplorationGlobalListener />}
    </Box>
  );
};

export default Layout;
