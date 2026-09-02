import React, { useCallback, useRef, useState } from 'react';
import {
  useCareerIdentityQuery,
  useLatestExplorationQuery,
  useMarkExplorationSeenMutation,
} from '../../hooks/useCareerIdentityQueries';
import { useAuth } from '../../contexts/AuthContext';
import { useLastSimulationQuery } from '../../hooks/useProfileQueries';
import { isIdentityExplorationUnlockedBySimulation } from '../../utils/identityExplorationSimulationUnlock';
import { resolveExplorationNotification } from '../../utils/resolveExplorationNotification';
import IdentityExplorationDiscoverDialog from './IdentityExplorationDiscoverDialog';
import IdentityExplorationProgressPopup from './IdentityExplorationProgressPopup';

/**
 * Standalone exploration progress + discovery CTA for PuzzleJOB.
 * Hidden while simulation ranking is incomplete (the "complete simulation" gate
 * would only send the user to a page they are already on).
 */
export default function IdentityExplorationDiscoverCta({
  sx = null,
  onExplorationRanked = null,
  hideWhenSimulationGated = true,
}) {
  const identityQuery = useCareerIdentityQuery();
  const latestExplorationQuery = useLatestExplorationQuery();
  const markSeenMutation = useMarkExplorationSeenMutation();
  const { isAuthenticated } = useAuth();
  const lastSimQuery = useLastSimulationQuery({ enabled: isAuthenticated });
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const markSeenInFlightRef = useRef(new Set());
  const consumedSessionIdsRef = useRef(new Set());

  const identity = identityQuery.data;
  const progress = identity?.explorationProgress || null;
  const notification = resolveExplorationNotification(identity, latestExplorationQuery.data);
  const simulationUnlocked = isIdentityExplorationUnlockedBySimulation(lastSimQuery.data);
  const hideGatedCard = hideWhenSimulationGated && !simulationUnlocked;

  const markSeenOnce = useCallback(
    (id) => {
      if (!id || markSeenInFlightRef.current.has(id)) return;
      if (consumedSessionIdsRef.current.has(id)) return;
      consumedSessionIdsRef.current.add(id);
      markSeenInFlightRef.current.add(id);
      markSeenMutation.mutate(id, {
        onSettled: () => {
          markSeenInFlightRef.current.delete(id);
        },
      });
    },
    [markSeenMutation]
  );

  const handleDiscover = useCallback((sessionId) => {
    if (!sessionId) return;
    setActiveSessionId(sessionId);
    setDiscoverOpen(true);
    // Mark-seen / baseline reset happens on ranking Done, not on open.
  }, []);

  const handleComplete = useCallback(
    async (payload) => {
      // Merge + flush first — mark-seen invalidates exploration queries and must
      // not race ahead of the ranked-role handoff.
      try {
        await onExplorationRanked?.(payload);
      } catch (err) {
        console.warn('Exploration ranking handoff failed:', err);
      } finally {
        if (payload?.sessionId) markSeenOnce(payload.sessionId);
      }
    },
    [markSeenOnce, onExplorationRanked]
  );

  // Keep the dialog alive if the unread flag clears while ranking.
  if (!progress?.hasBaseline && !discoverOpen) return null;
  if (hideGatedCard && !discoverOpen) return null;

  return (
    <>
      <IdentityExplorationProgressPopup
        progress={progress}
        explorationNotification={notification}
        onDiscover={handleDiscover}
        sticky={false}
        hideWhenSimulationGated={hideWhenSimulationGated}
        sx={sx}
        canRateIdentity={(identity?.nodes || []).some((node) => node.userVote == null)}
      />

      <IdentityExplorationDiscoverDialog
        open={discoverOpen}
        sessionId={activeSessionId}
        onComplete={handleComplete}
        onClose={() => {
          setDiscoverOpen(false);
          setActiveSessionId(null);
        }}
      />
    </>
  );
}
