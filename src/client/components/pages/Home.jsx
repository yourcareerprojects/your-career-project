import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useAuthenticatedStartPath,
  fetchAuthenticatedStartPath,
} from '../../hooks/useAuthenticatedStartPath';
import {
  Box,
  Button,
  Container,
  Grid,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Person as PersonIcon,
  School as SchoolIcon,
  Work as WorkIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import HomeGetStartedButton from '../home/HomeGetStartedButton';
import HomeFeatureCard from '../home/HomeFeatureCard';
import HomeFeaturesCarousel from '../home/HomeFeaturesCarousel';

const Home = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const theme = useTheme();
  const isCompactHome = useMediaQuery(theme.breakpoints.down('md'));
  const { isAuthenticated, user } = useAuth();
  const { path: authenticatedStartPath, ready: startPathReady } = useAuthenticatedStartPath();
  const homeTitle = isAuthenticated
    ? t('home.title.authenticated', { name: user?.name || t('home.title.fallbackName') })
    : t('home.title.guest');

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

  const handleGetStarted = async () => {
    if (isAuthenticated) {
      const target = startPathReady
        ? authenticatedStartPath
        : await fetchAuthenticatedStartPath(user);
      navigate(target);
      return;
    }
    navigate('/register');
  };

  return (
    <Container
      maxWidth="lg"
      disableGutters
      sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden', px: { xs: 0, sm: 2 } }}
    >
      <Box
        sx={{
          mt: { xs: 3, md: 8 },
          mb: { xs: 3, md: 6 },
          textAlign: 'center',
          width: '100%',
          maxWidth: '100%',
          px: { xs: 0.5, sm: 0 },
          boxSizing: 'border-box',
        }}
      >
        <Typography
          component="h1"
          variant="h2"
          color={isAuthenticated ? undefined : 'primary'}
          gutterBottom
          sx={{
            fontWeight: 'bold',
            fontSize: { xs: '1.75rem', sm: '2.125rem', md: '3.75rem' },
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            ...(isAuthenticated ? { color: 'var(--color-header-brand-headline)' } : {}),
          }}
        >
          {homeTitle}
        </Typography>
        <Typography
          variant="h5"
          color="text.secondary"
          paragraph
          sx={{
            fontSize: { xs: '1rem', md: '1.5rem' },
            mb: { xs: 2, md: 3 },
            px: { xs: 0.5, sm: 2 },
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          {t('home.subtitle')}
        </Typography>

        <Box
          sx={{
            mt: 3,
            display: 'flex',
            gap: 2,
            justifyContent: 'center',
            flexWrap: 'wrap',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: 'stretch',
            width: '100%',
            maxWidth: '100%',
            overflow: 'hidden',
          }}
        >
          <HomeGetStartedButton onClick={handleGetStarted}>
            {t('home.actions.getStarted')}
          </HomeGetStartedButton>
          {!isAuthenticated && (
            <Button variant="outlined" size="large" onClick={() => navigate('/login')}>
              {t('home.actions.signIn')}
            </Button>
          )}
        </Box>
      </Box>

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
