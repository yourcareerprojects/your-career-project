import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../constants/profileCompletion';
import { hasActiveCareerSimulationSession } from '../utils/simulationPersistence';
import { useProfileCompletionQuery, useLastSimulationQuery } from './useProfileQueries';

/**
 * Shared navigation state for the sidebar and mobile bottom nav.
 */
export const useAppNavigation = () => {
  const { isAuthenticated, user } = useAuth();
  const completionQuery = useProfileCompletionQuery({ enabled: isAuthenticated });
  const hasSimulationSession = hasActiveCareerSimulationSession();
  const lastSimEnabled = isAuthenticated && !hasSimulationSession;
  const lastSimQuery = useLastSimulationQuery({ enabled: lastSimEnabled });

  const canAccessSavedPages = useMemo(() => {
    if (!isAuthenticated || !user?.isVerified || !completionQuery.data) return false;
    return Number(completionQuery.data?.completion?.overall || 0) >= MIN_PROFILE_COMPLETION_REQUIRED;
  }, [isAuthenticated, user?.isVerified, completionQuery.data]);

  const careerSimulationPath = useMemo(() => {
    if (hasSimulationSession) return '/simulation/results';
    if (lastSimQuery.isError || lastSimQuery.data == null) return '/simulation';
    return lastSimQuery.data?.results ? '/simulation/results' : '/simulation';
  }, [hasSimulationSession, lastSimQuery.data, lastSimQuery.isError]);

  return { canAccessSavedPages, careerSimulationPath, isAuthenticated };
};

/** Routes that belong to the Saved & Search section in the bottom nav. */
export const SAVED_SEARCH_PATHS = [
  '/saved-search',
  '/explore-roles',
  '/simulations',
  '/saved-steps',
];

export const isSavedSearchPath = (pathname) =>
  SAVED_SEARCH_PATHS.includes(pathname) ||
  pathname.startsWith('/role/') ||
  pathname.startsWith('/saved-career-step/') ||
  pathname.startsWith('/saved-simulation/') ||
  (pathname.startsWith('/simulation/') &&
    pathname !== '/simulation' &&
    pathname !== '/simulation/results' &&
    !pathname.startsWith('/simulation/result/'));

export const isSimulationPath = (pathname) =>
  pathname === '/simulation' ||
  pathname === '/simulation/results' ||
  pathname.startsWith('/simulation/result/');

export const isProfilePath = (pathname) =>
  pathname === '/profile' || pathname.startsWith('/profile/');
