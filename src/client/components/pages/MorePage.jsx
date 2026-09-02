import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Container, Grid } from '@mui/material';
import {
  Search as SearchIcon,
  AccountTreeOutlined as PathsIcon,
  History as HistoryIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useNavigationGuardContext } from '../../contexts/NavigationGuardContext';
import { useAppNavigation } from '../../hooks/useAppNavigation';
import HomeHero from '../home/HomeHero';
import HubDestinationCard from '../common/HubDestinationCard';

const HUB_ICON_SX = { fontSize: 40, color: 'var(--color-primary)' };

/**
 * Mobile hub: start-page greeting + Saved & Search destinations + Settings.
 * Linked from the mobile bottom nav; not shown in the desktop sidebar.
 */
const MorePage = () => {
  const { t } = useTranslation(['common', 'dashboard']);
  const { guardedNavigate } = useNavigationGuardContext();
  const { canAccessSavedPages } = useAppNavigation();

  const options = useMemo(() => {
    const tiles = [
      {
        key: 'searchRoles',
        title: t('savedSearch.searchRoles.title', { ns: 'dashboard' }),
        description: t('savedSearch.searchRoles.description', { ns: 'dashboard' }),
        icon: <SearchIcon sx={HUB_ICON_SX} />,
        path: '/explore-roles',
      },
      {
        key: 'history',
        title: t('savedSearch.history.title', { ns: 'dashboard' }),
        description: t('savedSearch.history.description', { ns: 'dashboard' }),
        icon: <HistoryIcon sx={HUB_ICON_SX} />,
        path: '/history',
      },
    ];

    if (canAccessSavedPages) {
      tiles.push({
        key: 'savedCareerPaths',
        title: t('savedSearch.savedCareerPaths.title', { ns: 'dashboard' }),
        description: t('savedSearch.savedCareerPaths.description', { ns: 'dashboard' }),
        icon: <PathsIcon sx={HUB_ICON_SX} />,
        path: '/saved-paths',
      });
    }

    tiles.push({
      key: 'settings',
      title: t('settings.pageTitle', { ns: 'common' }),
      description: t('settings.hubDescription', { ns: 'common' }),
      icon: <SettingsIcon sx={HUB_ICON_SX} />,
      path: '/settings',
    });

    return tiles;
  }, [canAccessSavedPages, t]);

  return (
    <Container
      maxWidth="lg"
      disableGutters
      sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden', px: { xs: 0, sm: 2 } }}
    >
      <HomeHero />

      <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 0.5, sm: 0 }, pb: 1 }}>
        <Grid container spacing={3}>
          {options.map((option) => (
            <Grid item xs={12} sm={6} key={option.key}>
              <HubDestinationCard
                title={option.title}
                description={option.description}
                icon={option.icon}
                onClick={() => guardedNavigate(option.path)}
              />
            </Grid>
          ))}
        </Grid>
      </Box>
    </Container>
  );
};

export default MorePage;
