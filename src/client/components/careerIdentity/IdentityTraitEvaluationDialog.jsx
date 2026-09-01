import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Typography,
} from '@mui/material';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import CelebrationOutlinedIcon from '@mui/icons-material/CelebrationOutlined';
import { useTranslation } from 'react-i18next';
import SimulationWizardDialog from '../common/SimulationWizardDialog';
import IdentityTraitDetailBody from './IdentityTraitDetailBody';

function isUnevaluatedTrait(node) {
  return node && node.userVote == null;
}

/**
 * Guided one-by-one review of unevaluated identity puzzle traits.
 * Mirrors the exploration role-ranking wizard shell (progress bar + step panel).
 * Votes persist immediately; reopen only shows remaining null votes.
 */
export default function IdentityTraitEvaluationDialog({
  open,
  nodes = [],
  onClose,
  onVote,
  votePending = false,
  voteError = null,
}) {
  const { t } = useTranslation('dashboard');
  const [phase, setPhase] = useState('eval'); // 'eval' | 'done'
  const [totalAtOpen, setTotalAtOpen] = useState(0);
  const openedRef = useRef(false);

  const unevaluated = useMemo(
    () => (Array.isArray(nodes) ? nodes.filter(isUnevaluatedTrait) : []),
    [nodes]
  );

  // Snapshot queue size when the wizard opens so the progress bar stays stable.
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      setPhase('eval');
      setTotalAtOpen(0);
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    const count = Array.isArray(nodes)
      ? nodes.filter(isUnevaluatedTrait).length
      : 0;
    setTotalAtOpen(count);
    setPhase(count === 0 ? 'done' : 'eval');
  }, [open, nodes]);

  // Advance to done when all traits in the snapshot have been voted.
  useEffect(() => {
    if (!open || phase !== 'eval') return;
    if (totalAtOpen > 0 && unevaluated.length === 0) {
      setPhase('done');
    }
  }, [open, phase, totalAtOpen, unevaluated.length]);

  const currentTrait = phase === 'eval' ? unevaluated[0] || null : null;
  const evaluatedCount = Math.max(0, totalAtOpen - unevaluated.length);
  const progressStep =
    phase === 'done'
      ? Math.max(1, totalAtOpen)
      : Math.min(totalAtOpen, evaluatedCount + 1);

  const renderTitle = () => {
    if (phase === 'done') {
      return (
        <Typography
          variant="h6"
          component="span"
          sx={{ display: 'block', fontWeight: 600, lineHeight: 1.3 }}
        >
          <CelebrationOutlinedIcon sx={{ mr: 1, verticalAlign: 'middle' }} aria-hidden />
          {t('careerIdentity.voteFlow.doneTitle')}
        </Typography>
      );
    }

    return (
      <Typography
        variant="h6"
        component="span"
        sx={{ display: 'block', fontWeight: 600, lineHeight: 1.3 }}
      >
        <ExtensionOutlinedIcon sx={{ mr: 1, verticalAlign: 'middle' }} aria-hidden />
        {currentTrait?.name || t('careerIdentity.voteFlow.title')}
      </Typography>
    );
  };

  const renderContent = () => {
    if (phase === 'done') {
      return (
        <Box sx={{ py: 2 }}>
          <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            {totalAtOpen === 0
              ? t('careerIdentity.voteFlow.empty')
              : t('careerIdentity.voteFlow.doneBody')}
          </Typography>
        </Box>
      );
    }

    if (!currentTrait) {
      return null;
    }

    return (
      <>
        <Typography variant="body2" color="text.secondary">
          {t('careerIdentity.voteFlow.intro')}
        </Typography>
        <IdentityTraitDetailBody
          trait={currentTrait}
          onVote={onVote}
          votePending={votePending}
          voteError={voteError}
        />
      </>
    );
  };

  const actions = (
    <Button onClick={onClose}>
      {phase === 'done'
        ? t('careerIdentity.voteFlow.done')
        : t('careerIdentity.voteFlow.close')}
    </Button>
  );

  return (
    <SimulationWizardDialog
      open={open}
      currentStep={Math.max(1, progressStep || 1)}
      totalSteps={Math.max(1, totalAtOpen || 1)}
      title={renderTitle()}
      actions={actions}
    >
      {renderContent()}
    </SimulationWizardDialog>
  );
}
