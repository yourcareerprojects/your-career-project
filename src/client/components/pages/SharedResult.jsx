import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Button,
  Alert,
  Paper
} from '@mui/material';
import {
  Work,
  ArrowBack,
  Home
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CareerStepRoleInsightsCard, CareerStepRoleDetailsCard, CareerStepRoleDescriptionCard } from '../common/CareerStepRoleSections';
import PageHeader from '../common/PageHeader';

const SharedResult = () => {
  const { t } = useTranslation(['common', 'dashboard']);
  const { shareId } = useParams();
  const navigate = useNavigate();
  const [sharedContent, setSharedContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSharedContent();
  }, [shareId]);

  const fetchSharedContent = async () => {
    try {
      setLoading(true);
      
      const decodeSharePayload = (rawShareId) => {
        // New format: base64url + UTF-8 payload
        try {
          const base64 = rawShareId
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(rawShareId.length / 4) * 4, '=');

          const binary = atob(base64);
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          const decoded = new TextDecoder().decode(bytes);
          return JSON.parse(decoded);
        } catch (e) {
          // Legacy format: base64 + plain JSON
          try {
            const decoded = atob(rawShareId);
            return JSON.parse(decoded);
          } catch (legacyError) {
            return null;
          }
        }
      };

      const sharedData = decodeSharePayload(shareId);
      if (!sharedData) {
        setError(t('sharedResult.errors.invalidLink', { ns: 'common' }));
        return;
      }
      
      if (sharedData && sharedData.title) {
        // Use the actual shared data
        const actualSharedContent = {
          title: sharedData.title,
          description: sharedData.description,
          category: sharedData.category,
          seniority: sharedData.seniority,
          keyResponsibilities: sharedData.keyResponsibilities,
          skillDomains: sharedData.skillDomains,
          skillModel: sharedData.skillModel,
          altTitles: sharedData.altTitles,
          hiddenTitles: sharedData.hiddenTitles,
          requiredSkills: sharedData.requiredSkills,
          requiredSkillUris: sharedData.requiredSkillUris,
          escoId: sharedData.escoId
        };
        
        setSharedContent(actualSharedContent);
      } else {
        setError(t('sharedResult.errors.invalidLink', { ns: 'common' }));
      }
    } catch (err) {
      setError(t('sharedResult.errors.loadFailed', { ns: 'common' }));
      console.error('Error fetching shared content:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGoHome = () => {
    navigate('/');
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button variant="contained" onClick={handleGoHome}>
          {t('navigation.goHome')}
        </Button>
      </Box>
    );
  }

  if (!sharedContent) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
        <Typography variant="h6" color="error">
          {t('sharedResult.errors.notFound', { ns: 'common' })}
        </Typography>
        <Button variant="contained" onClick={handleGoHome} sx={{ mt: 2 }}>
          {t('navigation.goHome')}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <PageHeader
        title={t('sharedResult.title', { ns: 'common' })}
        description={t('sharedResult.subtitle', { ns: 'common' })}
      />

      {/* Header Section */}
      <Paper 
        sx={{ 
          mb: 3,
          backgroundColor: 'primary.light',
          color: 'primary.contrastText',
          borderRadius: 2,
          overflow: 'hidden'
        }}
      >
        <Box sx={{ p: 3 }}>
          <Typography variant="h4" component="h2" gutterBottom sx={{ fontWeight: 'bold', color: 'var(--color-on-primary)' }}>
            {sharedContent.title}
          </Typography>
        </Box>
      </Paper>

      <Grid container spacing={3}>
        {/* Main Content */}
        <Grid item xs={12} lg={8}>
          <CareerStepRoleDescriptionCard description={sharedContent.description} />

          <CareerStepRoleInsightsCard stepDetails={sharedContent} key="shared-role-insights" />

        </Grid>

        {/* Sidebar */}
        <Grid item xs={12} lg={4}>
          {/* Actions */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                <Work sx={{ mr: 1, verticalAlign: 'middle' }} />
                {t('details.labels.actions', { ns: 'dashboard' })}
              </Typography>
              
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button
                  variant="contained"
                  fullWidth
                  startIcon={<Home />}
                  onClick={handleGoHome}
                >
                  {t('actions.exploreCareerPaths')}
                </Button>
                
                <Button
                  variant="outlined"
                  fullWidth
                  startIcon={<ArrowBack />}
                  onClick={() => window.history.back()}
                >
                  {t('actions.goBack')}
                </Button>
              </Box>
            </CardContent>
          </Card>

          <CareerStepRoleDetailsCard stepDetails={sharedContent} key="shared-role-details" />

        </Grid>
      </Grid>
    </Box>
  );
};

export default SharedResult; 