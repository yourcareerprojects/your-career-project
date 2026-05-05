import React, { useState, useMemo } from 'react';
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
import { useAuth } from '../../contexts/AuthContext';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../../constants/profileCompletion';
import { hasActiveCareerSimulationSession } from '../../utils/simulationPersistence';
import {
  useSavedSimulationsListQuery,
  invalidateSavedSimulationsListQuery,
  useProfileCompletionQuery,
  useLastSimulationQuery,
} from '../../hooks/useProfileQueries';
import { getRoleTitleForLocale } from '../../utils/roleTitleDisplay';

/** Match saved career step card primary actions (full width in grid cells). */
const SIMULATION_CARD_ACTION_BTN_SX = { width: '100%' };

const SAVED_SIMULATION_BORDER = 'var(--color-primary)';

const SavedSimulations = () => {
  const { t, i18n } = useTranslation(['dashboard', 'onboarding']);
  const { user } = useAuth();
  const profileCompletionQuery = useProfileCompletionQuery({ enabled: !!user });
  const completion = profileCompletionQuery.data?.completion;
  const meetsSimulationProfileMin =
    !!completion && Number(completion.overall || 0) >= MIN_PROFILE_COMPLETION_REQUIRED;
  const hasSimulationSession = hasActiveCareerSimulationSession();
  const lastSimulationQuery = useLastSimulationQuery({
    enabled: !!user && meetsSimulationProfileMin && !hasSimulationSession,
  });
  const goToSimulationHref = useMemo(() => {
    if (hasSimulationSession) return '/simulation/results';
    if (!meetsSimulationProfileMin) return '/simulation';
    if (lastSimulationQuery.isError || lastSimulationQuery.data == null) return '/simulation';
    return lastSimulationQuery.data?.results ? '/simulation/results' : '/simulation';
  }, [
    hasSimulationSession,
    meetsSimulationProfileMin,
    lastSimulationQuery.data,
    lastSimulationQuery.isError,
  ]);
  const { data: savedSimulations = [], isLoading, isError, error } = useSavedSimulationsListQuery();
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [simulationToDelete, setSimulationToDelete] = useState(null);
  const navigate = useNavigate();

  const handleDeleteSimulation = (simulationId) => {
    if (!simulationId) {
      setSnackbar({ open: true, message: t('savedLists.savedSimulations.errors.invalidSimulationId', { ns: 'dashboard' }), severity: 'error' });
      return;
    }
    setSimulationToDelete(simulationId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDeleteSimulation = async () => {
    if (!simulationToDelete) return;
    
    try {
      const res = await fetch(`/api/profile/simulation/saved/${simulationToDelete}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (res.ok) {
        invalidateSavedSimulationsListQuery();
        setSnackbar({ open: true, message: t('simulation.messages.deletedSuccessfully', { ns: 'dashboard' }), severity: 'success' });
      } else {
        setSnackbar({ open: true, message: t('simulation.messages.deleteFailed', { ns: 'dashboard' }), severity: 'error' });
      }
    } catch (err) {
      setSnackbar({ open: true, message: t('simulation.messages.deleteFailed', { ns: 'dashboard' }), severity: 'error' });
    } finally {
      setDeleteDialogOpen(false);
      setSimulationToDelete(null);
    }
  };

  const handleCancelDeleteSimulation = () => {
    setDeleteDialogOpen(false);
    setSimulationToDelete(null);
  };

  const handleLoadSimulation = (simulationId) => {
    if (!simulationId) {
      setSnackbar({ open: true, message: t('savedLists.savedSimulations.errors.invalidSimulationId', { ns: 'dashboard' }), severity: 'error' });
      return;
    }
    navigate(`/simulation/${simulationId}`);
  };

  const formatSimulationCardDate = (dateString) => {
    if (dateString == null || dateString === '') return '—';
    const d = dateString instanceof Date ? dateString : new Date(dateString);
    if (Number.isNaN(d.getTime())) {
      return t('savedLists.savedSimulations.invalidDate', { ns: 'dashboard' });
    }
    const loc = String(i18n.resolvedLanguage || i18n.language || 'en').replace(/_/g, '-');
    return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const simulationRowId = (sim) => sim?.id || sim?._id;

  const getTopNextRoleTitles = (simulation) => {
    const nextRoles = Array.isArray(simulation?.results?.nextSteps) ? simulation.results.nextSteps : [];
    return nextRoles
      .map((role) => getRoleTitleForLocale(role?.title, i18n.language))
      .filter(Boolean)
      .slice(0, 3);
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700, textAlign: 'center' }}>
        {t('saved.simulations', { ns: 'dashboard' })}
      </Typography>
      <Typography variant="body1" sx={{ mb: 4, textAlign: 'center' }}>
        {t('savedLists.savedSimulations.subtitle', { ns: 'dashboard' })}
      </Typography>
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error?.message || t('savedLists.savedSimulations.errors.fetchFailed', { ns: 'dashboard' })}
        </Alert>
      ) : savedSimulations.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <StarBorderIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            {t('savedLists.savedSimulations.emptyTitle', { ns: 'dashboard' })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('savedLists.savedSimulations.emptySubtitle', { ns: 'dashboard' })}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="medium"
            startIcon={<PuzzlePieceIcon />}
            href={goToSimulationHref}
            sx={{
              fontWeight: 600,
              px: 3,
              py: 1.5,
              fontSize: '1rem',
            }}
          >
            {t('profilePagePrompts.goToSimulationCta', { ns: 'onboarding' })}
          </Button>
        </Box>
      ) : (
        <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} sx={{ alignItems: 'stretch', mb: 2 }}>
          {savedSimulations.map((simulation, cardIndex) => {
            const rowId = simulationRowId(simulation);
            const displayName = simulation.name || t('savedLists.savedSimulations.unnamed', { ns: 'dashboard' });
            const topRoles = getTopNextRoleTitles(simulation);
            const openLabel = t('savedLists.savedSimulations.aria.loadSimulation', {
              ns: 'dashboard',
              name: displayName,
            });
            const deleteLabel = t('savedLists.savedSimulations.aria.deleteSimulation', {
              ns: 'dashboard',
              name: displayName,
            });
            const savedCaption = simulation.timestamp
              ? `${t('details.labels.saved', { ns: 'dashboard' })} ${t('savedLists.savedCareerSteps.onDate', {
                  ns: 'dashboard',
                  date: formatSimulationCardDate(simulation.timestamp),
                })}`
              : t('savedLists.savedSimulations.noTimestamp', { ns: 'dashboard' });

            return (
              <Grid
                item
                xs={12}
                sm={6}
                md={4}
                key={rowId || `saved-sim-${cardIndex}`}
                sx={{
                  mb: { xs: 1, sm: 2, md: 2 },
                  px: { xs: 1, sm: 1.5, md: 2 },
                }}
              >
                <Card
                  className="saved-simulation-card"
                  sx={{
                    borderLeft: `6px solid ${SAVED_SIMULATION_BORDER}`,
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
                        const titleLine = topRoles[idx];
                        return (
                          <Typography
                            key={`top-role-${idx}`}
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
                      className="saved-simulation-actions"
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
                            onClick={() => handleLoadSimulation(rowId)}
                            disabled={!rowId}
                            sx={SIMULATION_CARD_ACTION_BTN_SX}
                          >
                            {t('savedLists.savedSimulations.actions.more', { ns: 'dashboard' })}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={deleteLabel} arrow>
                        <span>
                          <Button
                            aria-label={deleteLabel}
                            variant="outlined"
                            color="error"
                            size="small"
                            startIcon={<DeleteIcon sx={{ fontSize: '1rem' }} />}
                            onClick={() => handleDeleteSimulation(rowId)}
                            disabled={!rowId}
                            sx={SIMULATION_CARD_ACTION_BTN_SX}
                          >
                            {t('savedLists.savedSimulations.actions.delete', { ns: 'dashboard' })}
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
      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleCancelDeleteSimulation}
        aria-labelledby="delete-simulation-dialog-title"
        aria-describedby="delete-simulation-dialog-description"
      >
        <DialogTitle id="delete-simulation-dialog-title">
          {t('simulation.deleteDialog.title', { ns: 'dashboard' })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-simulation-dialog-description">
            {t('simulation.deleteDialog.confirmation', { ns: 'dashboard' })}
          </DialogContentText>
          {simulationToDelete && savedSimulations.find((sim) => simulationRowId(sim) === simulationToDelete) && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('simulation.deleteDialog.detailsTitle', { ns: 'dashboard' })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>{t('simulation.deleteDialog.nameLabel', { ns: 'dashboard' })}</strong>{' '}
                {savedSimulations.find((sim) => simulationRowId(sim) === simulationToDelete)?.name ||
                  t('simulation.deleteDialog.notSpecified', { ns: 'dashboard' })}
              </Typography>
            </Box>
          )}
          <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 'bold' }}>
            {t('simulation.deleteDialog.warning', { ns: 'dashboard' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={handleCancelDeleteSimulation}
            variant="outlined"
            color="primary"
            autoFocus
          >
            {t('profilePage.actions.cancel', { ns: 'onboarding' })}
          </Button>
          <Button 
            onClick={handleConfirmDeleteSimulation}
            variant="contained"
            color="error"
          >
            {t('profilePage.photo.editor.delete', { ns: 'onboarding' })}
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

export default SavedSimulations;
