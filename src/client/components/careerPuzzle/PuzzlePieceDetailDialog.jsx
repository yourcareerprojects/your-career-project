import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import { localizedPuzzleText, usePuzzlePieceDetailQuery } from '../../hooks/useCareerPuzzleQueries';
import { useOccupationLookupQuery } from '../../hooks/useOccupationSearch';
import { baseUILanguage } from '../../hooks/useProfileQueries';
import { CareerStepRoleInlineBody } from '../common/CareerStepRoleSections';
import { getRoleTitleForLocale } from '../../utils/roleTitleDisplay';

/**
 * Detail dialog for a puzzle piece (next-step or path piece).
 * @param {{
 *   pieceId: string|null,
 *   pieceFallback?: object|null,
 *   open: boolean,
 *   onClose: () => void,
 *   onAdd?: (piece: object) => void,
 *   adding?: boolean,
 *   showAdd?: boolean,
 * }} props
 */
export default function PuzzlePieceDetailDialog({
  pieceId,
  pieceFallback = null,
  open,
  onClose,
  onAdd,
  adding = false,
  showAdd = true,
}) {
  const { t } = useTranslation('dashboard');
  const lang = baseUILanguage();
  const detailQuery = usePuzzlePieceDetailQuery(pieceId, {
    enabled: open && Boolean(pieceId),
  });
  const piece = detailQuery.data?.piece || pieceFallback;
  const careerPath = detailQuery.data?.careerPath;

  const escoId = piece?.escoId || careerPath?.escoId || null;
  const careerPathId = piece?.careerPathId || careerPath?.id || null;
  const isDatabaseRole = Boolean(escoId || careerPathId);

  const occupationQuery = useOccupationLookupQuery({
    escoId,
    careerPathId: escoId ? null : careerPathId,
    enabled: open && isDatabaseRole,
  });

  const pieceTitle = localizedPuzzleText(piece?.title, lang);
  const pieceDescription = localizedPuzzleText(piece?.shortDescription, lang);
  const occupation = occupationQuery.data || null;
  const roleTitle = occupation
    ? getRoleTitleForLocale(occupation.title, lang)
    : pieceTitle;
  const dialogTitle = roleTitle || t('careerPuzzle.pieceDetail');

  const showRoleBody = isDatabaseRole && Boolean(occupation);
  const loading =
    (detailQuery.isLoading && !piece) ||
    (isDatabaseRole && occupationQuery.isLoading && !occupation);
  const loadFailed = !loading && !piece && !occupation;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (adding) return;
        onClose?.();
      }}
      fullWidth
      maxWidth={showRoleBody ? 'md' : 'sm'}
      scroll="paper"
      PaperProps={{
        sx: {
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          pr: 1,
        }}
      >
        <Typography
          component="span"
          variant="h6"
          fontWeight={700}
          sx={{ wordBreak: 'break-word', pr: 1 }}
        >
          {dialogTitle}
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label={t('careerPuzzle.closeDetail')}
          size="small"
          disabled={adding}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : loadFailed ? (
          <Alert severity="warning">{t('careerPuzzle.pieceNotFound')}</Alert>
        ) : showRoleBody ? (
          <CareerStepRoleInlineBody
            stepDetails={occupation}
            simulationScopeId="career-puzzle"
          />
        ) : (
          <Box>
            {isDatabaseRole && occupationQuery.isError ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t('roleSearch.errors.loadFailed')}
              </Alert>
            ) : null}
            {piece?.category ? (
              <Chip
                size="small"
                label={t(`careerPuzzle.categories.${piece.category}`, {
                  defaultValue: String(piece.category || '').replace(/_/g, ' '),
                })}
                sx={{ mb: 1.5, fontWeight: 600 }}
              />
            ) : null}
            {pieceTitle ? (
              <Typography variant="subtitle1" fontWeight={700}>
                {pieceTitle}
              </Typography>
            ) : null}
            {pieceDescription ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {pieceDescription}
              </Typography>
            ) : null}
            {piece?.metadata?.estimatedDurationMonths ? (
              <Typography variant="body2" sx={{ mt: 1.5 }}>
                {t('careerPuzzle.estimatedDuration', {
                  months: piece.metadata.estimatedDurationMonths,
                })}
              </Typography>
            ) : null}
          </Box>
        )}
      </DialogContent>
      {showAdd ? (
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            variant="contained"
            color="primary"
            disabled={!piece || adding}
            startIcon={adding ? undefined : <AddIcon />}
            onClick={() => piece && onAdd?.(piece)}
          >
            {adding ? <CircularProgress size={20} /> : t('careerPuzzle.addToPath')}
          </Button>
        </DialogActions>
      ) : null}
    </Dialog>
  );
}

/**
 * Build a piece-shaped fallback from a path node (snapshot + linked piece).
 * @param {object|null|undefined} node
 * @returns {object|null}
 */
export function pieceFallbackFromPathNode(node) {
  if (!node) return null;
  const base = node.piece || {};
  return {
    ...base,
    id: base.id || (node.pieceId != null ? String(node.pieceId) : null),
    category: node.snapshot?.category || base.category || '',
    title: node.snapshot?.title || base.title || null,
    shortDescription:
      node.snapshot?.shortDescription || base.shortDescription || null,
  };
}
