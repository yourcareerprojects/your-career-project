import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Grid,
  LinearProgress,
  Tooltip,
  Divider,
  CircularProgress,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ThumbUpAltOutlinedIcon from '@mui/icons-material/ThumbUpAltOutlined';
import EditIcon from '@mui/icons-material/Edit';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  EVALUATION_VISIBLE_SLOTS,
  countEvaluatedRoles,
  isEvaluationComplete,
} from '../../utils/simulationRoleRanking';
import { getCareerStepMatchScorePercent } from '../../utils/careerStepMatchScore';
import { getRoleTitleForLocale, getRoleTitleEnglishForMatch } from '../../utils/roleTitleDisplay';
import { storeSimulationResultDetails } from '../../utils/simulationResultSessionStore';
import CareerStepCardWithReplacement from './CareerStepCardWithReplacement';
import localizedContentService from '../../utils/localizedContentService';

const ACTION_BUTTON_SX = {
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

/** Black outline + bold label colours for Keep / Skip / Dislike (evaluation grid). */
const EVAL_BUTTON_BORDER_SX = {
  border: '1px solid #000000',
  borderColor: '#000000',
  fontWeight: 700,
  '&:hover': {
    border: '1px solid #000000',
    borderColor: '#000000',
  },
};

/** Darker blue for Save toggle when role is already saved */
const ROLE_CARD_SAVE_SAVED_SX = {
  bgcolor: 'primary.dark',
  '&:hover': {
    bgcolor: 'primary.dark',
    filter: 'brightness(1.08)',
  },
};

const rankedRowActionSx = (theme) => ({
  minWidth: { xs: 0, sm: '96px !important' },
  width: { xs: '100%', sm: 'auto' },
  px: '12px !important',
  py: '6px !important',
  fontSize: '0.8rem !important',
  lineHeight: '1.1 !important',
  borderRadius: '10px !important',
  whiteSpace: { xs: 'normal !important', sm: 'nowrap !important' },
  boxShadow: 'none !important',
  textAlign: 'center',
  [theme.breakpoints.up('sm')]: {
    textAlign: 'initial',
  },
});

/** Outside-the-box: More / Save use headline red (`tokens.css` --color-ootb-*). */
const OOTB_ACTION_BUTTON_SX = {
  bgcolor: 'var(--color-ootb-action)',
  color: 'var(--color-ootb-action-contrast)',
  '&:hover': { bgcolor: 'var(--color-ootb-action-hover)' },
};

const OOTB_SAVE_SAVED_BUTTON_SX = {
  bgcolor: 'var(--color-ootb-action-saved)',
  '&:hover': { bgcolor: 'var(--color-ootb-action-saved-hover)' },
};

function RoleEvaluationCard({
  role,
  categoryKey,
  isViewingSavedSimulation,
  savedSimulationId,
  onEvaluate,
  onSave,
  isStepSaved,
  savingStep,
  guardedNavigate,
}) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('dashboard');
  const uiLang = i18n.resolvedLanguage || i18n.language || 'en';
  const roleTitle = getRoleTitleForLocale(role.title, uiLang);
  const roleDescription = localizedContentService.getLocalizedWithFallback(role.description, uiLang, '');
  const pct = getCareerStepMatchScorePercent(role);
  const roleTestId = role.stepId || role.id || getRoleTitleEnglishForMatch(role.title) || 'role';

  const handleMore = () => {
    const stepId = role.stepId || role.id || getRoleTitleEnglishForMatch(role.title);
    try {
      sessionStorage.setItem('currentStepDetails', JSON.stringify(role));
      storeSimulationResultDetails(role, [stepId]);
    } catch {
      /* ignore */
    }
    const path =
      isViewingSavedSimulation && savedSimulationId
        ? `/saved-simulation/${savedSimulationId}/career-step/${encodeURIComponent(stepId)}`
        : `/simulation/result/${encodeURIComponent(stepId)}`;
    const navigateFunction = guardedNavigate || navigate;
    navigateFunction(path);
  };

  return (
    <Card
      sx={{
        borderLeft: `6px solid ${categoryKey === 'nextSteps' ? 'var(--color-primary)' : 'var(--color-warning)'}`,
        minHeight: 300,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1, minHeight: '2.5em' }}>
            {roleTitle}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: '5.6em',
            }}
          >
            {roleDescription || 'No description available.'}
          </Typography>
          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t('details.labels.matchScore')}
            </Typography>
            <LinearProgress variant="determinate" value={pct} sx={{ mt: 0.5, height: 8, borderRadius: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {pct}%
            </Typography>
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            {t('simulation.evaluationFlow.rateThisRole')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
              gap: 1,
              mb: 1.5,
            }}
          >
            <Tooltip title={t('simulation.evaluationFlow.tooltips.keepStrongFit')} arrow>
              <span>
                <Button
                  variant="outlined"
                  color="inherit"
                  size="small"
                  onClick={() => onEvaluate(role.id, 'keep')}
                  sx={{
                    ...ACTION_BUTTON_SX,
                    ...EVAL_BUTTON_BORDER_SX,
                    color: 'success.main',
                    bgcolor: role.userEvaluation === 'keep' ? 'rgba(76, 175, 80, 0.18)' : 'transparent',
                    '&:hover': {
                      ...EVAL_BUTTON_BORDER_SX['&:hover'],
                      bgcolor:
                        role.userEvaluation === 'keep' ? 'rgba(76, 175, 80, 0.28)' : 'rgba(0, 0, 0, 0.04)',
                    },
                  }}
                  aria-pressed={role.userEvaluation === 'keep'}
                >
                  {t('simulation.evaluationFlow.actions.keep')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={t('simulation.evaluationFlow.tooltips.skipNotSure')} arrow>
              <span>
                <Button
                  variant="outlined"
                  color="inherit"
                  size="small"
                  onClick={() => onEvaluate(role.id, 'skip')}
                  startIcon={<RemoveCircleOutlineIcon sx={{ fontSize: '1rem !important' }} />}
                  sx={(theme) => ({
                    ...ACTION_BUTTON_SX,
                    ...EVAL_BUTTON_BORDER_SX,
                    color: theme.palette.mode === 'dark' ? theme.palette.text.primary : '#000000',
                    '& .MuiButton-startIcon': {
                      color: theme.palette.mode === 'dark' ? theme.palette.text.primary : '#000000',
                    },
                    bgcolor: role.userEvaluation === 'skip' ? theme.palette.action.selected : 'transparent',
                    '&:hover': {
                      ...EVAL_BUTTON_BORDER_SX['&:hover'],
                      bgcolor: theme.palette.action.hover,
                    },
                  })}
                  aria-pressed={role.userEvaluation === 'skip'}
                >
                  {t('simulation.evaluationFlow.actions.skip')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={t('simulation.evaluationFlow.tooltips.dislikePoorFit')} arrow>
              <span>
                <Button
                  variant="outlined"
                  color="inherit"
                  size="small"
                  onClick={() => onEvaluate(role.id, 'dislike')}
                  sx={{
                    ...ACTION_BUTTON_SX,
                    ...EVAL_BUTTON_BORDER_SX,
                    color: 'error.main',
                    bgcolor: role.userEvaluation === 'dislike' ? 'rgba(211, 47, 47, 0.14)' : 'transparent',
                    '&:hover': {
                      ...EVAL_BUTTON_BORDER_SX['&:hover'],
                      bgcolor:
                        role.userEvaluation === 'dislike' ? 'rgba(211, 47, 47, 0.22)' : 'rgba(0, 0, 0, 0.04)',
                    },
                  }}
                  aria-pressed={role.userEvaluation === 'dislike'}
                >
                  {t('simulation.evaluationFlow.actions.dislike')}
                </Button>
              </span>
            </Tooltip>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <Tooltip title={t('simulation.evaluationFlow.tooltips.moreDetails')} arrow>
              <span>
                <Button
                  variant="contained"
                  color={categoryKey === 'outsideTheBox' ? 'inherit' : 'primary'}
                  size="small"
                  startIcon={<ArrowForwardIcon sx={{ fontSize: '1rem' }} />}
                  onClick={handleMore}
                  sx={{
                    width: '100%',
                    ...(categoryKey === 'outsideTheBox' ? OOTB_ACTION_BUTTON_SX : {}),
                  }}
                  aria-label={t('simulation.evaluationFlow.tooltips.moreDetails')}
                >
                  {t('simulation.evaluationFlow.actions.more')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              title={
                isStepSaved
                  ? t('simulation.evaluationFlow.tooltips.savedRemove')
                  : t('simulation.evaluationFlow.tooltips.saveToSavedList')
              }
              arrow
            >
              <span>
                <Button
                  variant="contained"
                  color={categoryKey === 'outsideTheBox' ? 'inherit' : 'primary'}
                  size="small"
                  startIcon={
                    savingStep ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : isStepSaved ? (
                      <StarIcon sx={{ fontSize: '1rem' }} />
                    ) : (
                      <StarBorderIcon sx={{ fontSize: '1rem' }} />
                    )
                  }
                  onClick={onSave}
                  data-testid={`simulation-list-save-toggle-${roleTestId}`}
                  disabled={savingStep}
                  sx={{
                    width: '100%',
                    ...(categoryKey === 'outsideTheBox'
                      ? {
                          ...OOTB_ACTION_BUTTON_SX,
                          ...(isStepSaved && !savingStep ? OOTB_SAVE_SAVED_BUTTON_SX : {}),
                        }
                      : isStepSaved && !savingStep
                        ? ROLE_CARD_SAVE_SAVED_SX
                        : {}),
                  }}
                  aria-label={
                    isStepSaved
                      ? t('simulation.evaluationFlow.tooltips.savedRemove')
                      : t('simulation.evaluationFlow.tooltips.saveToSavedList')
                  }
                >
                  {savingStep
                    ? t('simulation.evaluationFlow.actions.saving')
                    : isStepSaved
                      ? t('simulation.evaluationFlow.actions.saved')
                      : t('simulation.evaluationFlow.actions.save')}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

const GROUP_KEYS = ['keep', 'skip', 'dislike'];

/** Column headings in ranked view: align with Chip colors (keep=success green, skip=grey, dislike=error red). */
function rankGroupHeadingSx(groupKey) {
  switch (groupKey) {
    case 'keep':
      return { color: 'success.main', fontWeight: 700 };
    case 'skip':
      return { color: 'text.secondary', fontWeight: 700 };
    case 'dislike':
      return { color: 'error.main', fontWeight: 700 };
    default:
      return { color: 'text.secondary', fontWeight: 700 };
  }
}

const getRankRowId = (row, fallbackIndex) => {
  const byId = row?.id ?? row?.step?.id ?? row?.stepId;
  if (byId != null && byId !== '') return String(byId);
  const title = row?.step?.title ?? row?.title;
  if (title != null && title !== '') return getRoleTitleEnglishForMatch(title);
  return `row-${fallbackIndex}`;
};

const getContainerId = (groupKey) => `container:${groupKey}`;
const getItemId = (groupKey, rowId) => `item:${groupKey}:${rowId}`;

const parseContainerId = (id) => {
  if (typeof id !== 'string') return null;
  if (!id.startsWith('container:')) return null;
  return id.replace('container:', '');
};

const parseItemId = (id) => {
  if (typeof id !== 'string') return null;
  if (!id.startsWith('item:')) return null;
  const parts = id.split(':');
  if (parts.length < 3) return null;
  return {
    groupKey: parts[1],
    rowId: parts.slice(2).join(':'),
  };
};

const buildRankingStorageKey = ({
  categoryKey,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
}) => {
  const mode = isViewingSavedSimulation ? 'saved' : 'live';
  const simId =
    savedSimulationId || simulationIdForCards || 'local';
  return `simulation:rankingLayout:${mode}:${simId}:${categoryKey || 'default'}`;
};

const SortableRankedRoleCard = React.memo(function SortableRankedRoleCard({
  id,
  row,
  groupKey,
  isOver,
  isStepSaved,
  isStepSaving,
  onToggleSave,
  onMoveToGroup,
  onOpenStepDetails,
  categoryKey,
}) {
  const { t, i18n } = useTranslation('dashboard');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { type: 'item', groupKey, rowId: getRankRowId(row, 0) },
  });
  const role = row.step;
  const displayTitle = getRoleTitleForLocale(row.title, i18n.language);
  const saved = isStepSaved(role);
  const saving = isStepSaving(role);
  const roleTestId = role.stepId || role.id || getRoleTitleEnglishForMatch(role.title) || 'role';

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
      willChange: 'transform',
    }),
    [transform, transition, isDragging]
  );

  return (
    <Card
      ref={setNodeRef}
      style={style}
      variant="outlined"
      sx={{
        borderLeft: '4px solid',
        borderColor: isOver ? 'primary.main' : 'var(--color-ranked-role-card-border)',
        backgroundColor: isOver ? 'action.selected' : 'background.paper',
        boxShadow: isOver ? 3 : 0,
        transition: 'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
      }}
    >
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'stretch', sm: 'center' },
            justifyContent: 'space-between',
            gap: 1.5,
            flexDirection: { xs: 'column', sm: 'row' },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.5,
              flex: 1,
              minWidth: 0,
              width: { xs: '100%', sm: 'auto' },
            }}
          >
            <Tooltip title={t('simulation.evaluationFlow.tooltips.dragToReorder')} arrow>
              <Box
                {...attributes}
                {...listeners}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  alignSelf: 'center',
                  color: 'text.secondary',
                  cursor: 'grab',
                  pr: 0.5,
                  flexShrink: 0,
                  touchAction: 'none',
                }}
              >
                <DragIndicatorIcon fontSize="small" />
              </Box>
            </Tooltip>
            <Typography
              variant="body1"
              component="div"
              sx={{
                fontWeight: 600,
                minWidth: 0,
                flex: 1,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600, mr: 1 }}>
                #{row.finalRank}
              </Box>
              {displayTitle}
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              alignItems: 'stretch',
              gap: 1,
              width: { xs: '100%', sm: 'auto' },
              flexShrink: { sm: 0 },
            }}
          >
            <Tooltip title={t('simulation.evaluationFlow.tooltips.moreDetails')} arrow>
              <span style={{ display: 'block', width: '100%' }}>
                <Button
                  variant="contained"
                  color={categoryKey === 'outsideTheBox' ? 'inherit' : 'primary'}
                  size="small"
                  endIcon={<ArrowForwardIcon sx={{ fontSize: '0.9rem' }} />}
                  onClick={() => onOpenStepDetails(role)}
                  sx={(theme) => ({
                    ...rankedRowActionSx(theme),
                    ...(categoryKey === 'outsideTheBox' ? OOTB_ACTION_BUTTON_SX : {}),
                  })}
                >
                  {t('simulation.evaluationFlow.actions.more')}
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              title={
                saved
                  ? t('simulation.evaluationFlow.tooltips.savedRemove')
                  : t('simulation.evaluationFlow.tooltips.saveToSavedList')
              }
              arrow
            >
              <span style={{ display: 'block', width: '100%' }}>
                <Button
                  variant="contained"
                  color={categoryKey === 'outsideTheBox' ? 'inherit' : 'primary'}
                  size="small"
                  endIcon={saved ? <StarIcon sx={{ fontSize: '0.9rem' }} /> : <StarBorderIcon sx={{ fontSize: '0.9rem' }} />}
                  onClick={() => onToggleSave(role)}
                  data-testid={`simulation-ranking-save-toggle-${roleTestId}`}
                  disabled={saving}
                  sx={(theme) => ({
                    ...rankedRowActionSx(theme),
                    ...(categoryKey === 'outsideTheBox'
                      ? {
                          ...OOTB_ACTION_BUTTON_SX,
                          ...(saved && !saving ? OOTB_SAVE_SAVED_BUTTON_SX : {}),
                        }
                      : saved
                        ? { backgroundColor: 'var(--color-save-toggle-saved-on-primary)' }
                        : {}),
                  })}
                >
                  {saving
                    ? t('simulation.evaluationFlow.actions.saving')
                    : saved
                      ? t('simulation.evaluationFlow.actions.saved')
                      : t('simulation.evaluationFlow.actions.save')}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
});

