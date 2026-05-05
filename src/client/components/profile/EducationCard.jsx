import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  Box,
  Chip,
  IconButton,
  Tooltip,
  Collapse,
  Button,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Paper,
  Divider
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  LocationOn as LocationIcon,
  CalendarToday as CalendarIcon,
  School as SchoolIcon
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';

const EducationCard = ({ 
  education, 
  index, 
  onEdit, 
  onDelete, 
  onSave, 
  onCancel,
  isEditing = false,
  loading = false,
  errors = {},
  showActionButtons = true
}) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [formData, setFormData] = useState({
    degree: education.degree || '',
    institution: education.institution || '',
    field: education.field || '',
    startDate: education.startDate || '',
    endDate: education.endDate || '',
    description: education.description || '',
    honors: education.honors || [],
    coursework: education.coursework || [],
    skills: education.skills || []
  });
  const [startYearInput, setStartYearInput] = useState(
    education.startDate ? new Date(education.startDate).getFullYear().toString() : ''
  );

  const isCurrentEducation = !education.endDate || education.endDate === '';
  const duration = calculateDuration(education.startDate, education.endDate);

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = () => {
    onSave(index, formData);
  };

  const handleCancel = () => {
    setFormData({
      degree: education.degree || '',
      institution: education.institution || '',
      field: education.field || '',
      startDate: education.startDate || '',
      endDate: education.endDate || '',
      description: education.description || '',
      honors: education.honors || [],
      coursework: education.coursework || [],
      skills: education.skills || []
    });
    onCancel(index);
  };

  const getDegreeTypeColor = (degree) => {
    if (!degree) return 'default';
    
    const degreeLower = degree.toLowerCase();
    if (degreeLower.includes('phd') || degreeLower.includes('doctorate')) return 'error';
    if (degreeLower.includes('master') || degreeLower.includes('msc') || degreeLower.includes('ma')) return 'warning';
    if (degreeLower.includes('bachelor') || degreeLower.includes('bsc') || degreeLower.includes('ba')) return 'primary';
    if (degreeLower.includes('associate') || degreeLower.includes('diploma')) return 'secondary';
    return 'default';
  };

  // If in editing mode, render the edit form
  if (isEditing) {
    return (
      <Card 
        elevation={3}
        sx={{ 
          mb: 2,
          border: '1px solid var(--color-border-default)',
          borderRadius: 2
        }}
      >
        <CardHeader
          title={
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Edit Education #{index + 1}
            </Typography>
          }
          action={
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Delete">
                <IconButton 
                  onClick={() => onDelete(index)} 
                  disabled={loading}
                  color="error"
                >
                  <DeleteIcon />
                </IconButton>
              </Tooltip>
            </Box>
          }
        />
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Degree"
                value={formData.degree}
                onChange={(e) => handleChange('degree', e.target.value)}
                disabled={loading}
                error={!!errors.degree}
                helperText={errors.degree}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Institution"
                value={formData.institution}
                onChange={(e) => handleChange('institution', e.target.value)}
                disabled={loading}
                error={!!errors.institution}
                helperText={errors.institution}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                required
                fullWidth
                label="Field of Study"
                value={formData.field}
                onChange={(e) => handleChange('field', e.target.value)}
                disabled={loading}
                error={!!errors.field}
                helperText={errors.field}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                required
                fullWidth
                type="number"
                label="Start Year"
                value={startYearInput}
                onChange={(e) => {
                  const year = e.target.value;
                  setStartYearInput(year);
                  if (year === '') {
                    handleChange('startDate', '');
                  } else if (year && !isNaN(year) && year >= 1900 && year <= new Date().getFullYear()) {
                    handleChange('startDate', `${year}-01-01`);
                  }
                }}
                onBlur={() => {
                  const year = parseInt(startYearInput);
                  if (startYearInput && !isNaN(year) && year >= 1900 && year <= new Date().getFullYear()) {
                    handleChange('startDate', `${year}-01-01`);
                  } else if (startYearInput === '') {
                    handleChange('startDate', '');
                  }
                }}
                disabled={loading}
                InputLabelProps={{ shrink: true }}
                error={!!errors.startDate}
                helperText={errors.startDate}
                inputProps={{ min: 1900, max: new Date().getFullYear() }}
                placeholder="e.g., 2020"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="date"
                label="End Date"
                value={formData.endDate}
                onChange={(e) => handleChange('endDate', e.target.value)}
                disabled={loading}
                InputLabelProps={{ shrink: true }}
                helperText="Leave empty if currently studying"
                error={!!errors.endDate}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Description"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                disabled={loading}
                placeholder="Describe your education program, key learnings, or achievements..."
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card 
      elevation={isCurrentEducation ? 3 : 2}
      sx={{ 
        mb: 2,
        border: isCurrentEducation ? '1px solid var(--color-border-default)' : 'none',
        borderRadius: 2,
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          elevation: 4,
          transform: 'translateY(-2px)'
        }
      }}
    >
      <CardHeader
        sx={{ pb: 1 }}
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {education.degree || 'Degree not provided'}
            </Typography>
            {isCurrentEducation && (
              <Chip 
                label="Current" 
                variant="outlined"
                size="small"
                sx={{ 
                  borderColor: 'grey.400',
                  color: 'grey.600',
                  backgroundColor: 'grey.50',
                  fontWeight: 500
                }}
              />
            )}
          </Box>
        }
        subheader={
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 2, 
            mt: 1,
            flexWrap: 'wrap'
          }}>
            {/* Institution */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SchoolIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                {education.institution || 'Institution not specified'}
              </Typography>
            </Box>
            
            {/* Separator */}
            <Box sx={{ 
              width: '1px', 
              height: '16px', 
              backgroundColor: 'var(--color-track-neutral)',
              display: { xs: 'none', sm: 'block' }
            }} />
            
            {/* Field of Study */}
            {education.field && (
              <>
                <Chip
                  label={education.field}
                  color={getDegreeTypeColor(education.degree)}
                  size="small"
                />
                
                {/* Separator */}
                <Box sx={{ 
                  width: '1px', 
                  height: '16px', 
                  backgroundColor: 'var(--color-track-neutral)',
                  display: { xs: 'none', sm: 'block' }
                }} />
              </>
            )}
            
            {/* Date Range */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CalendarIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                {education.startDate ? new Date(education.startDate).getFullYear() : 'Start year not specified'} - 
                {education.endDate ? new Date(education.endDate).getFullYear() : 'Present'}
              </Typography>
            </Box>
          </Box>
        }
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            {/* Only show delete button if showActionButtons is true (edit mode) */}
            {showActionButtons && (
              <Tooltip title="Delete">
                <IconButton 
                  onClick={() => onDelete(index)} 
                  disabled={loading}
                  color="error"
                >
                  <DeleteIcon />
                </IconButton>
              </Tooltip>
            )}
            
            {/* Expand/Collapse button - only show if there's expandable content */}
            {(education.description || 
              (education.coursework && education.coursework.length > 0) || 
              (education.skills && education.skills.length > 0) || 
              (education.honors && education.honors.length > 0)) && (
              <Tooltip title={expanded ? "Show less" : "Show more"}>
                <IconButton 
                  onClick={() => setExpanded(!expanded)}
                  sx={{ 
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease-in-out'
                  }}
                >
                  <ExpandMoreIcon />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        }
      />
      
      <CardContent sx={{ pt: 0 }}>
        {/* Quick Info */}
        {(education.location || education.gpa) && (
          <Box sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {education.location && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationIcon fontSize="small" color="action" />
                  <Typography variant="body2" color="text.secondary">
                    {education.location}
                  </Typography>
                </Box>
              )}
              {education.gpa && (
                <Chip 
                  label={`GPA: ${education.gpa}`} 
                  size="small" 
                  variant="outlined" 
                  color="info"
                />
              )}
            </Box>
          </Box>
        )}

        {/* Expandable Details */}
        <Collapse in={expanded}>
          <Divider sx={{ my: 1.5 }} />
          
          {/* Description */}
          {education.description && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Description
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {education.description}
              </Typography>
            </Box>
          )}

          {/* Coursework */}
          {education.coursework && education.coursework.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Relevant Coursework
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {education.coursework.map((course, idx) => (
                  <Chip
                    key={idx}
                    label={course}
                    size="small"
                    variant="outlined"
                    color="primary"
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Skills Developed */}
          {education.skills && education.skills.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Skills Developed
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {education.skills.map((skill, idx) => (
                  <Chip
                    key={idx}
                    label={skill}
                    size="small"
                    variant="outlined"
                    color="secondary"
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Honors/Awards */}
          {education.honors && education.honors.length > 0 && (
            <Box sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Honors & Awards
              </Typography>
              <Box component="ul" sx={{ pl: 2, m: 0 }}>
                {education.honors.map((honor, idx) => (
                  <Typography key={idx} component="li" variant="body2" color="text.secondary">
                    {honor}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}
        </Collapse>
      </CardContent>
    </Card>
  );
};

// Helper function to calculate duration
const calculateDuration = (startDate, endDate) => {
  if (!startDate) return 'Duration unknown';
  
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  
  if (isNaN(start.getTime())) return 'Invalid start date';
  if (isNaN(end.getTime())) return 'Invalid end date';
  
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  
  if (years > 0) {
    return months > 0 ? `${years}y ${months}m` : `${years}y`;
  } else if (months > 0) {
    return `${months}m`;
  } else {
    return 'Less than 1 month';
  }
};

export default EducationCard;
