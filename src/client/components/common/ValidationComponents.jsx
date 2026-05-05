import React from 'react';
import { TextField, FormControl, InputLabel, Select, MenuItem, Typography, Box } from '@mui/material';
import { styled } from '@mui/material/styles';

// Styled components for validation styling
const RequiredTextField = styled(TextField)(({ theme, hasError }) => ({
  '& .MuiOutlinedInput-root': {
    '& fieldset': {
      borderColor: hasError ? theme.palette.error.main : undefined,
      borderWidth: hasError ? '2px' : undefined,
    },
    '&:hover fieldset': {
      borderColor: hasError ? theme.palette.error.main : undefined,
    },
    '&.Mui-focused fieldset': {
      borderColor: hasError ? theme.palette.error.main : undefined,
    },
    backgroundColor: hasError ? theme.palette.error.light + '10' : undefined,
  },
}));

const RequiredFormControl = styled(FormControl)(({ theme, hasError }) => ({
  '& .MuiOutlinedInput-root': {
    '& fieldset': {
      borderColor: hasError ? theme.palette.error.main : undefined,
      borderWidth: hasError ? '2px' : undefined,
    },
    '&:hover fieldset': {
      borderColor: hasError ? theme.palette.error.main : undefined,
    },
    '&.Mui-focused fieldset': {
      borderColor: hasError ? theme.palette.error.main : undefined,
    },
    backgroundColor: hasError ? theme.palette.error.light + '10' : undefined,
  },
}));

const ErrorMessage = styled(Typography)(({ theme }) => ({
  color: theme.palette.error.main,
  fontSize: '0.75rem',
  marginTop: '4px',
  marginLeft: '14px',
}));

const RequiredLabel = styled(Typography)(({ theme, isRequired }) => ({
  fontWeight: isRequired ? 'bold' : 'normal',
  '&::after': isRequired ? {
    content: '" *"',
    color: theme.palette.error.main,
    fontWeight: 'normal',
  } : {},
}));

// Validation message component
export const ValidationMessage = ({ error, fieldName }) => {
  if (!error) return null;
  
  const message = error === true ? `${fieldName} is required.` : error;
  
  return (
    <ErrorMessage variant="caption">
      {message}
    </ErrorMessage>
  );
};

// Required field wrapper for TextField
export const RequiredTextFieldWrapper = ({ 
  required = false, 
  error, 
  fieldName, 
  children, 
  ...props 
}) => {
  const hasError = !!error;
  
  return (
    <Box>
      <RequiredTextField
        {...props}
        hasError={hasError}
        required={required}
        error={hasError}
        helperText={hasError ? undefined : props.helperText}
        InputLabelProps={{
          ...props.InputLabelProps,
          required: required,
        }}
      />
      {hasError && (
        <ValidationMessage error={error} fieldName={fieldName} />
      )}
    </Box>
  );
};

// Required field wrapper for Select/FormControl
export const RequiredSelectWrapper = ({ 
  required = false, 
  error, 
  fieldName, 
  children, 
  ...props 
}) => {
  const hasError = !!error;
  
  return (
    <Box>
      <RequiredFormControl
        {...props}
        hasError={hasError}
        required={required}
        error={hasError}
      >
        {children}
      </RequiredFormControl>
      {hasError && (
        <ValidationMessage error={error} fieldName={fieldName} />
      )}
    </Box>
  );
};

// Field label component with required indicator
export const FieldLabel = ({ required = false, children, ...props }) => {
  return (
    <RequiredLabel isRequired={required} {...props}>
      {children}
    </RequiredLabel>
  );
};

export default {
  RequiredTextFieldWrapper,
  RequiredSelectWrapper,
  FieldLabel,
  ValidationMessage,
};
