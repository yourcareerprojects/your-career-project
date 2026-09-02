import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Grid } from '@mui/material';
import {
  Search as SearchIcon,
  AccountTreeOutlined as PathsIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import PageHeader from '../common/PageHeader';
import HubDestinationCard from '../common/HubDestinationCard';
import { useAppNavigation } from '../../hooks/useAppNavigation';

const HUB_ICON_SX = { fontSize: 40, color: 'var(--color-primary)' };

const SavedSearchHub = () => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { canAccessSavedPages } = useAppNavigation();

  const options = useMemo(() => {
    const tiles = [
      {
        key: 'searchRoles',
        title: t('savedSearch.searchRoles.title'),
        description: t('savedSearch.searchRoles.description'),
        icon: <SearchIcon sx={HUB_ICON_SX} />,
        path: '/explore-roles',
      },
      {
        key: 'history',
        title: t('savedSearch.history.title'),
        description: t('savedSearch.history.description'),
        icon: <HistoryIcon sx={HUB_ICON_SX} />,
        path: '/history',
      },
    ];

    if (canAccessSavedPages) {
      tiles.push({
        key: 'savedCareerPaths',
        title: t('savedSearch.savedCareerPaths.title'),
        description: t('savedSearch.savedCareerPaths.description'),
        icon: <PathsIcon sx={HUB_ICON_SX} />,
        path: '/saved-paths',
      });
    }

    return tiles;
  }, [canAccessSavedPages, t]);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <PageHeader title={t('savedSearch.pageTitle')} description={t('savedSearch.subtitle')} />

      <Grid container spacing={3}>
        {options.map((option) => (
          <Grid item xs={12} sm={6} key={option.key}>
            <HubDestinationCard
              title={option.title}
              description={option.description}
              icon={option.icon}
              onClick={() => navigate(option.path)}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default SavedSearchHub;
