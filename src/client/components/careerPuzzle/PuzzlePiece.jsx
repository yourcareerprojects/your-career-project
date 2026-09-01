import React, { useEffect, useRef } from 'react';
import { Box, Button, Chip, IconButton, Stack, Typography, keyframes } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { getCategoryColors } from './puzzleVisuals';
import {
  PUZZLE_TIP_DROPPABLE_ID,
  pathTipDragId,
  pieceFromPathNode,
} from './puzzleDnD';
import { localizedPuzzleText } from '../../hooks/useCareerPuzzleQueries';
import { baseUILanguage } from '../../hooks/useProfileQueries';

const snapIn = keyframes`
  from { opacity: 0; transform: translateY(12px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const ACTION_BTN_SX = { flex: 1, minWidth: 0 };

function stopDragPropagation(event) {
  event.stopPropagation();
}
function TipSlot({ onClick, dropEnabled = true }) {
  const { t } = useTranslation('dashboard');
  const { setNodeRef, isOver } = useDroppable({
    id: PUZZLE_TIP_DROPPABLE_ID,
    disabled: !dropEnabled,
  });

  return (
    <Box
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-label={t('careerPuzzle.emptySlotAria')}
      sx={{
        width: '100%',
        minHeight: 88,
        borderRadius: 3,
        border: '2px dashed',
        borderColor: isOver ? 'primary.dark' : 'primary.main',
        bgcolor: (theme) =>
          isOver ? `${theme.palette.primary.main}1F` : theme.palette.action.hover,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        cursor: 'default',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      }}
    >
      <Typography variant="body2" color="primary.main" fontWeight={600}>
        {isOver ? t('careerPuzzle.dropHere') : t('careerPuzzle.emptySlot')}
      </Typography>
    </Box>
  );
}

function formatEndDate(endDate, t, lang) {
  if (!endDate?.month || !endDate?.year) return '';
  const month = Number(endDate.month);
  const year = Number(endDate.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    return '';
  }
  const monthLabel = t(`careerPuzzle.editDialog.months.${month}`);
  if (lang === 'de') return `${monthLabel} ${year}`;
  return `${monthLabel} ${year}`;
}

/**
 * @param {{
 *   node?: object,
 *   empty?: boolean,
 *   isTipSlot?: boolean,
 *   onClick?: () => void,
 *   onEditClick?: () => void,
 *   onMoreClick?: () => void,
 *   onRemoveClick?: () => void,
 *   removePending?: boolean,
 *   dropEnabled?: boolean,
 *   removable?: boolean,
 *   removeDragDisabled?: boolean,
 * }} props
 */
export default function PuzzlePiece({
  node = null,
  empty = false,
  isTipSlot = false,
  onClick,
  onEditClick,
  onMoreClick,
  onRemoveClick,
  removePending = false,
  dropEnabled = true,
  removable = false,
  removeDragDisabled = false,
}) {
  const { t } = useTranslation('dashboard');
  const lang = baseUILanguage();
  const suppressClickRef = useRef(false);

  const canDragRemove = Boolean(removable && node && !node.locked && !removeDragDisabled);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: pathTipDragId(node?.instanceId || 'none'),
    data: {
      type: 'path-tip',
      piece: pieceFromPathNode(node),
      instanceId: node?.instanceId,
    },
    disabled: !canDragRemove || removePending,
  });

  useEffect(() => {
    if (isDragging) suppressClickRef.current = true;
  }, [isDragging]);

  if (empty || isTipSlot) {
    return <TipSlot onClick={onClick} dropEnabled={dropEnabled} />;
  }

  const category = node?.snapshot?.category || node?.piece?.category || '';
  const colors = getCategoryColors(category);
  const title =
    localizedPuzzleText(node?.snapshot?.title, lang) ||
    localizedPuzzleText(node?.piece?.title, lang) ||
    node?.pieceKey ||
    '';
  const description =
    localizedPuzzleText(node?.snapshot?.shortDescription, lang) ||
    localizedPuzzleText(node?.piece?.shortDescription, lang);
  const locked = Boolean(node?.locked);
  const canEdit = Boolean(locked && onEditClick);
  const canMore = Boolean(!locked && onMoreClick);
  const canRemove = Boolean(!locked && onRemoveClick);
  const showFutureActions = canMore || canRemove;
  const endDateLabel = formatEndDate(node?.snapshot?.endDate, t, lang);

  return (
    <Box
      ref={canDragRemove ? setNodeRef : undefined}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onClick?.();
      }}
      {...(canDragRemove ? { ...listeners, ...attributes } : {})}
      sx={{
        width: '100%',
        borderRadius: 3,
        border: '2px solid',
        borderColor: colors.border,
        bgcolor: colors.bg,
        px: 2.25,
        py: 1.75,
        position: 'relative',
        animation: isDragging ? 'none' : `${snapIn} 0.35s ease-out`,
        cursor: canDragRemove
          ? isDragging
            ? 'grabbing'
            : 'grab'
          : onClick
            ? 'pointer'
            : 'default',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        opacity: isDragging ? 0.35 : locked ? 0.95 : 1,
        touchAction: canDragRemove ? 'none' : undefined,
        '&:hover': onClick || canDragRemove
          ? { transform: isDragging ? undefined : 'translateY(-2px)', boxShadow: 2 }
          : undefined,
      }}
    >
      {canEdit ? (
        <IconButton
          size="small"
          aria-label={t('careerPuzzle.editDialog.editAria')}
          onClick={(event) => {
            event.stopPropagation();
            onEditClick?.();
          }}
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      ) : null}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 0.5,
          pr: canEdit ? 4.5 : 0,
          flexWrap: 'wrap',
        }}
      >
        <Chip
          size="small"
          label={t(`careerPuzzle.categories.${category}`, {
            defaultValue: category.replace(/_/g, ' '),
          })}
          sx={{
            bgcolor: colors.accent,
            color: '#fff',
            fontWeight: 600,
            height: 22,
            '& .MuiChip-label': { px: 1 },
          }}
        />
        {locked && (
          <Chip
            size="small"
            icon={<LockOutlinedIcon sx={{ fontSize: 14 }} />}
            label={t('careerPuzzle.locked')}
            variant="outlined"
            sx={{ height: 22 }}
          />
        )}
      </Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ color: 'text.primary', pr: canEdit ? 4 : 0 }}>
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
      {endDateLabel ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
          {t('careerPuzzle.editDialog.endDateDisplay', { date: endDateLabel })}
        </Typography>
      ) : null}
      {showFutureActions ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 1.5 }}
          onPointerDown={stopDragPropagation}
          onMouseDown={stopDragPropagation}
          onTouchStart={stopDragPropagation}
        >
          {canMore ? (
            <Button
              variant="contained"
              size="small"
              color="primary"
              startIcon={<ArrowForwardIcon sx={{ fontSize: '1rem' }} />}
              onClick={(event) => {
                event.stopPropagation();
                onMoreClick?.();
              }}
              disabled={removePending}
              sx={ACTION_BTN_SX}
            >
              {t('careerPuzzle.more')}
            </Button>
          ) : null}
          {canRemove ? (
            <Button
              variant="outlined"
              size="small"
              color="primary"
              startIcon={
                removePending ? undefined : (
                  <RemoveCircleOutlineIcon sx={{ fontSize: '1rem' }} />
                )
              }
              onClick={(event) => {
                event.stopPropagation();
                onRemoveClick?.();
              }}
              disabled={removePending}
              sx={ACTION_BTN_SX}
            >
              {removePending ? '…' : t('careerPuzzle.removeFromPath')}
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}
