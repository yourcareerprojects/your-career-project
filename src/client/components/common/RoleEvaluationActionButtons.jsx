import React from 'react';
import { Box, Button, Tooltip, useTheme } from '@mui/material';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { useTranslation } from 'react-i18next';

export const ROLE_EVAL_ACTION_BUTTON_SX = {
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

/** Black outline + bold label colours for Keep / Skip / Dislike. */
export const ROLE_EVAL_BUTTON_BORDER_SX = {
  border: '1px solid #000000',
  borderColor: '#000000',
  fontWeight: 700,
  '&:hover': {
    border: '1px solid #000000',
    borderColor: '#000000',
  },
};

const EVALUATION_KEYS = ['keep', 'skip', 'dislike'];

/**
 * Cool / Don't know / Uncool rating buttons for simulation role evaluation.
 * @param {'full' | 'compact'} [layout='full'] — compact fits the same labels in one row (mobile sticky bar).
 */
export default function RoleEvaluationActionButtons({
  role,
  onEvaluate,
  layout = 'full',
  showEvalNudge = false,
  getButtonNudgeSx,
  nudgeInteractionHandlers,
}) {
  const { t } = useTranslation('dashboard');
  const theme = useTheme();
  const isCompact = layout === 'compact';

  const nudgeSx = (buttonKey) => (
    showEvalNudge && typeof getButtonNudgeSx === 'function' ? getButtonNudgeSx(buttonKey) : {}
  );
  const nudgeHandlers = showEvalNudge ? nudgeInteractionHandlers : {};

  const labels = {
    keep: t('simulation.evaluationFlow.actions.keep'),
    skip: t('simulation.evaluationFlow.actions.skip'),
    dislike: t('simulation.evaluationFlow.actions.dislike'),
  };

  const tooltips = {
    keep: t('simulation.evaluationFlow.tooltips.keepStrongFit'),
    skip: t('simulation.evaluationFlow.tooltips.skipNotSure'),
    dislike: t('simulation.evaluationFlow.tooltips.dislikePoorFit'),
  };

  const selectedBg = {
    keep: 'rgba(76, 175, 80, 0.18)',
    skip: theme.palette.action.selected,
    dislike: 'rgba(211, 47, 47, 0.14)',
  };

  const selectedHoverBg = {
    keep: 'rgba(76, 175, 80, 0.28)',
    skip: theme.palette.action.hover,
    dislike: 'rgba(211, 47, 47, 0.22)',
  };

  const textColor = {
    keep: 'success.main',
    skip: theme.palette.mode === 'dark' ? theme.palette.text.primary : '#000000',
    dislike: 'error.main',
  };

  const renderButton = (evaluationKey) => {
    const isSelected = role.userEvaluation === evaluationKey;
    const showSkipIcon = !isCompact && evaluationKey === 'skip';

    const compactSx = isCompact
      ? {
          width: '100% !important',
          minWidth: '0 !important',
          px: '6px !important',
          py: '8px !important',
          minHeight: 'unset',
          height: 'auto',
          fontSize: '0.8rem !important',
          lineHeight: '1.1 !important',
          whiteSpace: 'nowrap !important',
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }
      : {};

    const skipIconSx = showSkipIcon
      ? {
          '& .MuiButton-startIcon': {
            color: textColor.skip,
          },
        }
      : {};

    return (
      <Tooltip key={evaluationKey} title={tooltips[evaluationKey]} arrow>
        <span style={{ display: 'block', minWidth: 0, width: '100%' }}>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            onClick={() => onEvaluate(role.id, evaluationKey)}
            {...nudgeHandlers}
            startIcon={
              showSkipIcon ? (
                <RemoveCircleOutlineIcon sx={{ fontSize: '1rem !important' }} />
              ) : undefined
            }
            aria-label={tooltips[evaluationKey]}
            aria-pressed={isSelected}
            sx={{
              ...ROLE_EVAL_ACTION_BUTTON_SX,
              ...ROLE_EVAL_BUTTON_BORDER_SX,
              ...compactSx,
              ...skipIconSx,
              color: textColor[evaluationKey],
              bgcolor: isSelected ? selectedBg[evaluationKey] : 'transparent',
              '&:hover': {
                ...ROLE_EVAL_BUTTON_BORDER_SX['&:hover'],
                bgcolor: isSelected ? selectedHoverBg[evaluationKey] : 'rgba(0, 0, 0, 0.04)',
              },
              ...nudgeSx(evaluationKey),
            }}
          >
            {labels[evaluationKey]}
          </Button>
        </span>
      </Tooltip>
    );
  };

  return (
    <Box
      role="group"
      aria-label={t('simulation.evaluationFlow.rateThisRole')}
      sx={{
        display: 'grid',
        gridTemplateColumns: isCompact ? 'repeat(3, minmax(0, 1fr))' : { xs: '1fr', sm: 'repeat(3, 1fr)' },
        alignItems: 'stretch',
        gap: isCompact ? 1 : 1,
        width: '100%',
      }}
    >
      {EVALUATION_KEYS.map(renderButton)}
    </Box>
  );
}