function RankColumn({ groupKey, title, rows, itemIds, overMeta, children }) {
  const { t } = useTranslation('dashboard');
  const containerId = getContainerId(groupKey);
  const { setNodeRef } = useDroppable({
    id: containerId,
    data: { type: 'container', groupKey },
  });
  const isOverContainer = overMeta?.groupKey === groupKey && overMeta?.overType === 'container';

  return (
    <Box
      ref={setNodeRef}
      sx={{
        mb: 2,
        borderRadius: 1.5,
        border: '1px dashed',
        borderColor: isOverContainer ? 'primary.main' : 'transparent',
        backgroundColor: isOverContainer ? 'action.hover' : 'transparent',
        transition: 'border-color 140ms ease, background-color 140ms ease',
        p: 1,
        minHeight: 78,
      }}
    >
      <Typography variant="subtitle1" sx={{ mb: 1, ...rankGroupHeadingSx(groupKey) }}>
        {title}
      </Typography>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.length ? (
            children
          ) : (
            <Box
              sx={{
                minHeight: 56,
                borderRadius: 1,
                border: '1px dashed',
                borderColor: isOverContainer ? 'primary.main' : 'divider',
                backgroundColor: isOverContainer ? 'primary.50' : 'action.hover',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 140ms ease',
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {t('simulation.evaluationFlow.dropHere')}
              </Typography>
            </Box>
          )}
        </Box>
      </SortableContext>
    </Box>
  );
}

function RankedGroupsView({
  rankedRows,
  rankCategoryLabel,
  categoryKey,
  isStepSaved,
  isStepSaving,
  onToggleSave,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
  onReorderRankedRoles,
}) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('dashboard');
  const [activeId, setActiveId] = useState(null);
  const [overMeta, setOverMeta] = useState(null);
  const [persistedLayout, setPersistedLayout] = useState(null);
  const storageKey = useMemo(
    () =>
      buildRankingStorageKey({
        categoryKey,
        isViewingSavedSimulation,
        savedSimulationId,
        simulationIdForCards,
      }),
    [categoryKey, isViewingSavedSimulation, savedSimulationId, simulationIdForCards]
  );

  const openStepDetails = (role) => {
    const stepId = role.stepId || role.id || getRoleTitleEnglishForMatch(role.title);
    try {
      sessionStorage.setItem('currentStepDetails', JSON.stringify(role));
      storeSimulationResultDetails(role, [stepId]);
    } catch {
      /* ignore */
    }
    const path =
      isViewingSavedSimulation && savedSimulationId
        ? `/saved-simulation/${savedSimulationId}/career-step/${encodeURIComponent(stepId)}`
        : `/simulation/result/${encodeURIComponent(stepId)}`;
    const navigateFn = guardedNavigate || navigate;
    navigateFn(path);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const baseGroups = useMemo(() => {
    const grouped = { keep: [], skip: [], dislike: [] };
    rankedRows.forEach((row, index) => {
      if (grouped[row.userEvaluation]) {
        grouped[row.userEvaluation].push({ ...row, _dndId: getRankRowId(row, index) });
      }
    });
    return grouped;
  }, [rankedRows]);

  useEffect(() => {
    const allIds = new Set(rankedRows.map((row, idx) => getRankRowId(row, idx)));
    if (!allIds.size) {
      setPersistedLayout(null);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setPersistedLayout(null);
        return;
      }
      const parsed = JSON.parse(raw);
      const keep = Array.isArray(parsed?.keep) ? parsed.keep : [];
      const skip = Array.isArray(parsed?.skip) ? parsed.skip : [];
      const dislike = Array.isArray(parsed?.dislike) ? parsed.dislike : [];
      const incomingIds = [...keep, ...skip, ...dislike];
      if (!incomingIds.length) {
        setPersistedLayout(null);
        return;
      }
      const incomingSet = new Set(incomingIds);
      const sameUniverse = incomingSet.size === allIds.size && [...allIds].every((id) => incomingSet.has(id));
      setPersistedLayout(sameUniverse ? { keep, skip, dislike } : null);
    } catch {
      // Corrupt or unavailable local storage should not break ranking UX.
      setPersistedLayout(null);
    }
  }, [rankedRows, storageKey]);

  const groups = useMemo(() => {
    if (!persistedLayout) return baseGroups;
    const sourceById = new Map(
      rankedRows.map((row, idx) => [getRankRowId(row, idx), { ...row, _dndId: getRankRowId(row, idx) }])
    );
    const next = { keep: [], skip: [], dislike: [] };
    GROUP_KEYS.forEach((key) => {
      const wantedIds = persistedLayout[key] || [];
      wantedIds.forEach((id) => {
        const existing = sourceById.get(id);
        if (existing) {
          next[key].push({
            ...existing,
            userEvaluation: key,
            step: { ...existing.step, userEvaluation: key },
          });
          sourceById.delete(id);
        }
      });
    });
    sourceById.forEach((row) => {
      const key = row.userEvaluation;
      if (next[key]) next[key].push(row);
    });
    return next;
  }, [baseGroups, persistedLayout, rankedRows]);

  const idToLocation = useMemo(() => {
    const map = new Map();
    GROUP_KEYS.forEach((groupKey) => {
      groups[groupKey].forEach((row, index) => {
        map.set(row._dndId, { groupKey, index });
      });
    });
    return map;
  }, [groups]);

  const applyMoveAndPersist = (nextGroups) => {
    if (typeof onReorderRankedRoles !== 'function') return;
    const flattened = GROUP_KEYS.flatMap((key) => nextGroups[key]).map((row, idx) => ({
      ...row,
      finalRank: idx + 1,
      userEvaluation: row.userEvaluation,
      step: { ...row.step, userEvaluation: row.userEvaluation },
    }));
    const nextLayout = {
      keep: nextGroups.keep.map((row) => row._dndId),
      skip: nextGroups.skip.map((row) => row._dndId),
      dislike: nextGroups.dislike.map((row) => row._dndId),
    };
    setPersistedLayout(nextLayout);
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextLayout));
    } catch {
      // Ignore quota/private mode failures; parent persistence may still handle ranking.
    }
    onReorderRankedRoles(flattened);
  };

  const moveRoleById = (rowId, sourceGroup, targetGroup, targetIndex) => {
    const nextGroups = {
      keep: [...groups.keep],
      skip: [...groups.skip],
      dislike: [...groups.dislike],
    };
    const sourceIdx = nextGroups[sourceGroup].findIndex((row) => row._dndId === rowId);
    if (sourceIdx < 0) return;

    if (sourceGroup === targetGroup) {
      nextGroups[sourceGroup] = arrayMove(nextGroups[sourceGroup], sourceIdx, targetIndex);
      applyMoveAndPersist(nextGroups);
      return;
    }

    const [picked] = nextGroups[sourceGroup].splice(sourceIdx, 1);
    if (!picked) return;
    const withNewCategory = {
      ...picked,
      userEvaluation: targetGroup,
      step: { ...picked.step, userEvaluation: targetGroup },
    };
    const clampedIndex = Math.max(0, Math.min(targetIndex, nextGroups[targetGroup].length));
    nextGroups[targetGroup].splice(clampedIndex, 0, withNewCategory);
    applyMoveAndPersist(nextGroups);
  };

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event) => {
    const overId = event.over?.id;
    if (!overId) {
      setOverMeta(null);
      return;
    }
    const parsedContainer = parseContainerId(overId);
    if (parsedContainer) {
      setOverMeta({ groupKey: parsedContainer, overType: 'container' });
      return;
    }
    const parsedItem = parseItemId(overId);
    if (parsedItem) {
      setOverMeta({ groupKey: parsedItem.groupKey, overType: 'item', overId });
      return;
    }
    setOverMeta(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverMeta(null);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);
    setOverMeta(null);
    if (!over) return;

    const activeMeta = parseItemId(active.id);
    if (!activeMeta) return;

    const overContainer = parseContainerId(over.id);
    if (overContainer) {
      const targetIndex = groups[overContainer]?.length ?? 0;
      moveRoleById(activeMeta.rowId, activeMeta.groupKey, overContainer, targetIndex);
      return;
    }

    const overMetaItem = parseItemId(over.id);
    if (!overMetaItem) return;
    const targetLocation = idToLocation.get(overMetaItem.rowId);
    if (!targetLocation) return;
    moveRoleById(activeMeta.rowId, activeMeta.groupKey, targetLocation.groupKey, targetLocation.index);
  };

  const handleMoveToGroup = (sourceGroup, rowId, targetGroup) => {
    const targetIndex = groups[targetGroup]?.length ?? 0;
    moveRoleById(rowId, sourceGroup, targetGroup, targetIndex);
  };

  const itemIdsByGroup = useMemo(
    () => ({
      keep: groups.keep.map((row) => getItemId('keep', row._dndId)),
      skip: groups.skip.map((row) => getItemId('skip', row._dndId)),
      dislike: groups.dislike.map((row) => getItemId('dislike', row._dndId)),
    }),
    [groups]
  );

  const activeCard = useMemo(() => {
    const parsed = parseItemId(activeId);
    if (!parsed) return null;
    const location = idToLocation.get(parsed.rowId);
    if (!location) return null;
    const row = groups[location.groupKey][location.index];
    if (!row) return null;
    return { row, groupKey: location.groupKey };
  }, [activeId, idToLocation, groups]);

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('simulation.evaluationFlow.finalRankingDescription', { category: rankCategoryLabel })}
      </Typography>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <RankColumn
          groupKey="keep"
          title={t('simulation.evaluationFlow.actions.keep')}
          rows={groups.keep}
          itemIds={itemIdsByGroup.keep}
          overMeta={overMeta}
        >
          {groups.keep.map((row) => {
            const id = getItemId('keep', row._dndId);
            return (
              <SortableRankedRoleCard
                key={id}
                id={id}
                row={row}
                groupKey="keep"
                isOver={overMeta?.overType === 'item' && overMeta?.overId === id}
                isStepSaved={isStepSaved}
                isStepSaving={isStepSaving}
                onToggleSave={onToggleSave}
                onMoveToGroup={handleMoveToGroup}
                onOpenStepDetails={openStepDetails}
                categoryKey={categoryKey}
              />
            );
          })}
        </RankColumn>
        <RankColumn
          groupKey="skip"
          title={t('simulation.evaluationFlow.actions.skip')}
          rows={groups.skip}
          itemIds={itemIdsByGroup.skip}
          overMeta={overMeta}
        >
          {groups.skip.map((row) => {
            const id = getItemId('skip', row._dndId);
            return (
              <SortableRankedRoleCard
                key={id}
                id={id}
                row={row}
                groupKey="skip"
                isOver={overMeta?.overType === 'item' && overMeta?.overId === id}
                isStepSaved={isStepSaved}
                isStepSaving={isStepSaving}
                onToggleSave={onToggleSave}
                onMoveToGroup={handleMoveToGroup}
                onOpenStepDetails={openStepDetails}
                categoryKey={categoryKey}
              />
            );
          })}
        </RankColumn>
        <RankColumn
          groupKey="dislike"
          title={t('simulation.evaluationFlow.actions.dislike')}
          rows={groups.dislike}
          itemIds={itemIdsByGroup.dislike}
          overMeta={overMeta}
        >
          {groups.dislike.map((row) => {
            const id = getItemId('dislike', row._dndId);
            return (
              <SortableRankedRoleCard
                key={id}
                id={id}
                row={row}
                groupKey="dislike"
                isOver={overMeta?.overType === 'item' && overMeta?.overId === id}
                isStepSaved={isStepSaved}
                isStepSaving={isStepSaving}
                onToggleSave={onToggleSave}
                onMoveToGroup={handleMoveToGroup}
                onOpenStepDetails={openStepDetails}
                categoryKey={categoryKey}
              />
            );
          })}
        </RankColumn>

        <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
          {activeCard ? (
            <Box
              sx={{
                transform: 'scale(1.02)',
                boxShadow: 'var(--shadow-overlay-lg)',
                borderRadius: 1,
              }}
            >
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <DragIndicatorIcon fontSize="small" color="action" />
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600, mr: 1 }}>
                        #{activeCard.row.finalRank}
                      </Box>
                      {getRoleTitleForLocale(activeCard.row.title, i18n.language)}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Box>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Box>
  );
}

