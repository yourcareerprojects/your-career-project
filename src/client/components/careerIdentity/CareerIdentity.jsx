import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
} from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import {
  useCareerIdentityQuery,
  useLatestExplorationQuery,
  useMarkExplorationSeenMutation,
  useVoteIdentityTraitMutation,
  optimisticallyConsumeExplorationProgress,
} from '../../hooks/useCareerIdentityQueries';
import { resolveExplorationNotification } from '../../utils/resolveExplorationNotification';
import {
  acknowledgeTraitHighlightsVisit,
  scheduleEndTraitHighlightsVisit,
  syncTraitChangeHighlights,
} from '../../utils/identityTraitChangeHighlights';
import useConfirmationDialog from '../../hooks/useConfirmationDialog';
import ConfirmationDialog from '../common/ConfirmationDialog';
import IdentityGraph from './IdentityGraph';
import IdentitySidebar from './IdentitySidebar';
import IdentityExplorationProgressPopup from './IdentityExplorationProgressPopup';
import IdentityExplorationDiscoverDialog from './IdentityExplorationDiscoverDialog';
import IdentityTraitEvaluationDialog from './IdentityTraitEvaluationDialog';
import { applyExplorationRankingToLastSimulation } from '../../utils/applyExplorationRankingToLastSimulation';

/**
 * Whether committing `vote` for this trait node is predicted to drop it from the puzzle.
 * Supports the newer voteWouldRemove map and the legacy rejectWouldRemove flag.
 */
function predictsVoteWouldRemove(trait, vote) {
  if (!trait) return false;
  const map = trait.voteWouldRemove;
  if (map && typeof map === 'object') {
    if (vote == null) return Boolean(map.clear);
    return Boolean(map[vote]);
  }
  return vote === 'reject' && Boolean(trait.rejectWouldRemove);
}

/**
 * Career Identity Puzzle orchestrator.
 * Nodes = identity traits. Careers appear only as evidence.
 * Discovery CTA lives in the progress card when new roles are ready.
 */
