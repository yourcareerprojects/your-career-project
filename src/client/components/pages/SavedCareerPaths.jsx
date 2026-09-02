import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  CircularProgress,
  Button,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Card,
  CardContent,
  Grid,
  Tooltip,
} from '@mui/material';
import PuzzlePieceIcon from '@mui/icons-material/Extension';
import { StarBorder as StarBorderIcon } from '@mui/icons-material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../common/PageHeader';
import {
  useSavedCareerPathsQuery,
  useUpdatePuzzlePathMutation,
  deriveCareerPathTitle,
  localizedPuzzleText,
} from '../../hooks/useCareerPuzzleQueries';
import { baseUILanguage } from '../../hooks/useProfileQueries';

const CARD_ACTION_BTN_SX = { width: '100%' };
const SAVED_PATH_BORDER = 'var(--color-primary)';

const SavedCareerPaths = () => {
  const { t, i18n } = useTranslation(['dashboard', 'onboarding']);
  const navigate = useNavigate();
  const lang = baseUILanguage();
  const { data: savedPaths = [], isLoading, isError, error } = useSavedCareerPathsQuery();
  const updateMutation = useUpdatePuzzlePathMutation();
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [unsaveDialogOpen, setUnsaveDialogOpen] = useState(false);
  const [pathToUnsave, setPathToUnsave] = useState(null);

  const pathPendingUnsave = useMemo(
    () => savedPaths.find((path) => path.pathId === pathToUnsave) || null,
    [pathToUnsave, savedPaths]
  );

  const formatPathCardDate = (dateString) => {
    if (dateString == null || dateString === '') return '—';
    const d = dateString instanceof Date ? dateString : new Date(dateString);
    if (Number.isNaN(d.getTime())) {
      return t('savedLists.savedCareerPaths.invalidDate');
    }
    const loc = String(i18n.resolvedLanguage || i18n.language || 'en').replace(/_/g, '-');
    return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getPathDisplayName = (path) =>
    path?.title ||
    deriveCareerPathTitle(path, lang, t('savedLists.savedCareerPaths.unnamed'));

  const getPathPreviewTitles = (path) => {
    const nodes = Array.isArray(path?.nodes) ? path.nodes : [];
    return nodes
      .slice(-3)
      .map(
        (node) =>
          localizedPuzzleText(node?.snapshot?.title, lang) ||
          localizedPuzzleText(node?.piece?.title, lang)
      )
      .filter(Boolean);
  };

  const handleOpenPath = (pathId) => {
    if (!pathId) {
      setSnackbar({
        open: true,
        message: t('savedLists.savedCareerPaths.errors.invalidPathId'),
        severity: 'error',
      });
      return;
    }
    navigate(`/saved-paths/${pathId}`);
  };

  const handleRequestUnsave = (pathId) => {
    if (!pathId) {
      setSnackbar({
        open: true,
        message: t('savedLists.savedCareerPaths.errors.invalidPathId'),
        severity: 'error',
      });
      return;
    }
    setPathToUnsave(pathId);
    setUnsaveDialogOpen(true);
  };

  const handleConfirmUnsave = async () => {
    if (!pathToUnsave) return;
    try {
      await updateMutation.mutateAsync({ pathId: pathToUnsave, isFavorite: false });
      setSnackbar({
        open: true,
        message: t('savedLists.savedCareerPaths.messages.unsaved'),
        severity: 'success',
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message: err?.message || t('savedLists.savedCareerPaths.errors.unsaveFailed'),
        severity: 'error',
      });
    } finally {
      setUnsaveDialogOpen(false);
      setPathToUnsave(null);
    }
  };

  const handleCancelUnsave = () => {
    setUnsaveDialogOpen(false);
    setPathToUnsave(null);
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <PageHeader
        title={t('saved.careerPaths')}
        description={t('savedLists.savedCareerPaths.subtitle')}
      />
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error?.message || t('savedLists.savedCareerPaths.errors.fetchFailed')}
        </Alert>
      ) : savedPaths.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <StarBorderIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            {t('savedLists.savedCareerPaths.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('savedLists.savedCareerPaths.emptySubtitle')}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="medium"
            startIcon={<PuzzlePieceIcon />}
            href="/puzzle-path"
            sx={{
              fontWeight: 600,
              px: 3,
              py: 1.5,
              fontSize: '1rem',
            }}
          >
            {t('savedLists.savedCareerPaths.goToPuzzleCta')}
          </Button>
        </Box>
      ) : (
        <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} sx={{ alignItems: 'stretch', mb: 2 }}>
          {savedPaths.map((path, cardIndex) => {
            const displayName = getPathDisplayName(path);
            const previewTitles = getPathPreviewTitles(path);
            const openLabel = t('savedLists.savedCareerPaths.aria.openPath', {
              name: displayName,
            });
            const unsaveLabel = t('savedLists.savedCareerPaths.aria.unsavePath', {
              name: displayName,
            });
            const savedCaption = path.updatedAt || path.createdAt
              ? `${t('details.labels.saved')} ${t('savedLists.common.onDate', {
                  date: formatPathCardDate(path.updatedAt || path.createdAt),
                })}`
              : t('savedLists.savedCareerPaths.noTimestamp');

            return (
              <Grid
                item
                xs={12}
                sm={6}
                md={4}
                key={path.pathId || `saved-path-${cardIndex}`}
                sx={{
                  mb: { xs: 1, sm: 2, md: 2 },
                  px: { xs: 1, sm: 1.5, md: 2 },
                }}
              >
                <Card
                  sx={{
                    borderLeft: `6px solid ${SAVED_PATH_BORDER}`,
                    height: '100%',
                    minHeight: '200px',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    borderRight: 1,
                    borderTop: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                    margin: 0,
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-card-sm)',
                  }}
                >
                  <CardContent
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%',
                      flexGrow: 1,
                      p: 2,
                      justifyContent: 'space-between',
                    }}
                  >
                    <Typography
                      variant="h6"
                      color="text.primary"
                      sx={{
                        fontWeight: 600,
                        mb: 1,
                        minHeight: '2.5em',
                        display: 'flex',
                        alignItems: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {displayName}
                    </Typography>

                    <Box
                      sx={{
                        mb: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.75,
                        minHeight: '5.6em',
                      }}
                    >
                      {[0, 1, 2].map((idx) => {
                        const titleLine = previewTitles[idx];
                        return (
                          <Typography
                            key={`path-preview-${idx}`}
                            variant="body2"
                            color="text.primary"
                            sx={{
                              lineHeight: '1.4em',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              minHeight: '1.4em',
                            }}
                          >
                            {titleLine || '\u00a0'}
                          </Typography>
                        );
                      })}
                    </Box>

                    <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
                      {savedCaption}
                    </Typography>

                    <Box
                      sx={{
                        pt: 1,
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 1,
                        width: '100%',
                        alignItems: 'stretch',
                        mt: 'auto',
                      }}
                    >
                      <Tooltip title={openLabel} arrow>
                        <span>
                          <Button
                            aria-label={openLabel}
                            variant="contained"
                            color="primary"
                            size="small"
                            startIcon={<PuzzlePieceIcon sx={{ fontSize: '1rem' }} />}
                            onClick={() => handleOpenPath(path.pathId)}
                            disabled={!path.pathId || updateMutation.isLoading}
                            sx={CARD_ACTION_BTN_SX}
                          >
                            {t('savedLists.savedCareerPaths.actions.more')}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={unsaveLabel} arrow>
                        <span>
                          <Button
                            aria-label={unsaveLabel}
                            variant="outlined"
                            color="error"
                            size="small"
                            startIcon={<DeleteIcon sx={{ fontSize: '1rem' }} />}
                            onClick={() => handleRequestUnsave(path.pathId)}
                            disabled={!path.pathId || updateMutation.isLoading}
                            sx={CARD_ACTION_BTN_SX}
                          >
                            {t('savedLists.savedCareerPaths.actions.remove')}
                          </Button>
                        </span>
                      </Tooltip>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog
        open={unsaveDialogOpen}
        onClose={handleCancelUnsave}
        aria-labelledby="unsave-career-path-dialog-title"
        aria-describedby="unsave-career-path-dialog-description"
      >
        <DialogTitle id="unsave-career-path-dialog-title">
          {t('savedLists.savedCareerPaths.unsaveDialog.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="unsave-career-path-dialog-description">
            {t('savedLists.savedCareerPaths.unsaveDialog.message')}
          </DialogContentText>
          {pathPendingUnsave ? (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                <strong>{t('savedLists.savedCareerPaths.unsaveDialog.nameLabel')}</strong>{' '}
                {getPathDisplayName(pathPendingUnsave)}
              </Typography>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelUnsave} variant="outlined" color="primary" autoFocus>
            {t('profilePage.actions.cancel', { ns: 'onboarding' })}
          </Button>
          <Button onClick={handleConfirmUnsave} variant="contained" color="error">
            {t('savedLists.savedCareerPaths.unsaveDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SavedCareerPaths;
