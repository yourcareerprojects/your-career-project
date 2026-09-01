import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../constants/profileCompletion';
import { hasActiveCareerSimulationSession } from '../utils/simulationPersistence';
import { useProfileCompletionQuery, useLastSimulationQuery } from './useProfileQueries';

/**
 * Target route for Simulation nav links.
 * While the server last-run query is in flight (e.g. right after login), prefer `/puzzle-job`
 * so users with a paused ranking are not sent to the empty hub.
 */
export function resolveCareerSimulationPath({
  hasSimulationSession,
  isAuthenticated,
  queryEnabled = true,
  lastSimQuery,
}) {
  if (hasSimulationSession) return '/puzzle-job';
  if (!isAuthenticated || !queryEnabled) return '/simulation';

  const { data, isError, isLoading, isFetched } = lastSimQuery;

  if (!isFetched || isLoading) {
    return '/puzzle-job';
  }

  if (isError) return '/simulation';
  if (data?.results) return '/puzzle-job';
  return '/simulation';
}

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

  const careerSimulationPath = useMemo(
    () =>
      resolveCareerSimulationPath({
        hasSimulationSession,
        isAuthenticated,
        queryEnabled: lastSimEnabled,
        lastSimQuery,
      }),
    [hasSimulationSession, isAuthenticated, lastSimEnabled, lastSimQuery]
  );

  return { canAccessSavedPages, careerSimulationPath, isAuthenticated };
};

/** Routes that belong to the Saved & Search section in the nav. */
export const SAVED_SEARCH_PATHS = [
  '/saved-search',
  '/history',
  '/explore-roles',
  '/saved-paths',
];

export const isSavedSearchPath = (pathname) =>
  SAVED_SEARCH_PATHS.includes(pathname) ||
  pathname.startsWith('/saved-paths/') ||
  pathname.startsWith('/role/');

export const isSimulationPath = (pathname) =>
  pathname === '/simulation' ||
  pathname === '/puzzle-job' ||
  pathname === '/simulation/results' ||
  pathname.startsWith('/simulation/result/') ||
  pathname.startsWith('/simulation/path/');

export const isProfilePath = (pathname) =>
  pathname === '/profile' || pathname.startsWith('/profile/');
