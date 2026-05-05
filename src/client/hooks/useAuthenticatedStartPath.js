import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../constants/profileCompletion';
import { queryClient } from '../queryClient';
import { profileCompletionQueryKey, fetchProfileCompletion, useProfileCompletionQuery } from './useProfileQueries';

/**
 * Resolves the post-login “get started” route for the current session.
 * `/simulation` if profile meets the minimum completion for simulations, otherwise `/profile/fill`.
 */
export async function fetchAuthenticatedStartPath() {
  try {
    const data = await queryClient.fetchQuery(profileCompletionQueryKey, fetchProfileCompletion);
    const overall = Number(data?.completion?.overall ?? 0);
    return overall >= MIN_PROFILE_COMPLETION_REQUIRED ? '/simulation' : '/profile/fill';
  } catch {
    return '/profile/fill';
  }
}

/**
 * Prefetches the start path when logged in (for instant navigation once ready).
 * Does not block the UI — use {@link fetchAuthenticatedStartPath} on click if `ready` is still false.
 */
export function useAuthenticatedStartPath() {
  const { isAuthenticated } = useAuth();
  const completionQuery = useProfileCompletionQuery({ enabled: isAuthenticated });

  const path = useMemo(() => {
    if (!isAuthenticated) return '/profile/fill';
    if (!completionQuery.data) return '/profile/fill';
    const overall = Number(completionQuery.data?.completion?.overall ?? 0);
    return overall >= MIN_PROFILE_COMPLETION_REQUIRED ? '/simulation' : '/profile/fill';
  }, [isAuthenticated, completionQuery.data]);

  const ready = !isAuthenticated || !completionQuery.isLoading;

  return { path, ready };
}
