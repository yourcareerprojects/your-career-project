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
  Card,
  CardContent,
} from '@mui/material';
import {
  Person as PersonIcon,
  School as SchoolIcon,
  Work as WorkIcon,
  ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';

const FeatureCard = ({ title, description, icon }) => (
  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <CardContent sx={{ flexGrow: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
        {icon}
      </Box>
      <Typography gutterBottom variant="h5" component="h2" align="center">
        {title}
      </Typography>
      <Typography align="center" color="text.secondary">
        {description}
      </Typography>
    </CardContent>
  </Card>
);

const Home = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { isAuthenticated, user } = useAuth();
  const { path: authenticatedStartPath, ready: startPathReady } = useAuthenticatedStartPath();
  const homeTitle = isAuthenticated
    ? t('home.title.authenticated', { name: user?.name || t('home.title.fallbackName') })
    : t('home.title.guest');

  const features = [
    {
      title: t('home.features.understand.title'),
      description: t('home.features.understand.description'),
      icon: <PersonIcon sx={{ fontSize: 60, color: 'var(--color-header-brand-headline)' }} />,
    },
    {
      title: t('home.features.simulate.title'),
      description: t('home.features.simulate.description'),
      icon: <SchoolIcon sx={{ fontSize: 60, color: 'var(--color-header-brand-headline)' }} />,
    },
    {
      title: t('home.features.find.title'),
      description: t('home.features.find.description'),
      icon: <WorkIcon sx={{ fontSize: 60, color: 'var(--color-header-brand-headline)' }} />,
    },
  ];

  return (
    <Container maxWidth="lg">
      <Box sx={{ mt: 8, mb: 6, textAlign: 'center' }}>
        <Typography
          component="h1"
          variant="h2"
          color={isAuthenticated ? undefined : 'primary'}
          gutterBottom
          sx={{
            fontWeight: 'bold',
            ...(isAuthenticated ? { color: 'var(--color-header-brand-headline)' } : {}),
          }}
        >
          {homeTitle}
        </Typography>
        <Typography variant="h5" color="text.secondary" paragraph>
          {t('home.subtitle')}
        </Typography>
        <Box
          sx={{
            mt: 3,
            display: 'flex',
            gap: 2,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          {isAuthenticated ? (
            <Button
              variant="contained"
              color="primary"
              size="medium"
              startIcon={<ArrowForwardIcon />}
              onClick={async () => {
                const target = startPathReady
                  ? authenticatedStartPath
                  : await fetchAuthenticatedStartPath();
                navigate(target);
              }}
              sx={{
                fontWeight: 600,
                px: 3,
                py: 1.5,
                fontSize: '1rem',
              }}
            >
              {t('home.actions.getStarted')}
            </Button>
          ) : (
            <>
              <Button
                variant="contained"
                color="primary"
                size="medium"
                startIcon={<ArrowForwardIcon />}
                onClick={() => navigate('/register')}
                sx={{
                  fontWeight: 600,
                  px: 3,
                  py: 1.5,
                  fontSize: '1rem',
                }}
              >
                {t('home.actions.getStarted')}
              </Button>
              <Button variant="outlined" size="large" onClick={() => navigate('/login')}>
                {t('home.actions.signIn')}
              </Button>
            </>
          )}
        </Box>
      </Box>

      <Grid container spacing={4} sx={{ mt: 4 }}>
        {features.map((feature, index) => (
          <Grid item key={index} xs={12} sm={6} md={4}>
            <FeatureCard {...feature} />
          </Grid>
        ))}
      </Grid>
    </Container>
  );
};

export default Home; 