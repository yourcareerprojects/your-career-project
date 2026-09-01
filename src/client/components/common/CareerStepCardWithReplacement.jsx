import {
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  Tooltip,
} from '@mui/material';
import {
  ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getRoleTitleForLocale, getRoleTitleEnglishForMatch } from '../../utils/roleTitleDisplay';
import { storeSimulationResultDetails } from '../../utils/simulationResultSessionStore';
import localizedContentService from '../../utils/localizedContentService';

const CareerStepCardWithReplacement = ({
  step,
  category,
  simulationId,
  showReplacementCounter = true,
  remainingAlternatives = 0,
  guardedNavigate = null,
}) => {
  const navigate = useNavigate();
  const { i18n, t } = useTranslation(['dashboard']);
  const uiLang = i18n.resolvedLanguage || i18n.language || 'en';
  const displayTitle = getRoleTitleForLocale(step?.title, uiLang);
  const displayDescription = localizedContentService.getLocalizedWithFallback(step?.description, uiLang, '');

  const isReplacement = Boolean(step.isReplacement);

  /** Full-width cells in the action grid. */
  const CARD_ACTION_BTN_SX = { width: '100%' };

  const isOotb = category === 'outsideTheBox';
  const OOTB_ACTION_BTN_SX = {
    bgcolor: 'var(--color-ootb-action)',
    color: 'var(--color-ootb-action-contrast)',
    '&:hover': { bgcolor: 'var(--color-ootb-action-hover)' },
  };
  const moreTooltip = t('simulation.evaluationFlow.tooltips.moreDetails');

  const getDetailRoute = (context, stepId, simulationId) => {
    switch (context) {
      case 'simulation':
        return `/simulation/result/${encodeURIComponent(stepId)}`;
      case 'saved-simulation':
        return `/saved-simulation/${simulationId}/career-step/${encodeURIComponent(stepId)}`;
      default:
        return `/simulation/result/${encodeURIComponent(stepId)}`;
    }
  };

  const detectContext = () => {
    const path = window.location.pathname;

    if (path.includes('/simulation/') && simulationId && simulationId !== 'local') {
      return 'saved-simulation';
    }
    if (path.includes('/simulation') && (!simulationId || simulationId === 'local')) {
      return 'simulation';
    }
    return 'simulation';
  };

  const handleMore = () => {
    const context = detectContext();
    const stepId = step.stepId || getRoleTitleEnglishForMatch(step.title);
    sessionStorage.setItem('currentStepDetails', JSON.stringify(step));
    storeSimulationResultDetails(step, [stepId]);
    const route = getDetailRoute(context, stepId, simulationId);

    const navigateFunction = guardedNavigate || navigate;
    navigateFunction(route);
  };

  const getBorderColor = () => {
    switch (category) {
      case 'nextSteps':
        return 'var(--color-primary)';
      case 'outsideTheBox':
        return 'var(--color-warning)';
      case 'furtherAdvice':
        return 'var(--color-success)';
      default:
        return 'var(--color-primary)';
    }
  };

  return (
    <>
      <Card
        className="career-step-card"
        sx={{
          borderLeft: `6px solid ${getBorderColor()}`,
          height: '100%',
          minHeight: '320px',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          ...(isReplacement && {
            animation: 'fadeIn 0.5s ease-in-out',
            '@keyframes fadeIn': {
              '0%': { opacity: 0, transform: 'translateY(10px)' },
              '100%': { opacity: 1, transform: 'translateY(0)' }
            }
          })
        }}
      >
        {isReplacement && (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              backgroundColor: 'var(--color-success)',
              color: 'var(--color-on-primary)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              zIndex: 1
            }}
          >
            NEW
          </Box>
        )}

        <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1, p: 2, justifyContent: 'space-between' }}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
              mb: 1,
              height: '2.5em',
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {displayTitle}
          </Typography>

          <Typography
            variant="body2"
            sx={{
              mb: 2,
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: '1.4em',
              height: '5.6em',
              minHeight: '5.6em'
            }}
          >
            {displayDescription || 'No description available.'}
          </Typography>

          {showReplacementCounter && remainingAlternatives > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {remainingAlternatives} more alternatives available
              </Typography>
            </Box>
          )}

          <Box
            className="career-step-actions"
            sx={{
              pt: 1,
              display: 'flex',
              width: '100%',
              alignItems: 'stretch'
            }}
          >
            <Tooltip title={moreTooltip} arrow>
              <span>
                <Button
                  aria-label={moreTooltip}
                  variant="contained"
                  color={isOotb ? 'inherit' : 'primary'}
                  size="small"
                  startIcon={<ArrowForwardIcon sx={{ fontSize: '1rem' }} />}
                  onClick={handleMore}
                  className="career-step-action-button"
                  sx={{ ...CARD_ACTION_BTN_SX, ...(isOotb ? OOTB_ACTION_BTN_SX : {}) }}
                >
                  {t('simulation.evaluationFlow.actions.more')}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </CardContent>
      </Card>

    </>
  );
};

export default CareerStepCardWithReplacement;
