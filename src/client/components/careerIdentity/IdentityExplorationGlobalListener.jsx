import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { queryClient } from '../../queryClient';
import {
  applyExplorationPreparingHint,
  careerIdentityExplorationLatestKey,
  clearExplorationActivityWatch,
  getCareerIdentityQueryKeyFull,
  invalidateCareerIdentityQueries,
  isWatchingExplorationAfterActivity,
  useCareerIdentityQuery,
  useLatestExplorationQuery,
} from '../../hooks/useCareerIdentityQueries';
import { resolveExplorationNotification } from '../../utils/resolveExplorationNotification';

function applyDeliveredExplorationHint(payload = {}) {
  // Never optimistically force "delivered" — a late pipeline completion after
  // consume could revive the Discover CTA. Always refetch server truth.
  clearExplorationActivityWatch();
  invalidateCareerIdentityQueries();
  if (payload?.sessionId) {
    queryClient.invalidateQueries(careerIdentityExplorationLatestKey);
  }
}

/**
 * App-wide listener for identity exploration pipeline updates.
 * Keeps career-identity queries fresh so the progress card can show
 * ready / delivered state without a manual refresh.
 * Discovery CTA lives on the Career Identity progress card (not a toast).
 */
export default function IdentityExplorationGlobalListener() {
  const { isAuthenticated } = useAuth();
  const identityQuery = useCareerIdentityQuery({ enabled: isAuthenticated });
  const latestExplorationQuery = useLatestExplorationQuery({ enabled: isAuthenticated });
  const phase = identityQuery.data?.explorationProgress?.phase;
  const activityPending = Boolean(identityQuery.data?.explorationProgress?.activityPending);
  const notification = resolveExplorationNotification(
    identityQuery.data,
    latestExplorationQuery.data
  );
  const awaitingDelivery =
    !notification?.hasUnreadExploration
    && (phase === 'ready' || phase === 'preparing');

  // Re-render when an activity watch window starts/ends so polling can engage.
  const [, setWatchTick] = useState(0);
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    if (!isWatchingExplorationAfterActivity() && !activityPending) return undefined;
    const timer = setInterval(() => {
      setWatchTick((n) => n + 1);
    }, 1_000);
    return () => clearInterval(timer);
  }, [isAuthenticated, activityPending]);

  const watchingActivity = isWatchingExplorationAfterActivity() || activityPending;

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const refetch = latestExplorationQuery.refetch;
    const timer = setInterval(() => {
      if (typeof refetch === 'function') refetch();
    }, 45_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll while authenticated only
  }, [isAuthenticated]);

  // Poll while roles are being prepared, or right after identity-affecting writes
  // (profile edits) so progress can leave a stale 0% without a manual reload.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    if (!awaitingDelivery && !watchingActivity) return undefined;

    const refetchIdentity = identityQuery.refetch;
    const refetchLatest = latestExplorationQuery.refetch;
    const timer = setInterval(() => {
      if (typeof refetchIdentity === 'function') refetchIdentity();
      if (typeof refetchLatest === 'function') refetchLatest();
      if (!isWatchingExplorationAfterActivity() && !awaitingDelivery) {
        queryClient.setQueryData(getCareerIdentityQueryKeyFull(), (prev) => {
          if (!prev?.explorationProgress?.activityPending) return prev;
          return {
            ...prev,
            explorationProgress: {
              ...prev.explorationProgress,
              activityPending: false,
            },
          };
        });
      }
    }, 1_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- driven by delivery / activity wait
  }, [isAuthenticated, awaitingDelivery, watchingActivity]);

  // Clear the recalculating hint once server progress has moved or unlocked.
  useEffect(() => {
    if (!activityPending) return;
    const progress = identityQuery.data?.explorationProgress;
    if (!progress) return;
    const percent = Number(progress.progressPercent) || 0;
    const unlocked =
      progress.phase === 'ready'
      || progress.phase === 'preparing'
      || progress.phase === 'delivered'
      || Boolean(notification?.hasUnreadExploration);

    if (unlocked) {
      clearExplorationActivityWatch();
    }

    // Keep pending at true 0% accumulating only while the watch window is open.
    if (
      progress.phase === 'accumulating'
      && percent === 0
      && isWatchingExplorationAfterActivity()
    ) {
      return;
    }

    if (!progress.activityPending) return;
    if (!unlocked && percent === 0 && isWatchingExplorationAfterActivity()) return;

    queryClient.setQueryData(getCareerIdentityQueryKeyFull(), (prev) => {
      if (!prev?.explorationProgress?.activityPending) return prev;
      return {
        ...prev,
        explorationProgress: {
          ...prev.explorationProgress,
          activityPending: false,
        },
      };
    });
  }, [
    activityPending,
    identityQuery.data?.explorationProgress,
    notification?.hasUnreadExploration,
  ]);

  // If identity already says there is no unread delivery, drop a stale
  // /exploration/latest cache that could revive the Discover CTA.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    if (identityQuery.data?.explorationNotification?.hasUnreadExploration !== false) {
      return undefined;
    }
    queryClient.setQueryData(careerIdentityExplorationLatestKey, (prev) => {
      if (!prev?.hasUnreadExploration) return prev;
      return {
        ...prev,
        hasUnreadExploration: false,
      };
    });
    return undefined;
  }, [
    isAuthenticated,
    identityQuery.data?.explorationNotification?.hasUnreadExploration,
  ]);

  // If latest exploration already has unread jobs but identity cache lags, promote CTA.
  // Skip when identity already has an explicit "no unread" after consume.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    if (!notification?.hasUnreadExploration) return undefined;
    if (identityQuery.data?.explorationNotification?.hasUnreadExploration) return undefined;
    if (identityQuery.data?.explorationNotification?.hasUnreadExploration === false) {
      return undefined;
    }

    clearExplorationActivityWatch();
    queryClient.setQueryData(getCareerIdentityQueryKeyFull(), (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        explorationNotification: {
          hasUnreadExploration: true,
          sessionId: notification.sessionId,
          jobCount: notification.jobCount,
          status: notification.status || 'completed',
        },
        explorationProgress: prev.explorationProgress
          ? {
              ...prev.explorationProgress,
              phase: 'delivered',
              progressPercent: 100,
              remainingScore: 0,
              isReady: true,
              activityPending: false,
            }
          : prev.explorationProgress,
      };
    });
  }, [
    isAuthenticated,
    notification?.hasUnreadExploration,
    notification?.sessionId,
    notification?.jobCount,
    notification?.status,
    identityQuery.data?.explorationNotification?.hasUnreadExploration,
  ]);

  // Refresh identity progress when a pipeline run finishes.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const token = localStorage.getItem('token');
    if (!token || typeof EventSource === 'undefined') return undefined;

    const url = `/api/career-identity/exploration/events?access_token=${encodeURIComponent(token)}`;
    let es;
    try {
      es = new EventSource(url);
    } catch {
      return undefined;
    }

    es.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data?.type === 'exploration_preparing') {
        applyExplorationPreparingHint(data);
        return;
      }
      if (data?.type === 'exploration_completed') {
        applyDeliveredExplorationHint(data);
        queryClient.invalidateQueries(careerIdentityExplorationLatestKey);
        return;
      }
      if (data?.type === 'exploration_finished') {
        const status = data.status || null;
        // Empty/failed search: keep the 100% preparing UX while refetching —
        // do not clear to a stale 0% accumulating flash.
        if (status === 'skipped_empty_pool' || status === 'failed') {
          applyExplorationPreparingHint(data);
          invalidateCareerIdentityQueries();
          return;
        }

        clearExplorationActivityWatch();
        queryClient.setQueryData(getCareerIdentityQueryKeyFull(), (prev) => {
          if (!prev?.explorationProgress) return prev;
          if (prev.explorationNotification?.hasUnreadExploration) return prev;
          return {
            ...prev,
            explorationProgress: {
              ...prev.explorationProgress,
              activityPending: false,
            },
          };
        });

        // Baseline / below-threshold finishes do not change puzzle pieces —
        // refetching here re-entered getIdentity → puzzle_updated → pipeline.
        if (
          status === 'skipped_below_threshold'
          || status === 'seeded_baseline'
          || status === 'skipped_pending_delivery'
          || status === 'skipped_unchanged'
        ) {
          return;
        }
        invalidateCareerIdentityQueries();
      }
    };

    return () => {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    };
  }, [isAuthenticated]);

  return null;
}
