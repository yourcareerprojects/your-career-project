import React from 'react';
import { Box, Typography, Button, Tooltip } from '@mui/material';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { useTranslation } from 'react-i18next';

const EVAL_BUTTON_SX = {
  width: '100% !important',
  minWidth: '0px !important',
  px: '10px !important',
  py: '8px !important',
  fontSize: '0.8rem !important',
  lineHeight: '1.1 !important',
  borderRadius: '12px !important',
  whiteSpace: 'nowrap !important',
  boxShadow: 'none !important',
};

const normalizeStoredEvaluation = (v) =>
  v === 'keep' || v === 'skip' || v === 'dislike' ? v : null;

/**
 * Section title + Keep / Skip / Dislike row — title matches other career step detail cards (h6 + icon).
 * Clicking the active choice clears the rating (all outlined).
 */
export default function CareerStepUserEvaluationRow({
  value,
  onCommit,
  disabled = false,
}) {
  const { t } = useTranslation('dashboard');
  const stored = normalizeStoredEvaluation(value);

  const handle = (choice) => {
    const next = stored === choice ? null : choice;
    onCommit(next);
  };

  return (
    <Box sx={{ mb: 0 }}>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
        <AssessmentIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
        {t('details.rating.title')}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, mb: 2 }}>
        <Tooltip title={t('details.rating.tooltips.keepStrongFit')} arrow>
          <span>
            <Button
              variant={stored === 'keep' ? 'contained' : 'outlined'}
              color="success"
              size="small"
              disabled={disabled}
              onClick={() => handle('keep')}
              sx={EVAL_BUTTON_SX}
              aria-pressed={stored === 'keep'}
            >
              {t('details.rating.actions.keep')}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={t('details.rating.tooltips.skipNotSure')} arrow>
          <span>
            <Button
              variant={stored === 'skip' ? 'contained' : 'outlined'}
              color="inherit"
              size="small"
              disabled={disabled}
              onClick={() => handle('skip')}
              startIcon={<RemoveCircleOutlineIcon sx={{ fontSize: '1rem !important' }} />}
              sx={EVAL_BUTTON_SX}
              aria-pressed={stored === 'skip'}
            >
              {t('details.rating.actions.skip')}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={t('details.rating.tooltips.dislikePoorFit')} arrow>
          <span>
            <Button
              variant={stored === 'dislike' ? 'contained' : 'outlined'}
              color="error"
              size="small"
              disabled={disabled}
              onClick={() => handle('dislike')}
              sx={EVAL_BUTTON_SX}
              aria-pressed={stored === 'dislike'}
            >
              {t('details.rating.actions.dislike')}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
