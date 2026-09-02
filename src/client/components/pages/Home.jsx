import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Grid,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Person as PersonIcon,
  School as SchoolIcon,
  Work as WorkIcon,
} from '@mui/icons-material';
import HomeHero from '../home/HomeHero';
import HomeFeatureCard from '../home/HomeFeatureCard';
import HomeFeaturesCarousel from '../home/HomeFeaturesCarousel';
import { useAuth } from '../../contexts/AuthContext';

const Home = () => {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const isCompactHome = useMediaQuery(theme.breakpoints.down('md'));
  const { isAuthenticated } = useAuth();

  const features = [
    {
      title: t('home.features.understand.title'),
      description: t('home.features.understand.description'),
      icon: (
        <PersonIcon
          sx={{ fontSize: { xs: 48, sm: 60 }, color: 'var(--color-header-brand-headline)' }}
        />
      ),
    },
    {
      title: t('home.features.simulate.title'),
      description: t('home.features.simulate.description'),
      icon: (
        <SchoolIcon
          sx={{ fontSize: { xs: 48, sm: 60 }, color: 'var(--color-header-brand-headline)' }}
        />
      ),
    },
    {
      title: t('home.features.find.title'),
      description: t('home.features.find.description'),
      icon: (
        <WorkIcon
          sx={{ fontSize: { xs: 48, sm: 60 }, color: 'var(--color-header-brand-headline)' }}
        />
      ),
    },
  ];

  return (
    <Container
      maxWidth="lg"
      disableGutters
      sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden', px: { xs: 0, sm: 2 } }}
    >
      <HomeHero showSignIn={!isAuthenticated} />

      {isCompactHome ? (
        <HomeFeaturesCarousel features={features} />
      ) : (
        <Grid container spacing={4} sx={{ mt: 4 }}>
          {features.map((feature) => (
            <Grid item key={feature.title} xs={12} sm={6} md={4}>
              <HomeFeatureCard {...feature} />
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
};

export default Home;
