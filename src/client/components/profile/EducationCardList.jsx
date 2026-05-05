import React from 'react';
import { Box, Typography } from '@mui/material';
import EducationCard from './EducationCard';

const EducationCardList = ({ 
  educationList = [], 
  onEdit, 
  onDelete, 
  onSave, 
  onCancel,
  loading = false,
  errors = {},
  showActionButtons = true
}) => {
  // If no education entries, show empty state
  if (!educationList || educationList.length === 0) {
    return (
      <Box sx={{ mt: 2, mb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          Education
        </Typography>
        <Typography 
          variant="body2" 
          color="text.disabled" 
          sx={{ 
            fontStyle: 'italic',
            textAlign: 'center',
            py: 2
          }}
        >
          No education provided
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 2, mb: 1 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        Education
      </Typography>
      {educationList.map((education, index) => (
        <EducationCard
          key={index}
          education={education}
          index={index}
          onEdit={onEdit}
          onDelete={onDelete}
          onSave={onSave}
          onCancel={onCancel}
          isEditing={false}
          loading={loading}
          errors={errors}
          showActionButtons={showActionButtons}
        />
      ))}
    </Box>
  );
};

export default EducationCardList;
