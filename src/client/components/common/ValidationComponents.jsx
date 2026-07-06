import React from 'react';
import { TextField, FormControl, Typography, Box } from '@mui/material';
import { styled } from '@mui/material/styles';

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

export const ValidationMessage = ({ error, fieldName }) => {
  if (!error) return null;

  const message = error === true ? `${fieldName} is required.` : error;

  return (
    <ErrorMessage variant="caption">
      {message}
    </ErrorMessage>
  );
};

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
