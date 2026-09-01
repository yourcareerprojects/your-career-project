import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import StarIcon from '@mui/icons-material/Star';
import { useTranslation } from 'react-i18next';

/**
 * Minimal path controls: undo, optional save.
 */
export default function PathManager({
  canUndo = false,
  canSave = false,
  isFavorite = false,
  onUndo,
  onSaveClick,
  undoPending = false,
  savePending = false,
  showSave = true,
}) {
  const { t } = useTranslation('dashboard');

  return (
    <Box sx={{ width: '100%', maxWidth: 440, mx: 'auto' }}>
      <Typography variant="overline" color="text.secondary">
        {t('careerPuzzle.pathActions')}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<UndoIcon />}
          disabled={!canUndo || undoPending || savePending}
          onClick={onUndo}
        >
          {t('careerPuzzle.undo')}
        </Button>
        {showSave ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={isFavorite ? <StarIcon /> : <StarBorderIcon />}
            disabled={!canSave || savePending}
            onClick={onSaveClick}
          >
            {isFavorite ? t('careerPuzzle.unfavorite') : t('careerPuzzle.favorite')}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}