export default function CareerIdentity() {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const identityQuery = useCareerIdentityQuery();
  const latestExplorationQuery = useLatestExplorationQuery();
  const voteMutation = useVoteIdentityTraitMutation();
  const markSeenMutation = useMarkExplorationSeenMutation();
  const { dialogState, openDialog, handleConfirm, handleCancel } = useConfirmationDialog();
  const [selectedTraitId, setSelectedTraitId] = useState(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [traitEvalOpen, setTraitEvalOpen] = useState(false);
  const [changedTraitIds, setChangedTraitIds] = useState(() => new Set());
  const markSeenInFlightRef = useRef(new Set());
  const consumedSessionIdsRef = useRef(new Set());

  const identity = identityQuery.data;
  const userId = String(user?.id || user?._id || '').trim();
  const explorationNotification = useMemo(
    () => resolveExplorationNotification(identity, latestExplorationQuery.data),
    [identity, latestExplorationQuery.data]
  );
  const selectedTrait = useMemo(() => {
    if (!selectedTraitId || !identity?.nodes) return null;
    return identity.nodes.find((n) => n.id === selectedTraitId) || null;
  }, [identity, selectedTraitId]);

  // Re-diff against the frozen pre-visit baseline whenever identity refreshes
  // (stale cache → post-profile-edit traits) so the glow appears without a reload.
  // Baseline is only written when leaving / reloading the page.
  useEffect(() => {
    const nodes = identity?.nodes;
    if (!userId || !Array.isArray(nodes) || nodes.length === 0) return;
    const ids = syncTraitChangeHighlights(userId, nodes);
    setChangedTraitIds((prev) => {
      if (prev.size === ids.length && ids.every((id) => prev.has(id))) return prev;
      return new Set(ids);
    });
  }, [userId, identity?.nodes]);

  useEffect(() => {
    if (!userId) return undefined;
    const onPageHide = () => {
      acknowledgeTraitHighlightsVisit(userId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      scheduleEndTraitHighlightsVisit(userId);
    };
  }, [userId]);

  // Close the detail sidebar when a vote drops the trait below the puzzle threshold.
  useEffect(() => {
    if (selectedTraitId && identity?.nodes && !selectedTrait) {
      setSelectedTraitId(null);
    }
  }, [identity, selectedTrait, selectedTraitId]);

  // Open trait-rating wizard when arriving via ?rateTraits=1 (e.g. from simulation CTA).
  useEffect(() => {
    if (searchParams.get('rateTraits') !== '1') return;
    setTraitEvalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('rateTraits');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleRateIdentity = useCallback(() => {
    setTraitEvalOpen(true);
  }, []);

  const markSeenOnce = useCallback(
    (sessionId) => {
      if (!sessionId || markSeenInFlightRef.current.has(sessionId)) return;
      if (consumedSessionIdsRef.current.has(sessionId)) return;
      consumedSessionIdsRef.current.add(sessionId);
      markSeenInFlightRef.current.add(sessionId);
      markSeenMutation.mutate(sessionId, {
        onSettled: () => {
          markSeenInFlightRef.current.delete(sessionId);
        },
      });
    },
    [markSeenMutation]
  );

  const handleDiscover = useCallback((sessionId) => {
    if (!sessionId) return;
    setActiveSessionId(sessionId);
    setDiscoverOpen(true);
    // Do not mark-seen / reset baseline until ranking is finished (Done).
  }, []);

  const handleExplorationRanked = useCallback(async ({ sessionId, roles, rankedRows }) => {
    // Reset the progress card immediately; defer server mark-seen until after merge
    // so rankingProgress is not wiped mid-handoff.
    optimisticallyConsumeExplorationProgress();

    try {
      const outcome = await applyExplorationRankingToLastSimulation({
        sessionId,
        roles,
        rankedRows,
      });
      if (!outcome.ok) {
        if (outcome.reason === 'no-roles') {
          console.warn(
            'Exploration ranking finished, but no evaluated roles were available to merge into simulation results.'
          );
        } else if (outcome.reason === 'no-evaluation-flow') {
          console.warn(
            'Exploration ranking finished, but no simulation evaluationFlow was available to merge into.'
          );
        }
        return outcome;
      }
      return outcome;
    } catch (err) {
      console.warn('Failed to merge exploration roles into simulation ranking:', err);
      return { ok: false, reason: 'error' };
    } finally {
      markSeenOnce(sessionId);
    }
  }, [markSeenOnce]);

  const notifyTraitRemoved = useCallback(
    (traitName) => {
      openDialog({
        title: t('careerIdentity.vote.dropNoticeTitle'),
        message: t('careerIdentity.vote.dropNoticeMessage', {
          name: traitName || t('careerIdentity.menuLabel'),
        }),
        confirmText: t('careerIdentity.vote.dropNoticeAction'),
        cancelText: t('careerIdentity.vote.dropNoticeAction'),
        severity: 'info',
        hideCancel: true,
        onConfirm: () => {},
      });
    },
    [openDialog, t]
  );

  const commitVote = async (traitId, vote, { alreadyWarned = false, traitName = null } = {}) => {
    const identityAfter = await voteMutation.mutateAsync({ traitId, vote });
    const stillVisible = (identityAfter?.nodes || []).some((node) => node.id === traitId);
    if (!stillVisible && !alreadyWarned) {
      notifyTraitRemoved(traitName);
    }
    return identityAfter;
  };

  const handleVote = (traitId, vote) => {
    const trait =
      identity?.nodes?.find((node) => node.id === traitId) ||
      (selectedTrait?.id === traitId ? selectedTrait : null);
    const traitName = trait?.name || t('careerIdentity.menuLabel');

    if (predictsVoteWouldRemove(trait, vote)) {
      openDialog({
        title: t('careerIdentity.vote.dropConfirmTitle'),
        message: t('careerIdentity.vote.dropConfirmMessage', {
          name: traitName,
        }),
        confirmText: t('careerIdentity.vote.dropConfirmAction'),
        cancelText: t('profilePage.actions.cancel', { ns: 'onboarding' }),
        severity: 'warning',
        onConfirm: () => commitVote(traitId, vote, { alreadyWarned: true, traitName }),
      });
      return;
    }

    commitVote(traitId, vote, { traitName });
  };

  if (identityQuery.isLoading && !identity) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Keep a previously loaded puzzle visible when a background refetch fails
  // (common during concurrent identity refreshes).
  if (identityQuery.isError && !identity) {
    return (
      <Alert severity="error" sx={{ borderRadius: 2 }}>
        {identityQuery.error?.message || t('careerIdentity.loadError')}
      </Alert>
    );
  }

  return (
    <Box>
      {identityQuery.isError ? (
        <Alert severity="warning" sx={{ borderRadius: 2, mb: 2 }}>
          {identityQuery.error?.message || t('careerIdentity.loadError')}
        </Alert>
      ) : null}

      <IdentityExplorationProgressPopup
        progress={identity?.explorationProgress || null}
        explorationNotification={explorationNotification}
        onDiscover={handleDiscover}
        onRateIdentity={handleRateIdentity}
        canRateIdentity={(identity?.nodes || []).some((node) => node.userVote == null)}
      />

      <IdentityGraph
        nodes={identity?.nodes || []}
        connections={identity?.connections || []}
        selectedTraitId={selectedTraitId}
        changedTraitIds={changedTraitIds}
        onSelectTrait={(node) => setSelectedTraitId(node.id)}
      />

      <IdentitySidebar
        open={Boolean(selectedTrait) && !traitEvalOpen}
        trait={selectedTrait}
        onClose={() => setSelectedTraitId(null)}
        votePending={voteMutation.isLoading || dialogState.loading}
        voteError={
          voteMutation.isError
            ? voteMutation.error?.message || t('careerIdentity.vote.saveError')
            : null
        }
        onVote={handleVote}
      />

      <IdentityExplorationDiscoverDialog
        open={discoverOpen}
        sessionId={activeSessionId}
        onComplete={handleExplorationRanked}
        onClose={() => {
          setDiscoverOpen(false);
          setActiveSessionId(null);
        }}
      />

      <IdentityTraitEvaluationDialog
        open={traitEvalOpen}
        nodes={identity?.nodes || []}
        onClose={() => setTraitEvalOpen(false)}
        votePending={voteMutation.isLoading || dialogState.loading}
        voteError={
          voteMutation.isError
            ? voteMutation.error?.message || t('careerIdentity.vote.saveError')
            : null
        }
        onVote={handleVote}
      />

      <ConfirmationDialog
        open={dialogState.open}
        onClose={handleCancel}
        onConfirm={handleConfirm}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        severity={dialogState.severity}
        hideCancel={dialogState.hideCancel}
        loading={dialogState.loading || voteMutation.isLoading}
      />
    </Box>
  );
}
