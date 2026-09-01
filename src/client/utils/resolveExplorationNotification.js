/**
 * Resolve unread exploration notification from identity payload and/or latest session query.
 */

/** Summarize session.rankingProgress for Discover CTA resume copy. */
export function summarizeClientRankingProgress(session) {
  return rankingProgressFromSession(session);
}

function rankingProgressFromSession(session) {
  const progress = session?.rankingProgress;
  if (!progress || typeof progress !== 'object') return null;

  const jobCount = Array.isArray(session?.explorationJobs) ? session.explorationJobs.length : 0;
  const evaluatedCount = Math.max(0, Number(progress.evaluatedCount) || 0);
  const totalCount = Math.max(0, Number(progress.totalCount) || jobCount || 0);
  const phase = progress.phase === 'ranked' ? 'ranked' : 'eval';
  const hasProgress =
    evaluatedCount > 0
    || phase === 'ranked'
    || Boolean(progress.wizardPaused);

  if (!hasProgress) return null;

  return {
    hasProgress: true,
    evaluatedCount,
    totalCount,
    phase,
    wizardPaused: Boolean(progress.wizardPaused),
  };
}

export function resolveExplorationNotification(identity, latest) {
  if (identity?.explorationNotification?.hasUnreadExploration) {
    const notification = identity.explorationNotification;
    // Prefer fresher ranking progress from the latest-session query when available.
    const fromLatest = rankingProgressFromSession(latest?.session);
    if (fromLatest) {
      return { ...notification, rankingProgress: fromLatest };
    }
    return notification;
  }

  // Prefer an explicit "no unread" from identity over a stale /exploration/latest cache.
  if (
    identity?.explorationNotification
    && identity.explorationNotification.hasUnreadExploration === false
  ) {
    return identity.explorationNotification;
  }

  if (!latest?.hasUnreadExploration) return null;

  const sessionId =
    latest.session?._id
    || latest.session?.id
    || null;
  const jobCount = Array.isArray(latest.session?.explorationJobs)
    ? latest.session.explorationJobs.length
    : 0;

  if (!sessionId || jobCount <= 0) return null;

  return {
    hasUnreadExploration: true,
    sessionId: String(sessionId),
    jobCount,
    status: latest.session?.status || 'completed',
    rankingProgress: rankingProgressFromSession(latest.session),
  };
}

/**
 * Effective progress phase for CTA UX: prefer delivered when an unread session exists
 * even if the identity cache still says ready/preparing.
 */
export function resolveExplorationProgressPhase(progress, notification) {
  if (notification?.hasUnreadExploration) return 'delivered';
  return progress?.phase || 'accumulating';
}
