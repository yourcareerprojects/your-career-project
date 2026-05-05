import React, { useState, useEffect } from 'react';
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
  Paper,
  Divider
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CalendarToday as CalendarIcon,
  Verified as VerifiedIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';

const CertificationCard = React.memo(({ 
  certification, 
  index, 
  onEdit, 
  onDelete, 
  onSave, 
  onCancel,
  isEditing = false,
  loading = false,
  errors = {},
  showActionButtons = true,
  onFieldChange
}) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [issueYearInput, setIssueYearInput] = useState(
    certification.date ? new Date(certification.date).getFullYear().toString() : ''
  );
  const [expiryYearInput, setExpiryYearInput] = useState(
    certification.expiryDate ? new Date(certification.expiryDate).getFullYear().toString() : ''
  );

  // Simple useEffect to update year inputs when certification changes
  useEffect(() => {
    setIssueYearInput(certification.date ? new Date(certification.date).getFullYear().toString() : '');
    setExpiryYearInput(certification.expiryDate ? new Date(certification.expiryDate).getFullYear().toString() : '');
  }, [certification.date, certification.expiryDate]);


  const isCurrentCertification = !certification.expiryDate || certification.expiryDate === '';
  const isExpired = certification.expiryDate && new Date(certification.expiryDate) < new Date();
  const isExpiringSoon = certification.expiryDate && 
    new Date(certification.expiryDate) <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) && 
    new Date(certification.expiryDate) > new Date();


  const handleSave = () => {
    // Since we're using direct prop binding, the parent already has the latest data
    onSave(index, certification);
  };

  const handleCancel = () => {
    setIssueYearInput(certification.date ? new Date(certification.date).getFullYear().toString() : '');
    setExpiryYearInput(certification.expiryDate ? new Date(certification.expiryDate).getFullYear().toString() : '');
    onCancel(index);
  };

  const getStatusColor = () => {
    if (isExpired) return 'error';
    if (isExpiringSoon) return 'warning';
    if (isCurrentCertification) return 'success';
    return 'default';
  };

  const getStatusIcon = () => {
    if (isExpired) return <WarningIcon fontSize="small" />;
    if (isExpiringSoon) return <WarningIcon fontSize="small" />;
    if (isCurrentCertification) return <CheckCircleIcon fontSize="small" />;
    return <VerifiedIcon fontSize="small" />;
  };

  const getStatusText = () => {
    if (isExpired) return 'Expired';
    if (isExpiringSoon) return 'Expiring Soon';
    if (isCurrentCertification) return 'Current';
    return 'Valid';
  };

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
            <Typography variant="subtitle1">
              Certification #{index + 1}
            </Typography>
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
            </Box>
          }
        />
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                required
                fullWidth
                label="Certification Name"
                value={certification.name || ''}
                onChange={(e) => onFieldChange('name', e.target.value)}
                disabled={loading}
                error={!!errors.name}
                helperText={errors.name}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                required
                fullWidth
                label="Issuing Organization"
                value={certification.issuer || ''}
                onChange={(e) => onFieldChange('issuer', e.target.value)}
                disabled={loading}
                error={!!errors.issuer}
                helperText={errors.issuer}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                required
                fullWidth
                type="number"
                label="Issue Year"
                value={issueYearInput}
                onChange={(e) => {
                  const year = e.target.value;
                  setIssueYearInput(year);
                  if (year === '') {
                    onFieldChange('date', '');
                  } else if (year && !isNaN(year) && year >= 1900 && year <= new Date().getFullYear()) {
                    onFieldChange('date', `${year}-01-01`);
                  }
                }}
                onBlur={() => {
                  const year = parseInt(issueYearInput);
                  if (issueYearInput && !isNaN(year) && year >= 1900 && year <= new Date().getFullYear()) {
                    onFieldChange('date', `${year}-01-01`);
                  } else if (issueYearInput === '') {
                    onFieldChange('date', '');
                  }
                }}
                disabled={loading}
                InputLabelProps={{ shrink: true }}
                error={!!errors.date}
                helperText={errors.date}
                inputProps={{ min: 1900, max: new Date().getFullYear() }}
                placeholder="e.g., 2020"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Expiry Year"
                value={expiryYearInput}
                onChange={(e) => {
                  const year = e.target.value;
                  setExpiryYearInput(year);
                  if (year === '') {
                    onFieldChange('expiryDate', '');
                  } else if (year && !isNaN(year) && year >= 1900 && year <= new Date().getFullYear() + 10) {
                    onFieldChange('expiryDate', `${year}-01-01`);
                  }
                }}
                onBlur={() => {
                  const year = parseInt(expiryYearInput);
                  if (expiryYearInput && !isNaN(year) && year >= 1900 && year <= new Date().getFullYear() + 10) {
                    onFieldChange('expiryDate', `${year}-01-01`);
                  } else if (expiryYearInput === '') {
                    onFieldChange('expiryDate', '');
                  }
                }}
                disabled={loading}
                InputLabelProps={{ shrink: true }}
                helperText="Leave empty if no expiry"
                inputProps={{ min: 1900, max: new Date().getFullYear() + 10 }}
                placeholder="e.g., 2025"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Description"
                value={certification.description || ''}
                onChange={(e) => onFieldChange('description', e.target.value)}
                disabled={loading}
                placeholder="Describe the certification, key learnings, or achievements..."
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Verification URL"
                value={certification.verificationUrl || ''}
                onChange={(e) => onFieldChange('verificationUrl', e.target.value)}
                disabled={loading}
                placeholder="https://example.com/verify/certificate"
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card 
      elevation={isCurrentCertification ? 3 : 2}
      sx={{ 
        mb: 2,
        border: isCurrentCertification ? '1px solid var(--color-border-default)' : 'none',
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
              {certification.name || 'Certification not provided'}
            </Typography>
            <Chip 
              label={getStatusText()} 
              variant="outlined"
              size="small"
              color={getStatusColor()}
              icon={getStatusIcon()}
              sx={{ 
                fontWeight: 500
              }}
            />
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
            {/* Issuer */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <VerifiedIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                {certification.issuer || 'Issuer not specified'}
              </Typography>
            </Box>
            
            {/* Separator */}
            <Box sx={{ 
              width: '1px', 
              height: '16px', 
              backgroundColor: 'var(--color-track-neutral)',
              display: { xs: 'none', sm: 'block' }
            }} />
            
            {/* Date Range */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CalendarIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                {certification.date ? new Date(certification.date).getFullYear() : 'Issue year not specified'} - 
                {certification.expiryDate ? new Date(certification.expiryDate).getFullYear() : 'No expiry'}
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
            {(certification.description || 
              (certification.skills && certification.skills.length > 0) || 
              certification.verificationUrl) && (
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
        {/* Expandable Details */}
        <Collapse in={expanded}>
          <Divider sx={{ my: 1.5 }} />
          
          {/* Description */}
          {certification.description && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Description
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {certification.description}
              </Typography>
            </Box>
          )}

          {/* Skills */}
          {certification.skills && certification.skills.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Skills Gained
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {certification.skills.map((skill, idx) => (
                  <Chip
                    key={idx}
                    label={skill}
                    size="small"
                    variant="outlined"
                    color="primary"
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Verification */}
          {certification.verificationUrl && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Verification
              </Typography>
              <Button
                variant="outlined"
                size="small"
                href={certification.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<VerifiedIcon />}
              >
                View Certificate
              </Button>
            </Box>
          )}
        </Collapse>
      </CardContent>
    </Card>
  );
});

export default CertificationCard;
