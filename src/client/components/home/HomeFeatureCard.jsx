import React from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';

const HomeFeatureCard = ({ title, description, icon }) => (
  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', maxWidth: '100%' }}>
    <CardContent
      sx={{
        flexGrow: 1,
        px: { xs: 2, sm: 3 },
        py: { xs: 2.5, sm: 3 },
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
        {icon}
      </Box>
      <Typography
        gutterBottom
        variant="h5"
        component="h2"
        align="center"
        sx={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}
      >
        {title}
      </Typography>
      <Typography align="center" color="text.secondary">
        {description}
      </Typography>
    </CardContent>
  </Card>
);

export default HomeFeatureCard;
