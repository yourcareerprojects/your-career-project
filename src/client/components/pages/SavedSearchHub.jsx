import React from 'react';
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
  Star as StarIcon,
  Extension as SimulationIcon,
  ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import PageHeader from '../common/PageHeader';

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

  const options = [
    {
      key: 'searchRoles',
      title: t('savedSearch.searchRoles.title'),
      description: t('savedSearch.searchRoles.description'),
      icon: <SearchIcon sx={{ fontSize: 40, color: 'var(--color-primary)' }} />,
      path: '/explore-roles',
    },
    {
      key: 'savedCareerSteps',
      title: t('savedSearch.savedCareerSteps.title'),
      description: t('savedSearch.savedCareerSteps.description'),
      icon: <StarIcon sx={{ fontSize: 40, color: 'var(--color-primary)' }} />,
      path: '/saved-steps',
    },
    {
      key: 'savedSimulations',
      title: t('savedSearch.savedSimulations.title'),
      description: t('savedSearch.savedSimulations.description'),
      icon: <SimulationIcon sx={{ fontSize: 40, color: 'var(--color-primary)' }} />,
      path: '/simulations',
    },
  ];

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <PageHeader title={t('savedSearch.pageTitle')} description={t('savedSearch.subtitle')} />

      <Grid container spacing={3}>
        {options.map((option) => (
          <Grid item xs={12} sm={6} md={4} key={option.key}>
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
