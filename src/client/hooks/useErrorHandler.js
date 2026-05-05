import { useState } from 'react';

// Error types and handling
export const ERROR_TYPES = {
  NETWORK: 'network',
  VALIDATION: 'validation',
  AUTHORIZATION: 'authorization',
  NOT_FOUND: 'not_found',
  SERVER: 'server',
  TIMEOUT: 'timeout'
};

export const ERROR_MESSAGES = {
  [ERROR_TYPES.NETWORK]: 'Network connection failed. Please check your internet connection.',
  [ERROR_TYPES.VALIDATION]: 'Invalid request data. Please try again.',
  [ERROR_TYPES.AUTHORIZATION]: 'You are not authorized to perform this action.',
  [ERROR_TYPES.NOT_FOUND]: 'The requested career step was not found.',
  [ERROR_TYPES.SERVER]: 'Server error occurred. Please try again later.',
  [ERROR_TYPES.TIMEOUT]: 'Request timed out. Please try again.'
};

const classifyError = (error) => {
  if (!error) return ERROR_TYPES.SERVER;
  
  // Network errors
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || 
      error.message?.includes('Network Error') || error.message?.includes('fetch')) {
    return ERROR_TYPES.NETWORK;
  }
  
  // Timeout errors
  if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
    return ERROR_TYPES.TIMEOUT;
  }
  
  // HTTP status code based classification
  if (error.response?.status) {
    const status = error.response.status;
    if (status === 401 || status === 403) return ERROR_TYPES.AUTHORIZATION;
    if (status === 404) return ERROR_TYPES.NOT_FOUND;
    if (status >= 400 && status < 500) return ERROR_TYPES.VALIDATION;
    if (status >= 500) return ERROR_TYPES.SERVER;
  }
  
  // Validation errors
  if (error.name === 'ValidationError' || error.message?.includes('validation')) {
    return ERROR_TYPES.VALIDATION;
  }
  
  // Authorization errors
  if (error.name === 'UnauthorizedError' || error.message?.includes('unauthorized')) {
    return ERROR_TYPES.AUTHORIZATION;
  }
  
  // Not found errors
  if (error.name === 'NotFoundError' || error.message?.includes('not found')) {
    return ERROR_TYPES.NOT_FOUND;
  }
  
  return ERROR_TYPES.SERVER;
};

const getErrorMessage = (error) => {
  const errorType = classifyError(error);
  return ERROR_MESSAGES[errorType] || 'An unexpected error occurred. Please try again.';
};

const useErrorHandler = () => {
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retryTimeout, setRetryTimeout] = useState(null);

  const handleError = (error, context = {}) => {
    const errorInfo = {
      type: classifyError(error),
      message: getErrorMessage(error),
      details: error.message || error.toString(),
      context: context,
      timestamp: new Date().toISOString(),
      retryCount: retryCount,
      originalError: error
    };
    
    console.error('Error handled:', errorInfo);
    setError(errorInfo);
    
    // Auto-retry for network errors with exponential backoff
    if (errorInfo.type === ERROR_TYPES.NETWORK && retryCount < 3) {
      const delay = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s
      const timeout = setTimeout(() => {
        setRetryCount(prev => prev + 1);
        // Trigger retry logic if provided
        if (context.onRetry && typeof context.onRetry === 'function') {
          context.onRetry();
        }
      }, delay);
      setRetryTimeout(timeout);
    }
  };

  const clearError = () => {
    setError(null);
    setRetryCount(0);
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      setRetryTimeout(null);
    }
  };

  const retry = () => {
    if (error && error.context?.onRetry) {
      clearError();
      error.context.onRetry();
    }
  };

  return { 
    error, 
    handleError, 
    clearError, 
    retry,
    isRetrying: retryCount > 0
  };
};

export default useErrorHandler;
