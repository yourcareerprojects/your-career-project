import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../common/PageHeader';

const NotFound = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '80vh',
        textAlign: 'center',
        p: 3
      }}
    >
      <Typography variant="h1" component="p" sx={{ mb: 2, fontWeight: 700 }}>
        404
      </Typography>
      <PageHeader
        title="Page Not Found"
        description="The page you are looking for doesn't exist or has been moved."
      />
      <Button
        variant="contained"
        color="primary"
        onClick={() => navigate('/')}
        sx={{ mt: 2 }}
      >
        {t('navigation.goHome')}
      </Button>
    </Box>
  );
};

export default NotFound; 