import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { clearAppQueryCache } from '../hooks/useProfileQueries';
import { clearAllCvReviewDrafts } from '../utils/cvReviewDraftStorage';
import { clearSimulationSessionForAuthChange } from '../utils/simulationPersistence';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const clearAuthState = useCallback(() => {
    localStorage.removeItem('token');
    delete axios.defaults.headers.common['Authorization'];
    clearAppQueryCache();
    clearAllCvReviewDrafts();
    clearSimulationSessionForAuthChange();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      return { success: false, skipped: true };
    }

    try {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      const response = await axios.get('/api/auth/me');
      setUser(response.data.user);
      setIsAuthenticated(true);
      return { success: true, user: response.data.user };
    } catch (error) {
      console.error('User refresh failed:', error);
      clearAuthState();
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Failed to refresh user'
      };
    }
  }, [clearAuthState]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await refreshUser();
      } catch (error) {
        console.error('Auth check failed:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [refreshUser]);

  const login = async (email, password) => {
    try {
      const response = await axios.post('/api/auth/login', { email, password });
      const { token, user } = response.data;
      
      localStorage.setItem('token', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      clearAppQueryCache();
      clearSimulationSessionForAuthChange();

      setUser(user);
      setIsAuthenticated(true);
      return { success: true };
    } catch (error) {
      console.error('Login failed:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.response?.data?.message || 'Login failed',
      };
    }
  };

  const register = async (userData) => {
    try {
      const response = await axios.post('/api/auth/register', userData);
      const { token, user } = response.data;
      
      localStorage.setItem('token', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      clearAppQueryCache();
      clearSimulationSessionForAuthChange();

      setUser(user);
      setIsAuthenticated(true);
      return { success: true };
    } catch (error) {
      console.error('Registration failed:', error);
      // Handle validation errors
      if (error.response?.data?.errors) {
        const validationErrors = error.response.data.errors;
        const errorMessage = validationErrors.map(err => err.msg).join(', ');
        return {
          success: false,
          error: errorMessage
        };
      }
      // Handle other errors
      return {
        success: false,
        error: error.response?.data?.error || error.response?.data?.message || 'Registration failed'
      };
    }
  };

  const logout = () => {
    clearAuthState();
  };

  const updateUser = (userData) => {
    setUser((prevUser) => ({ ...prevUser, ...userData }));
  };

  const resendVerificationEmail = async (options = {}) => {
    const payload = {};
    if (options.token) {
      payload.token = options.token;
    } else if (options.email) {
      payload.email = options.email;
    } else if (user?.email) {
      payload.email = user.email;
    }

    try {
      const response = await axios.post('/api/auth/resend-verification', payload);
      return { success: true, message: response.data?.message || 'Verification email sent.' };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to resend verification email'
      };
    }
  };

  const value = {
    user,
    isAuthenticated,
    loading,
    login,
    register,
    logout,
    refreshUser,
    updateUser,
    resendVerificationEmail
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
