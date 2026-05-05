import React, { useState } from 'react';
import { Box, Typography, Paper, Button } from '@mui/material';
import { RequiredTextFieldWrapper, RequiredSelectWrapper } from '../common/ValidationComponents';

// Simple test component to verify validation components work
const ValidationTest = () => {
  const [formData, setFormData] = useState({
    title: '',
    company: '',
    location: '',
    industry: ''
  });

  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.title.trim()) {
      newErrors.title = 'Job title is required';
    }
    
    if (!formData.company.trim()) {
      newErrors.company = 'Company is required';
    }
    
    if (!formData.location.trim()) {
      newErrors.location = 'Location is required';
    }
    
    if (!formData.industry.trim()) {
      newErrors.industry = 'Industry/Sector is required';
    }

    console.log('Test validation errors:', newErrors);
    setErrors(newErrors);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    validateForm();
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Validation Components Test
      </Typography>
      
      <Paper elevation={2} sx={{ p: 3 }}>
        <Box component="form" onSubmit={handleSubmit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <RequiredTextFieldWrapper
              required
              fullWidth
              label="Job Title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              error={errors.title}
              fieldName="Job Title"
            />

            <RequiredTextFieldWrapper
              required
              fullWidth
              label="Company"
              name="company"
              value={formData.company}
              onChange={handleChange}
              error={errors.company}
              fieldName="Company"
            />

            <RequiredTextFieldWrapper
              required
              fullWidth
              label="Location"
              name="location"
              value={formData.location}
              onChange={handleChange}
              error={errors.location}
              fieldName="Location"
              helperText="City, Country"
            />

            <RequiredTextFieldWrapper
              required
              fullWidth
              label="Industry/Sector"
              name="industry"
              value={formData.industry}
              onChange={handleChange}
              error={errors.industry}
              fieldName="Industry/Sector"
            />

            <Button
              type="submit"
              variant="contained"
              sx={{ mt: 2 }}
            >
              Test Validation
            </Button>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};

export default ValidationTest;