/**
 * @param {object} props
 */
export default function SimulationCategoryEvaluation({
  title,
  categoryKey,
  roles,
  phase,
  rankedRows,
  hasStarted,
  onEvaluate,
  onSeeRanking,
  onEditRatings,
  isStepSaved,
  isStepSaving,
  onToggleSave,
  guardedNavigate,
  isViewingSavedSimulation,
  savedSimulationId,
  simulationIdForCards,
  onReorderRankedRoles,
}) {
  const { t } = useTranslation('dashboard');
  const pending = useMemo(() => roles.filter((r) => r.userEvaluation == null), [roles]);
  const cardsToShow = useMemo(() => {
    if (isEvaluationComplete(roles)) return roles;
    return pending.slice(0, EVALUATION_VISIBLE_SLOTS);
  }, [roles, pending]);

  const evaluated = countEvaluatedRoles(roles);
  const total = roles.length;
  const complete = isEvaluationComplete(roles);
  /** All roles rated but user has not opened the ranking yet (`ranked` is only set after "See your ranking"). */
  const awaitingRankingReveal =
    complete && phase === 'eval' && !rankedRows?.length;

  if (phase === 'ranked' && Array.isArray(rankedRows) && rankedRows.length) {
    return (
      <Box
        sx={{
          mb: 4,
          p: { xs: 2, sm: 2.5, md: 3 },
          borderRadius: 2,
          bgcolor: 'var(--color-ranking-panel-bg)',
          /* Match default `Paper` elevation on simulation detail headers */
          boxShadow: (theme) => theme.shadows[1],
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'stretch', sm: 'center' },
            justifyContent: 'space-between',
            mb: 2,
            gap: 1.5,
            flexDirection: { xs: 'column', sm: 'row' },
          }}
        >
          <Typography
            variant="h4"
            component="h2"
            sx={{
              fontWeight: 'bold',
              flex: 1,
              minWidth: 0,
              typography: { xs: 'h5', sm: 'h4' },
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              pr: { sm: 1 },
            }}
          >
            {t('simulation.evaluationFlow.yourRankingTitle', { title })}
          </Typography>
          {typeof onEditRatings === 'function' ? (
            <Button
              variant="contained"
              color={categoryKey === 'outsideTheBox' ? 'inherit' : 'primary'}
              size="medium"
              startIcon={<EditIcon />}
              onClick={onEditRatings}
              sx={{
                fontWeight: 600,
                px: 3,
                py: 1.5,
                fontSize: '1rem',
                alignSelf: { xs: 'stretch', sm: 'auto' },
                width: { xs: '100%', sm: 'auto' },
                whiteSpace: { xs: 'normal', sm: 'nowrap' },
                ...(categoryKey === 'outsideTheBox' ? OOTB_ACTION_BUTTON_SX : {}),
              }}
            >
              {t('simulation.evaluationFlow.changeYourRanking')}
            </Button>
          ) : null}
        </Box>
        <RankedGroupsView
          rankedRows={rankedRows}
          rankCategoryLabel={title}
          categoryKey={categoryKey}
          isStepSaved={isStepSaved}
          isStepSaving={isStepSaving}
          onToggleSave={onToggleSave}
          guardedNavigate={guardedNavigate}
          isViewingSavedSimulation={isViewingSavedSimulation}
          savedSimulationId={savedSimulationId}
          simulationIdForCards={simulationIdForCards}
          onReorderRankedRoles={onReorderRankedRoles}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          mb: 2,
          gap: 1.5,
          flexDirection: { xs: 'column', sm: 'row' },
        }}
      >
        <Typography
          variant="h4"
          component="h2"
          sx={{
            fontWeight: 'bold',
            flex: 1,
            minWidth: 0,
            typography: { xs: 'h5', sm: 'h4' },
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            pr: { sm: 1 },
          }}
        >
          {title}
        </Typography>
        {!awaitingRankingReveal && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'auto' } }}
          >
            {t('simulation.evaluationFlow.rolesEvaluated', { evaluated, total })}
          </Typography>
        )}
      </Box>
      {!awaitingRankingReveal && (
        <LinearProgress
          variant="determinate"
          value={total ? (evaluated / total) * 100 : 0}
          sx={{ height: 6, borderRadius: 3, mb: 2 }}
        />
      )}

      {!total ? (
        <Typography variant="body2" color="text.secondary">
          {t('simulation.evaluationFlow.noRolesInCategory')}
        </Typography>
      ) : awaitingRankingReveal ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button
            variant="contained"
            color="primary"
            size="medium"
            startIcon={<ThumbUpAltOutlinedIcon />}
            onClick={onSeeRanking}
            sx={{
              fontWeight: 600,
              px: 3,
              py: 1.5,
              fontSize: '1rem',
            }}
          >
            {t('simulation.evaluationFlow.seeYourRanking')}
          </Button>
        </Box>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {complete
              ? t('simulation.evaluationFlow.allRolesRated', { total })
              : hasStarted
                ? t('simulation.evaluationFlow.continue')
                : t('simulation.evaluationFlow.start')}
          </Typography>

          <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} sx={{ mb: 2 }}>
            {cardsToShow.map((role) => (
              <Grid item xs={12} sm={6} md={6} lg={4} key={role.id}>
                <RoleEvaluationCard
                  role={role}
                  categoryKey={categoryKey}
                  isViewingSavedSimulation={isViewingSavedSimulation}
                  savedSimulationId={savedSimulationId}
                  onEvaluate={onEvaluate}
                  onSave={() => onToggleSave(role)}
                  isStepSaved={isStepSaved(role)}
                  savingStep={isStepSaving(role)}
                  guardedNavigate={guardedNavigate}
                />
              </Grid>
            ))}
          </Grid>

          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Button
              variant={complete ? 'contained' : 'outlined'}
              color="primary"
              size="medium"
              startIcon={<ThumbUpAltOutlinedIcon />}
              disabled={!complete}
              onClick={onSeeRanking}
              sx={{
                fontWeight: 600,
                px: 3,
                py: 1.5,
                fontSize: '1rem',
              }}
            >
              {t('simulation.evaluationFlow.seeYourRanking')}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}
