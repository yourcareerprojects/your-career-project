import React from 'react';
import { Box, Typography, Button, Tooltip } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useTranslation } from 'react-i18next';

const VOTE_BUTTON_SX = {
  width: '100% !important',
  minWidth: '0px !important',
  minHeight: '44px !important',
  px: '8px !important',
  py: '8px !important',
  fontSize: '0.75rem !important',
  lineHeight: '1.2 !important',
  borderRadius: '12px !important',
  whiteSpace: 'normal !important',
  boxShadow: 'none !important',
};

const normalizeStoredVote = (v) =>
  v === 'confirm' || v === 'unsure' || v === 'reject' ? v : null;

/**
 * Last section of the identity trait detail dialog — "Passt das zu dir?"
 * Clicking the active choice clears the vote.
 */
export default function IdentityTraitVoteSection({
  value,
  onCommit,
  disabled = false,
}) {
  const { t } = useTranslation('dashboard');
  const stored = normalizeStoredVote(value);

  const handle = (choice) => {
    const next = stored === choice ? null : choice;
    onCommit(next);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        {t('careerIdentity.vote.title')}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1 }}>
        <Tooltip title={t('careerIdentity.vote.tooltips.confirm')} arrow>
          <span>
            <Button
              variant={stored === 'confirm' ? 'contained' : 'outlined'}
              color="success"
              size="small"
              disabled={disabled}
              onClick={() => handle('confirm')}
              sx={VOTE_BUTTON_SX}
              aria-pressed={stored === 'confirm'}
            >
              {t('careerIdentity.vote.actions.confirm')}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={t('careerIdentity.vote.tooltips.unsure')} arrow>
          <span>
            <Button
              variant={stored === 'unsure' ? 'contained' : 'outlined'}
              color="inherit"
              size="small"
              disabled={disabled}
              onClick={() => handle('unsure')}
              startIcon={<HelpOutlineIcon sx={{ fontSize: '1rem !important' }} />}
              sx={VOTE_BUTTON_SX}
              aria-pressed={stored === 'unsure'}
            >
              {t('careerIdentity.vote.actions.unsure')}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={t('careerIdentity.vote.tooltips.reject')} arrow>
          <span>
            <Button
              variant={stored === 'reject' ? 'contained' : 'outlined'}
              color="error"
              size="small"
              disabled={disabled}
              onClick={() => handle('reject')}
              sx={VOTE_BUTTON_SX}
              aria-pressed={stored === 'reject'}
            >
              {t('careerIdentity.vote.actions.reject')}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
