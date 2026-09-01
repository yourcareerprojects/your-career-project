import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
  keyframes,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AddIcon from '@mui/icons-material/Add';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { getAllowedNextCategories, getPreferredNextCategory } from '../../../constants/puzzleCategories';
import { getCategoryColors } from './puzzleVisuals';
import { nextStepDragId, PUZZLE_REMOVE_DROPPABLE_ID } from './puzzleDnD';
import PuzzlePieceDetailDialog from './PuzzlePieceDetailDialog';
import { localizedPuzzleText } from '../../hooks/useCareerPuzzleQueries';
import { baseUILanguage } from '../../hooks/useProfileQueries';
import { useEvalActionNudge } from '../../hooks/useEvalActionNudge';

const MAX_STEPS_PER_CATEGORY = 3;

const cardEnter = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
`;

const ACTION_BTN_SX = { flex: 1, minWidth: 0 };

function stopDragPropagation(event) {
  event.stopPropagation();
}

function NextStepCardContent({ title, description, colors, categoryLabel }) {
  return (
    <>
      <Chip
        size="small"
        label={categoryLabel}
        sx={{
          mb: 1,
          bgcolor: colors.accent,
          color: '#fff',
          fontWeight: 600,
          height: 22,
        }}
      />
      <Typography variant="subtitle1" fontWeight={700}>
        {title}
      </Typography>
      {description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mt: 0.5,
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: '1.4em',
          }}
        >
          {description}
        </Typography>
      ) : null}
    </>
  );
}

function NextStepCard({
  step,
  onSelect,
  onMore,
  index,
  nudgeSx,
  nudgeInteractionHandlers,
  dragDisabled = false,
}) {
  const { t } = useTranslation('dashboard');
  const lang = baseUILanguage();
  const piece = step.piece;
  const colors = getCategoryColors(piece.category);
  const title = localizedPuzzleText(piece.title, lang);
  const description = localizedPuzzleText(piece.shortDescription, lang);
  const categoryLabel = t(`careerPuzzle.categories.${piece.category}`, {
    defaultValue: String(piece.category || '').replace(/_/g, ' '),
  });
  const enterDelaySec = Math.min(index, 8) * 0.04;
  const [enterComplete, setEnterComplete] = useState(false);
  const suppressClickRef = useRef(false);
  const dragId = nextStepDragId(piece.id);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: 'next-step', piece },
    disabled: dragDisabled,
  });

  useEffect(() => {
    if (isDragging) suppressClickRef.current = true;
  }, [isDragging]);

  useEffect(() => {
    const timer = setTimeout(
      () => setEnterComplete(true),
      (enterDelaySec + 0.4) * 1000 + 50
    );
    return () => clearTimeout(timer);
  }, [enterDelaySec]);

  const { animation: nudgeAnimation, ...nudgeRest } = nudgeSx || {};

  const handleAdd = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect(piece);
  };

  return (
    <Box
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      sx={{
        boxSizing: 'border-box',
        display: 'block',
        width: '100%',
        cursor: dragDisabled ? 'default' : isDragging ? 'grabbing' : 'grab',
        borderRadius: 3,
        border: '2px solid',
        borderColor: colors.border,
        bgcolor: colors.bg,
        p: 2,
        transition: 'box-shadow 0.15s ease',
        opacity: isDragging ? 0.35 : 1,
        touchAction: 'none',
        ...nudgeRest,
        animation: isDragging
          ? 'none'
          : nudgeAnimation
            || (enterComplete
              ? 'none'
              : `${cardEnter} 0.4s ease-out ${enterDelaySec}s both`),
        '&:hover': {
          transform: isDragging || nudgeAnimation ? undefined : 'translateY(-3px) scale(1.01)',
          boxShadow: 3,
        },
      }}
    >
      <NextStepCardContent
        title={title}
        description={description}
        colors={colors}
        categoryLabel={categoryLabel}
      />
      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 1.5 }}
        onPointerDown={stopDragPropagation}
        onMouseDown={stopDragPropagation}
        onTouchStart={stopDragPropagation}
        {...nudgeInteractionHandlers}
      >
        <Button
          variant="outlined"
          size="small"
          color="primary"
          startIcon={<ArrowForwardIcon sx={{ fontSize: '1rem' }} />}
          onClick={() => onMore(piece)}
          sx={ACTION_BTN_SX}
        >
          {t('careerPuzzle.more')}
        </Button>
        <Button
          variant="contained"
          size="small"
          color="primary"
          startIcon={<AddIcon sx={{ fontSize: '1rem' }} />}
          onClick={handleAdd}
          sx={ACTION_BTN_SX}
        >
          {t('careerPuzzle.addToPath')}
        </Button>
      </Stack>
    </Box>
  );
}

/** Lightweight preview used in the drag overlay. */
export function NextStepDragPreview({ piece }) {
  const { t } = useTranslation('dashboard');
  const lang = baseUILanguage();
  if (!piece) return null;
  const colors = getCategoryColors(piece.category);
  const title = localizedPuzzleText(piece.title, lang);
  const description = localizedPuzzleText(piece.shortDescription, lang);
  const categoryLabel = t(`careerPuzzle.categories.${piece.category}`, {
    defaultValue: String(piece.category || '').replace(/_/g, ' '),
  });

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 420,
        borderRadius: 3,
        border: '2px solid',
        borderColor: colors.border,
        bgcolor: colors.bg,
        p: 2,
        boxShadow: 6,
        cursor: 'grabbing',
      }}
    >
      <NextStepCardContent
        title={title}
        description={description}
        colors={colors}
        categoryLabel={categoryLabel}
      />
    </Box>
  );
}

/**
 * Visual choice grid for next puzzle pieces — category first, then matching steps.
 * Also acts as the drop zone for removing the last path tip.
 */
export default function NextStepSelector({
  steps = [],
  tipCategory = '',
  loading = false,
  onSelect,
  selecting = false,
  removeDropEnabled = false,
  atStepLimit = false,
  maxUserSteps = 3,
}) {
  const { t } = useTranslation('dashboard');
  const [detailPiece, setDetailPiece] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);

  const stepsFingerprint = useMemo(
    () =>
      steps
        .map((step) => String(step.piece?.id ?? ''))
        .filter(Boolean)
        .join('|'),
    [steps]
  );

  const availableCategories = useMemo(() => {
    const present = new Set(
      steps
        .map((step) => String(step.piece?.category || '').trim())
        .filter(Boolean)
    );
    const allowed = getAllowedNextCategories(tipCategory);
    return allowed.filter((category) => present.has(category));
  }, [steps, tipCategory]);

  // Preselect the most suitable category whenever the tip or next-step set changes.
  useEffect(() => {
    setSelectedCategory(getPreferredNextCategory(tipCategory, availableCategories));
  }, [tipCategory, stepsFingerprint, availableCategories]);

  const visibleSteps = useMemo(() => {
    if (!selectedCategory) return [];
    return steps
      .filter((step) => step.piece?.category === selectedCategory)
      .slice(0, MAX_STEPS_PER_CATEGORY);
  }, [steps, selectedCategory]);

  const buttonKeys = useMemo(
    () => visibleSteps.map((step) => String(step.piece?.id ?? '')).filter(Boolean),
    [visibleSteps]
  );
  const { setNodeRef, isOver } = useDroppable({
    id: PUZZLE_REMOVE_DROPPABLE_ID,
    disabled: !removeDropEnabled,
  });
  const { interactionHandlers, getButtonNudgeSx } = useEvalActionNudge({
    enabled:
      !loading &&
      !selecting &&
      !removeDropEnabled &&
      !atStepLimit &&
      buttonKeys.length > 0,
    buttonKeys: buttonKeys.length > 0 ? buttonKeys : ['__none__'],
  });

  const handleCloseDetail = () => {
    if (selecting) return;
    setDetailPiece(null);
  };

  const handleAddFromDetail = async (piece) => {
    if (!piece || selecting) return;
    try {
      await onSelect?.(piece);
      setDetailPiece(null);
    } catch {
      // Keep dialog open; parent surfaces the mutation error.
    }
  };

  const handleCategoryClick = (category) => {
    setSelectedCategory(category);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  const showCategoryPicker =
    !atStepLimit && steps.length > 0 && availableCategories.length > 0;

  return (
    <Box
      ref={setNodeRef}
      sx={{
        borderRadius: 3,
        border: '2px dashed',
        borderColor: isOver ? 'error.main' : 'transparent',
        bgcolor: (theme) =>
          isOver ? `${theme.palette.error.main}14` : 'transparent',
        p: isOver || removeDropEnabled ? 1.5 : 0,
        transition: 'border-color 0.15s ease, background-color 0.15s ease, padding 0.15s ease',
        minHeight: removeDropEnabled ? 120 : undefined,
      }}
    >
      <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
        {isOver
          ? t('careerPuzzle.dropToRemove')
          : atStepLimit
            ? t('careerPuzzle.pathCompleteTitle')
            : t('careerPuzzle.chooseNext')}
      </Typography>

      {showCategoryPicker ? (
        <Stack
          direction="row"
          useFlexGap
          flexWrap="wrap"
          spacing={1}
          sx={{
            mb: 1.5,
            opacity: isOver ? 0.55 : 1,
            pointerEvents: removeDropEnabled ? 'none' : 'auto',
          }}
        >
          {availableCategories.map((category) => {
            const colors = getCategoryColors(category);
            const selected = selectedCategory === category;
            return (
              <Chip
                key={category}
                clickable
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                label={t(`careerPuzzle.categories.${category}`, {
                  defaultValue: category.replace(/_/g, ' '),
                })}
                onClick={() => handleCategoryClick(category)}
                sx={{
                  fontWeight: 600,
                  borderColor: colors.border,
                  ...(selected
                    ? {
                        bgcolor: colors.accent,
                        color: '#fff',
                        borderColor: colors.accent,
                        '&:hover': { bgcolor: colors.accent },
                      }
                    : {
                        color: colors.accent,
                        '&:hover': {
                          bgcolor: `${colors.accent}14`,
                          borderColor: colors.border,
                        },
                      }),
                }}
              />
            );
          })}
        </Stack>
      ) : null}

      {!steps.length ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
          {removeDropEnabled
            ? t('careerPuzzle.dropToRemoveHint')
            : atStepLimit
              ? t('careerPuzzle.pathCompleteHint', { count: maxUserSteps })
              : t('careerPuzzle.noNextSteps')}
        </Typography>
      ) : !selectedCategory ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
          {isOver
            ? t('careerPuzzle.dropToRemoveHint')
            : t('careerPuzzle.selectCategoryHint')}
        </Typography>
      ) : (
        <Stack
          spacing={1.5}
          sx={{
            opacity: selecting || isOver ? 0.55 : 1,
            pointerEvents: selecting || removeDropEnabled ? 'none' : 'auto',
          }}
        >
          {visibleSteps.map((step, index) => {
            const pieceKey = String(step.piece.id);
            return (
              <NextStepCard
                key={pieceKey}
                step={step}
                index={index}
                onSelect={onSelect}
                onMore={setDetailPiece}
                dragDisabled={selecting || removeDropEnabled}
                nudgeSx={getButtonNudgeSx(pieceKey)}
                nudgeInteractionHandlers={interactionHandlers}
              />
            );
          })}
        </Stack>
      )}

      <PuzzlePieceDetailDialog
        pieceId={detailPiece?.id || null}
        pieceFallback={detailPiece}
        open={Boolean(detailPiece)}
        onClose={handleCloseDetail}
        onAdd={handleAddFromDetail}
        adding={selecting}
      />
    </Box>
  );
}
