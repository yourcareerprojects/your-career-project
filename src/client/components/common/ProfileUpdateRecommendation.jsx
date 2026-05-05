import React from 'react';
import {
  Alert,
  Box,
  Button,
  Typography,
  IconButton,
  Chip,
  LinearProgress
} from '@mui/material';
import {
  PersonAdd,
  Close,
  TrendingUp,
  Lightbulb
} from '@mui/icons-material';

const ProfileUpdateRecommendation = ({
  category,
  profileCompletion,
  onUpdateProfile,
  onDismiss,
  isVisible = true
}) => {
  if (!isVisible) return null;

  // Category-specific guidance
  const getCategoryGuidance = (category) => {
    switch (category) {
      case 'nextSteps':
        return {
          title: 'Next Step Roles',
          icon: <TrendingUp sx={{ fontSize: 20 }} />,
          suggestions: [
            'Add more professional experience details',
            'Specify your career goals and aspirations',
            'Include relevant skills and certifications',
            'Describe your preferred work environment'
          ]
        };
      case 'outsideTheBox':
        return {
          title: 'Outside-the-Box Roles',
          icon: <Lightbulb sx={{ fontSize: 20 }} />,
          suggestions: [
            'Add your interests and hobbies',
            'Include transferable skills from other fields',
            'Specify domains you\'d like to explore',
            'Describe your learning preferences'
          ]
        };
      default:
        return {
          title: 'Career Options',
          icon: <PersonAdd sx={{ fontSize: 20 }} />,
          suggestions: [
            'Complete your profile information',
            'Add more details about your background',
            'Specify your career preferences',
            'Include your skills and interests'
          ]
        };
    }
  };

  const guidance = getCategoryGuidance(category);
  const completionPercentage = Math.round(profileCompletion || 0);

  return (
    <Alert
      severity="info"
      sx={{
        mt: 2,
        mb: 2,
        borderRadius: 2,
        border: '1px solid var(--color-border-accent)',
        backgroundColor: 'var(--color-surface-hint)',
        '& .MuiAlert-message': {
          width: '100%'
        }
      }}
      action={
        <IconButton
          size="small"
          onClick={onDismiss}
          sx={{ color: 'primary.main' }}
        >
          <Close fontSize="small" />
        </IconButton>
      }
    >
      <Box sx={{ width: '100%' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          {guidance.icon}
          <Typography variant="h6" sx={{ ml: 1, fontWeight: 600, color: 'primary.main' }}>
            Discover More {guidance.title}
          </Typography>
        </Box>

        {/* Main Message */}
        <Typography variant="body1" sx={{ mb: 2, color: 'text.primary' }}>
          You've explored all available career options for this category. Consider updating your profile to discover more relevant opportunities.
        </Typography>

        {/* Profile Completion Status */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Profile Completion
            </Typography>
            <Chip
              label={`${completionPercentage}%`}
              size="small"
              color={completionPercentage >= 80 ? 'success' : completionPercentage >= 60 ? 'warning' : 'default'}
              variant="outlined"
            />
          </Box>
          <LinearProgress
            variant="determinate"
            value={completionPercentage}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: 'var(--color-track-neutral)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 3,
                backgroundColor:
                  completionPercentage >= 80
                    ? 'var(--color-success)'
                    : completionPercentage >= 60
                      ? 'var(--color-warning)'
                      : 'var(--color-primary-light)',
              }
            }}
          />
        </Box>

        {/* Suggestions */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
            To improve your results, consider:
          </Typography>
          <Box component="ul" sx={{ pl: 2, m: 0 }}>
            {guidance.suggestions.map((suggestion, index) => (
              <Typography
                key={index}
                component="li"
                variant="body2"
                sx={{ mb: 0.5, color: 'text.secondary' }}
              >
                {suggestion}
              </Typography>
            ))}
          </Box>
        </Box>

        {/* Call to Action */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Button
            variant="contained"
            startIcon={<PersonAdd />}
            onClick={onUpdateProfile}
            sx={{
              backgroundColor: 'primary.main',
              '&:hover': {
                backgroundColor: 'primary.dark'
              }
            }}
          >
            Update Profile
          </Button>
          <Typography variant="body2" color="text.secondary">
            Adding more details can help us suggest better career matches
          </Typography>
        </Box>
      </Box>
    </Alert>
  );
};

export default ProfileUpdateRecommendation;
