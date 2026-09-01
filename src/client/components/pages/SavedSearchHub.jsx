import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  CardContent,
  Grid,
} from '@mui/material';
import {
  Search as SearchIcon,
  AccountTreeOutlined as PathsIcon,
  History as HistoryIcon,
  ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import PageHeader from '../common/PageHeader';
import { useAppNavigation } from '../../hooks/useAppNavigation';

const HUB_CARD_SX = {
  height: '100%',
  border: '1px solid',
  borderColor: 'divider',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  '&:hover': {
    borderColor: 'var(--color-primary)',
    boxShadow: 2,
  },
};

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
        icon: <SearchIcon sx={{ fontSize: 40, color: 'var(--color-primary)' }} />,
        path: '/explore-roles',
      },
      {
        key: 'history',
        title: t('savedSearch.history.title'),
        description: t('savedSearch.history.description'),
        icon: <HistoryIcon sx={{ fontSize: 40, color: 'var(--color-primary)' }} />,
        path: '/history',
      },
    ];

    if (canAccessSavedPages) {
      tiles.push(
        {
          key: 'savedCareerPaths',
          title: t('savedSearch.savedCareerPaths.title'),
          description: t('savedSearch.savedCareerPaths.description'),
          icon: <PathsIcon sx={{ fontSize: 40, color: 'var(--color-primary)' }} />,
          path: '/saved-paths',
        }
      );
    }

    return tiles;
  }, [canAccessSavedPages, t]);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <PageHeader title={t('savedSearch.pageTitle')} description={t('savedSearch.subtitle')} />

      <Grid container spacing={3}>
        {options.map((option) => (
          <Grid item xs={12} sm={6} key={option.key}>
            <Card sx={HUB_CARD_SX}>
              <CardActionArea onClick={() => navigate(option.path)} sx={{ height: '100%' }}>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                    {option.icon}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="h6" component="h2" gutterBottom>
                        {option.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {option.description}
                      </Typography>
                    </Box>
                    <ArrowForwardIcon color="action" sx={{ flexShrink: 0, mt: 0.5 }} />
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default SavedSearchHub;
