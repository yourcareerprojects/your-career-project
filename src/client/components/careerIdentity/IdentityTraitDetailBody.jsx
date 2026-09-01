import React from 'react';
import {
  Alert,
  Box,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import IdentityEvidenceList from './IdentityEvidenceList';
import IdentityConfidenceScore from './IdentityConfidenceScore';
import IdentityTraitVoteSection from './IdentityTraitVoteSection';

/**
 * Shared trait detail content: description, confidence, evidence, vote section.
 * Used by IdentitySidebar and the trait evaluation wizard.
 */
export default function IdentityTraitDetailBody({
  trait,
  onVote,
  votePending = false,
  voteError = null,
}) {
  const { t } = useTranslation('dashboard');

  if (!trait) return null;

  return (
    <Box>
      {trait.description ? (
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {trait.description}
        </Typography>
      ) : null}

      <IdentityConfidenceScore trait={trait} />

      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
          {t('careerIdentity.whyWeThinkThis')}
        </Typography>
        <IdentityEvidenceList evidence={trait.evidence || []} />
      </Box>

      <IdentityTraitVoteSection
        value={trait.userVote}
        disabled={votePending || !onVote}
        onCommit={(vote) => onVote?.(trait.id, vote)}
      />

      {voteError ? (
        <Alert severity="warning" sx={{ mt: 2, borderRadius: 2 }}>
          {voteError}
        </Alert>
      ) : null}
    </Box>
  );
}
