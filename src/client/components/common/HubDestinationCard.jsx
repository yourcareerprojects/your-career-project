import React from 'react';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Typography,
} from '@mui/material';
import { ArrowForward as ArrowForwardIcon } from '@mui/icons-material';

export const HUB_CARD_SX = {
  height: '100%',
  border: '1px solid',
  borderColor: 'divider',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  '&:hover': {
    borderColor: 'var(--color-primary)',
    boxShadow: 2,
  },
};

const HubDestinationCard = ({ title, description, icon, onClick }) => (
  <Card sx={HUB_CARD_SX}>
    <CardActionArea onClick={onClick} sx={{ height: '100%' }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          {icon}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" component="h2" gutterBottom>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          </Box>
          <ArrowForwardIcon color="action" sx={{ flexShrink: 0, mt: 0.5 }} />
        </Box>
      </CardContent>
    </CardActionArea>
  </Card>
);

export default HubDestinationCard;
