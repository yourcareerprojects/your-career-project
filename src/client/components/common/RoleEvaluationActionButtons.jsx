import React from 'react';
import { Box, Button, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { useTranslation } from 'react-i18next';

export const ROLE_EVAL_ACTION_BUTTON_SX = {
  width: '100% !important',
  minWidth: '0px !important',
  px: { xs: '4px !important', sm: '8px !important', md: '10px !important' },
  py: { xs: '6px !important', sm: '8px !important' },
  fontSize: { xs: '0.7rem !important', sm: '0.75rem !important', md: '0.8rem !important' },
  lineHeight: '1.1 !important',
  borderRadius: '12px !important',
  whiteSpace: 'nowrap !important',
  boxShadow: 'none !important',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  textAlign: 'center',
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

const EVALUATION_KEYS = ['dislike', 'skip', 'keep'];

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
  const showSkipIconOnButtons = useMediaQuery(theme.breakpoints.up('sm'));

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
    const showSkipIcon = !isCompact && evaluationKey === 'skip' && showSkipIconOnButtons;

    const skipIconSx = showSkipIcon
      ? {
          '& .MuiButton-startIcon': {
            color: textColor.skip,
            marginLeft: { sm: '-2px !important' },
            marginRight: { sm: '4px !important' },
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
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        alignItems: 'stretch',
        gap: { xs: 0.5, sm: 1 },
        width: '100%',
      }}
    >
      {EVALUATION_KEYS.map(renderButton)}
    </Box>
  );
}
