import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import PuzzleCanvas from './PuzzleCanvas';
import NextStepSelector, { NextStepDragPreview } from './NextStepSelector';
import PathManager from './PathManager';
import PuzzlePieceEditDialog from './PuzzlePieceEditDialog';
import PuzzlePieceDetailDialog, {
  pieceFallbackFromPathNode,
} from './PuzzlePieceDetailDialog';
import { PUZZLE_TIP_DROPPABLE_ID, PUZZLE_REMOVE_DROPPABLE_ID } from './puzzleDnD';
import {
  useCareerPuzzleQuery,
  usePuzzleNextStepsQuery,
  useAppendPuzzlePieceMutation,
  useUndoPuzzleTipMutation,
  useSavePuzzlePathAndResetMutation,
  useUpdatePuzzlePathNodeMutation,
  useAppendLockedPuzzleNodeMutation,
  useDeleteLockedPuzzleNodeMutation,
  deriveCareerPathTitle,
} from '../../hooks/useCareerPuzzleQueries';
import { baseUILanguage } from '../../hooks/useProfileQueries';
import useConfirmationDialog from '../../hooks/useConfirmationDialog';
import ConfirmationDialog from '../common/ConfirmationDialog';

/**
 * Career Puzzle workspace: spine + next-step choices.
 * @param {{ pathId?: string|null, mode?: 'draft'|'saved' }} props
 */
