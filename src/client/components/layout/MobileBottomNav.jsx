import React from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BottomNavigation,
  BottomNavigationAction,
  Paper,
} from '@mui/material';
import {
  Person as PersonIcon,
  Extension as SimulationIcon,
  Home as HomeIcon,
  Bookmark as SavedSearchIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import {
  useAppNavigation,
  isSavedSearchPath,
  isSimulationPath,
  isProfilePath,
} from '../../hooks/useAppNavigation';

export const MOBILE_BOTTOM_NAV_HEIGHT = 56;

const MobileBottomNav = () => {
  const { t } = useTranslation(['common', 'dashboard']);
  const location = useLocation();
  const { guardedNavigate } = useNavigationGuardContext();
  const { careerSimulationPath } = useAppNavigation();

  const navItems = [
    {
      key: 'profile',
      label: t('navigation.bottomNav.profile', { ns: 'common' }),
      icon: <PersonIcon />,
      path: '/profile',
      isActive: isProfilePath(location.pathname),
    },
    {
      key: 'simulation',
      label: t('navigation.bottomNav.simulation', { ns: 'common' }),
      icon: <SimulationIcon />,
      path: careerSimulationPath,
      isActive: isSimulationPath(location.pathname),
    },
    {
      key: 'home',
      label: t('navigation.bottomNav.home', { ns: 'common' }),
      icon: <HomeIcon />,
      path: '/',
      isActive: location.pathname === '/',
    },
    {
      key: 'savedSearch',
      label: t('navigation.bottomNav.savedSearch', { ns: 'common' }),
      icon: <SavedSearchIcon />,
      path: '/saved-search',
      isActive: isSavedSearchPath(location.pathname),
    },
    {
      key: 'settings',
      label: t('navigation.bottomNav.settings', { ns: 'common' }),
      icon: <SettingsIcon />,
      path: '/settings',
      isActive: location.pathname === '/settings',
    },
  ];

  const activeIndex = navItems.findIndex((item) => item.isActive);

  return (
    <Paper
      component="nav"
      aria-label={t('navigation.bottomNav.label', { ns: 'common' })}
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        display: { xs: 'block', sm: 'none' },
        borderTop: 1,
        borderColor: 'divider',
        pb: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <BottomNavigation
        showLabels
        value={activeIndex === -1 ? false : activeIndex}
        onChange={(_, newValue) => {
          const item = navItems[newValue];
          if (item) guardedNavigate(item.path);
        }}
        sx={{
          height: MOBILE_BOTTOM_NAV_HEIGHT,
          bgcolor: 'background.paper',
          '& .MuiBottomNavigationAction-root': {
            minWidth: 0,
            px: 0.5,
            '&.Mui-selected': {
              color: 'var(--color-primary)',
            },
          },
          '& .MuiBottomNavigationAction-label': {
            fontSize: '0.65rem',
            '&.Mui-selected': {
              fontSize: '0.65rem',
            },
          },
        }}
      >
        {navItems.map((item) => (
          <BottomNavigationAction
            key={item.key}
            label={item.label}
            icon={item.icon}
            aria-label={item.label}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
};

export default MobileBottomNav;
