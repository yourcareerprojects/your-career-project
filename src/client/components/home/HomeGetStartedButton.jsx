import React from 'react';
import { Button } from '@mui/material';
import { ArrowForward as ArrowForwardIcon } from '@mui/icons-material';
import { useCtaNudgeAnimation } from '../../hooks/useCtaNudgeAnimation';

const HomeGetStartedButton = ({ children, onClick, ...buttonProps }) => {
  const { nudgeInteractionHandlers, nudgeSx } = useCtaNudgeAnimation({ enabled: true });

  return (
    <Button
      variant="contained"
      color="primary"
      size="medium"
      startIcon={<ArrowForwardIcon />}
      onClick={onClick}
      {...nudgeInteractionHandlers}
      sx={{
        fontWeight: 600,
        px: 3,
        py: 1.5,
        fontSize: '1rem',
        width: { xs: '100%', sm: 'auto' },
        maxWidth: '100%',
        ...nudgeSx,
      }}
      {...buttonProps}
    >
      {children}
    </Button>
  );
};

export default HomeGetStartedButton;