export default function CareerPuzzle({ pathId: pathIdProp = null, mode = 'draft' } = {}) {
  const { t } = useTranslation(['dashboard', 'onboarding']);
  const isSavedMode = mode === 'saved';
  const [selectorOpen, setSelectorOpen] = useState(true);
  const [editingNode, setEditingNode] = useState(null);
  const [creatingLocked, setCreatingLocked] = useState(false);
  const [detailNode, setDetailNode] = useState(null);
  const [activeDragPiece, setActiveDragPiece] = useState(null);
  const [activeDragType, setActiveDragType] = useState(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [pathName, setPathName] = useState('');
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success',
    linkTo: null,
    linkLabel: null,
  });
  const { dialogState, openDialog, handleConfirm, handleCancel } =
    useConfirmationDialog();

  const puzzleQuery = useCareerPuzzleQuery();
  const puzzle = puzzleQuery.data;
  const workingPath = useMemo(() => {
    if (!puzzle) return null;
    if (pathIdProp) {
      return (puzzle.paths || []).find((p) => p.pathId === pathIdProp) || null;
    }
    return puzzle.activePath || null;
  }, [puzzle, pathIdProp]);
  const pathId = workingPath?.pathId || null;

  const nextStepsQuery = usePuzzleNextStepsQuery(pathId, {
    enabled: Boolean(pathId),
  });

  const appendMutation = useAppendPuzzlePieceMutation();
  const undoMutation = useUndoPuzzleTipMutation();
  const saveMutation = useSavePuzzlePathAndResetMutation();
  const updateNodeMutation = useUpdatePuzzlePathNodeMutation();
  const appendLockedMutation = useAppendLockedPuzzleNodeMutation();
  const deleteLockedMutation = useDeleteLockedPuzzleNodeMutation();

  const editingNodeLive = useMemo(() => {
    if (!editingNode?.instanceId) return null;
    return (
      (workingPath?.nodes || []).find((n) => n.instanceId === editingNode.instanceId) ||
      editingNode
    );
  }, [editingNode, workingPath?.nodes]);

  const nodes = workingPath?.nodes || [];
  const lockedStepCount =
    workingPath?.lockedStepCount ?? nodes.filter((n) => n.locked).length;
  const maxLockedSteps = workingPath?.maxLockedSteps || 5;
  const canAddLockedStep =
    !Boolean(workingPath?.atLockedStepLimit) && lockedStepCount < maxLockedSteps;
  const canDeleteLockedStep =
    Boolean(workingPath?.canDeleteLockedStep) ||
    lockedStepCount > (workingPath?.minLockedSteps || 2);
  const nextSteps = nextStepsQuery.data?.steps || [];
  const tipNode = useMemo(() => {
    if (!nodes.length) return null;
    if (workingPath?.tipInstanceId) {
      return nodes.find((n) => n.instanceId === workingPath.tipInstanceId) || nodes[nodes.length - 1];
    }
    return nodes[nodes.length - 1];
  }, [nodes, workingPath?.tipInstanceId]);
  // Stage for next-step chips: tip display category (e.g. edited Realschule),
  // with education-like fallback only for narrative exp.none tips.
  const tipCategory = useMemo(() => {
    const tipCat =
      tipNode?.snapshot?.category || tipNode?.piece?.category || '';
    const tipKey = String(tipNode?.pieceKey || '');
    if (!(tipKey === 'exp.none' && tipCat === 'occupation')) {
      return tipCat || nextStepsQuery.data?.stageCategory || '';
    }
    const tipIdx = nodes.findIndex((n) => n.instanceId === tipNode?.instanceId);
    for (let i = tipIdx - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      if (!node?.locked) continue;
      const cat = node.snapshot?.category || node.piece?.category || '';
      if (cat && cat !== 'occupation') return cat;
    }
    const educationNode = nodes.find(
      (n) => n.locked && String(n.pieceKey || '').startsWith('edu.')
    );
    const eduCat =
      educationNode?.snapshot?.category || educationNode?.piece?.category || '';
    return (
      eduCat ||
      tipCat ||
      nextStepsQuery.data?.stageCategory ||
      ''
    );
  }, [nodes, tipNode, nextStepsQuery.data?.stageCategory]);
  const atStepLimit =
    Boolean(workingPath?.atStepLimit) ||
    Boolean(nextStepsQuery.data?.atStepLimit) ||
    nodes.filter((n) => !n.locked).length >= 3;
  const showTipSlot =
    !atStepLimit &&
    (nextStepsQuery.isLoading ||
      nextStepsQuery.isFetching ||
      nextSteps.length > 0);
  const canUndo = useMemo(
    () => nodes.some((n) => !n.locked),
    [nodes]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const pieceDialogSaving =
    updateNodeMutation.isLoading ||
    appendLockedMutation.isLoading ||
    deleteLockedMutation.isLoading;

  const errorMessage =
    puzzleQuery.error?.message ||
    appendMutation.error?.message ||
    undoMutation.error?.message ||
    updateNodeMutation.error?.message ||
    appendLockedMutation.error?.message ||
    deleteLockedMutation.error?.message ||
    (!isSavedMode ? saveMutation.error?.message : null);

  const handleSelect = async (piece) => {
    if (!piece?.id || !pathId || appendMutation.isLoading || atStepLimit) return;
    await appendMutation.mutateAsync({ pieceId: piece.id, pathId });
    setSelectorOpen(true);
  };

  const getDefaultPathName = () =>
    String(workingPath?.title || '').trim() ||
    deriveCareerPathTitle(
      workingPath,
      baseUILanguage(),
      t('savedLists.savedCareerPaths.unnamed')
    );

  const handleOpenSaveDialog = () => {
    setPathName(getDefaultPathName());
    setSaveDialogOpen(true);
  };

  const handleCloseSaveDialog = () => {
    if (saveMutation.isLoading) return;
    setSaveDialogOpen(false);
  };

  const handleConfirmSave = async () => {
    const trimmed = pathName.trim();
    if (!trimmed || !pathId || saveMutation.isLoading) return;
    try {
      await saveMutation.mutateAsync({
        pathId,
        title: trimmed,
      });
      setSaveDialogOpen(false);
      setSnackbar({
        open: true,
        message: t('careerPuzzle.messages.savedSuccessfully'),
        severity: 'success',
        linkTo: '/saved-paths',
        linkLabel: t('careerPuzzle.messages.openSavedPaths'),
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message: err?.message || t('careerPuzzle.messages.saveFailed'),
        severity: 'error',
        linkTo: null,
        linkLabel: null,
      });
    }
  };

  const handleCloseEditDialog = () => {
    if (pieceDialogSaving) return;
    setEditingNode(null);
    setCreatingLocked(false);
  };

  const handleOpenCreateLocked = () => {
    if (!canAddLockedStep || pieceDialogSaving) return;
    setEditingNode(null);
    setCreatingLocked(true);
  };

  const handleRequestDeleteLockedPiece = () => {
    if (
      !pathId ||
      !editingNodeLive?.instanceId ||
      creatingLocked ||
      !canDeleteLockedStep ||
      deleteLockedMutation.isLoading
    ) {
      return;
    }
    openDialog({
      title: t('careerPuzzle.editDialog.deleteDialog.title'),
      message: t('careerPuzzle.editDialog.deleteDialog.message'),
      confirmText: t('careerPuzzle.editDialog.deleteDialog.confirm'),
      cancelText: t('profilePage.actions.cancel', { ns: 'onboarding' }),
      severity: 'error',
      onConfirm: handleDeleteLockedPiece,
    });
  };

  const handleDeleteLockedPiece = async () => {
    if (
      !pathId ||
      !editingNodeLive?.instanceId ||
      creatingLocked ||
      !canDeleteLockedStep ||
      deleteLockedMutation.isLoading
    ) {
      return;
    }
    try {
      await deleteLockedMutation.mutateAsync({
        pathId,
        instanceId: editingNodeLive.instanceId,
      });
      setEditingNode(null);
      setSnackbar({
        open: true,
        message: t('careerPuzzle.messages.pieceDeleted'),
        severity: 'success',
        linkTo: null,
        linkLabel: null,
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message: err?.message || t('careerPuzzle.messages.pieceDeleteFailed'),
        severity: 'error',
        linkTo: null,
        linkLabel: null,
      });
      throw err;
    }
  };

  const handleRemoveNodeFromPath = async (node) => {
    if (
      !pathId ||
      !node?.instanceId ||
      node.locked ||
      deleteLockedMutation.isLoading
    ) {
      return;
    }
    try {
      await deleteLockedMutation.mutateAsync({
        pathId,
        instanceId: node.instanceId,
      });
      if (detailNode?.instanceId === node.instanceId) {
        setDetailNode(null);
      }
      setSnackbar({
        open: true,
        message: t('careerPuzzle.messages.stepRemoved'),
        severity: 'success',
        linkTo: null,
        linkLabel: null,
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message: err?.message || t('careerPuzzle.messages.stepRemoveFailed'),
        severity: 'error',
        linkTo: null,
        linkLabel: null,
      });
    }
  };

  const handleSavePieceEdit = async (payload) => {
    if (!pathId || pieceDialogSaving) return;
    try {
      if (creatingLocked) {
        await appendLockedMutation.mutateAsync({
          pathId,
          category: payload.category,
          title: payload.title,
          shortDescription: payload.shortDescription,
          endDate: payload.endDate,
        });
        setCreatingLocked(false);
        setSnackbar({
          open: true,
          message: t('careerPuzzle.messages.pieceCreated'),
          severity: 'success',
          linkTo: null,
          linkLabel: null,
        });
        return;
      }

      if (!editingNodeLive?.instanceId) return;
      await updateNodeMutation.mutateAsync({
        pathId,
        instanceId: editingNodeLive.instanceId,
        category: payload.category,
        title: payload.title,
        shortDescription: payload.shortDescription,
        endDate: payload.endDate,
      });
      setEditingNode(null);
      setSnackbar({
        open: true,
        message: t('careerPuzzle.messages.pieceUpdated'),
        severity: 'success',
        linkTo: null,
        linkLabel: null,
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message:
          err?.message ||
          (creatingLocked
            ? t('careerPuzzle.messages.pieceCreateFailed')
            : t('careerPuzzle.messages.pieceUpdateFailed')),
        severity: 'error',
        linkTo: null,
        linkLabel: null,
      });
    }
  };

  const handleDragStart = (event) => {
    const { piece, type } = event.active.data.current || {};
    if (piece) setActiveDragPiece(piece);
    if (type) setActiveDragType(type);
  };

  const handleDragEnd = (event) => {
    const { piece, type } = event.active.data.current || {};
    const overId = event.over?.id;
    setActiveDragPiece(null);
    setActiveDragType(null);

    if (type === 'next-step' && piece && overId === PUZZLE_TIP_DROPPABLE_ID) {
      handleSelect(piece);
      return;
    }

    if (
      type === 'path-tip' &&
      overId === PUZZLE_REMOVE_DROPPABLE_ID &&
      canUndo &&
      !undoMutation.isLoading
    ) {
      undoMutation.mutate({ pathId });
    }
  };

  const handleDragCancel = () => {
    setActiveDragPiece(null);
    setActiveDragType(null);
  };

  if (puzzleQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (puzzleQuery.isError && !puzzle) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {puzzleQuery.error?.message || t('careerPuzzle.loadError')}
      </Alert>
    );
  }

  if (!workingPath) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        {t('savedLists.savedCareerPaths.errors.pathNotFound')}
      </Alert>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: { xs: 3, md: 4 },
          alignItems: 'flex-start',
        }}
      >
        <Box sx={{ flex: 1, width: '100%' }}>
          {canAddLockedStep ? (
            <Box sx={{ width: '100%', maxWidth: 440, mx: 'auto', mb: 1.5 }}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={handleOpenCreateLocked}
                disabled={pieceDialogSaving}
              >
                {t('careerPuzzle.addProfileStep')}
              </Button>
            </Box>
          ) : null}
          <PuzzleCanvas
            nodes={nodes}
            onTipSlotClick={() => setSelectorOpen(true)}
            onPieceEditClick={(node) => {
              setCreatingLocked(false);
              setEditingNode(node);
            }}
            onPieceMoreClick={(node) => {
              setDetailNode(node);
            }}
            onPieceRemoveClick={handleRemoveNodeFromPath}
            removingInstanceId={
              deleteLockedMutation.isLoading
                ? deleteLockedMutation.variables?.instanceId || null
                : null
            }
            tipDropEnabled={
              showTipSlot &&
              !appendMutation.isLoading &&
              activeDragType !== 'path-tip'
            }
            removeDragDisabled={
              undoMutation.isLoading ||
              appendMutation.isLoading ||
              deleteLockedMutation.isLoading
            }
            showTipSlot={showTipSlot}
          />
          <Box sx={{ mt: 2 }}>
            <PathManager
              canUndo={canUndo}
              canSave={canUndo}
              isFavorite={Boolean(workingPath?.isFavorite)}
              undoPending={undoMutation.isLoading}
              savePending={saveMutation.isLoading}
              showSave={!isSavedMode}
              onUndo={() => undoMutation.mutate({ pathId })}
              onSaveClick={handleOpenSaveDialog}
            />
          </Box>
        </Box>

        <Box
          sx={{
            flex: 1,
            width: '100%',
            maxWidth: { md: 420 },
            position: { md: 'sticky' },
            top: { md: 88 },
            display: selectorOpen ? 'block' : 'none',
          }}
        >
          {errorMessage ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {errorMessage}
            </Alert>
          ) : null}
          <NextStepSelector
            steps={atStepLimit ? [] : nextSteps}
            tipCategory={tipCategory}
            loading={!atStepLimit && nextStepsQuery.isLoading}
            selecting={appendMutation.isLoading}
            removeDropEnabled={activeDragType === 'path-tip' && canUndo}
            atStepLimit={atStepLimit}
            maxUserSteps={workingPath?.maxUserSteps || 3}
            onSelect={handleSelect}
          />
        </Box>

        <PuzzlePieceEditDialog
          open={Boolean(editingNodeLive) || creatingLocked}
          node={creatingLocked ? null : editingNodeLive}
          mode={creatingLocked ? 'create' : 'edit'}
          saving={
            updateNodeMutation.isLoading || appendLockedMutation.isLoading
          }
          deleting={deleteLockedMutation.isLoading}
          canDelete={
            !creatingLocked &&
            Boolean(editingNodeLive?.locked) &&
            canDeleteLockedStep
          }
          onClose={handleCloseEditDialog}
          onSave={handleSavePieceEdit}
          onDelete={handleRequestDeleteLockedPiece}
        />

        <PuzzlePieceDetailDialog
          pieceId={
            detailNode?.piece?.id ||
            (detailNode?.pieceId != null ? String(detailNode.pieceId) : null)
          }
          pieceFallback={pieceFallbackFromPathNode(detailNode)}
          open={Boolean(detailNode)}
          onClose={() => setDetailNode(null)}
          showAdd={false}
        />
      </Box>

      <ConfirmationDialog
        open={dialogState.open}
        onClose={handleCancel}
        onConfirm={handleConfirm}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        severity={dialogState.severity}
        loading={dialogState.loading || deleteLockedMutation.isLoading}
      />

      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
        {activeDragPiece ? <NextStepDragPreview piece={activeDragPiece} /> : null}
      </DragOverlay>

      {!isSavedMode ? (
        <Dialog open={saveDialogOpen} onClose={handleCloseSaveDialog} fullWidth maxWidth="sm">
          <DialogTitle>{t('careerPuzzle.saveDialog.title')}</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              {t('careerPuzzle.saveDialog.hint')}
            </DialogContentText>
            <TextField
              autoFocus
              margin="dense"
              label={t('careerPuzzle.saveDialog.nameLabel')}
              fullWidth
              variant="outlined"
              value={pathName}
              onChange={(e) => setPathName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirmSave();
                }
              }}
              disabled={saveMutation.isLoading}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseSaveDialog} disabled={saveMutation.isLoading}>
              {t('profilePage.actions.cancel', { ns: 'onboarding' })}
            </Button>
            <Button
              onClick={handleConfirmSave}
              variant="contained"
              color="primary"
              disabled={!pathName.trim() || saveMutation.isLoading}
            >
              {saveMutation.isLoading ? (
                <CircularProgress size={20} />
              ) : (
                t('profilePage.actions.save', { ns: 'onboarding' })
              )}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          action={
            snackbar.linkTo ? (
              <Button
                color="inherit"
                size="small"
                component={RouterLink}
                to={snackbar.linkTo}
              >
                {snackbar.linkLabel}
              </Button>
            ) : null
          }
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </DndContext>
  );
}
