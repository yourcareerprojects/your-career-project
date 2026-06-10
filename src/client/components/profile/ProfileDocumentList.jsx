import React, { useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { documentTypeDisplaySlug } from '../../../constants/documentTypes';
import {
  buildPollSnapshot,
  isActiveCvExtractionDocument,
  resolveExtractionProgressMessageKey,
} from '../../utils/cvExtractionPoll';

function normalizeDocuments(docs) {
  return (docs || []).map((doc) => ({
    ...doc,
    id: doc.id || doc._id,
  }));
}

function documentTypeChipLabel(doc, t) {
  const slug = doc.documentTypeDisplay || documentTypeDisplaySlug(doc.documentType || doc.type);
  if (slug) {
    const key = `documentUpload.uploadDialog.documentTypes.${slug}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return doc.documentType || doc.type || '';
}

function isCvDocument(doc) {
  const type = doc?.type || doc?.documentType;
  return type === 'cv' || type === 'resume';
}

function canOpenCvReview(doc) {
  if (!isCvDocument(doc)) return false;
  return isActiveCvExtractionDocument(doc) || Boolean(doc.reviewReady) || Boolean(doc.extractedProfileData);
}

function documentToPollSnapshot(doc) {
  return buildPollSnapshot(
    {
      status: doc.extractionStatus,
      stage: doc.displayStage ?? null,
      displayStage: doc.displayStage ?? null,
      phase: doc.phase ?? null,
      blockingTask: doc.blockingTask ?? null,
      isBackgroundEnriching: Boolean(doc.isBackgroundEnriching),
      reviewReady: Boolean(doc.reviewReady),
    },
    0
  );
}

const wrappingChipSx = {
  maxWidth: '100%',
  height: 'auto',
  '& .MuiChip-label': {
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    py: 0.25,
  },
};

function staticExtractionStatusLabel(doc, t) {
  if (!isCvDocument(doc) || !isActiveCvExtractionDocument(doc)) return null;
  const snapshot = documentToPollSnapshot(doc);
  const messageKey = resolveExtractionProgressMessageKey(snapshot);
  if (!messageKey) return t('documentUpload.async.stillProcessing');
  const translated = t(messageKey);
  return translated !== messageKey ? translated : t('documentUpload.async.stillProcessing');
}

const ProfileDocumentList = ({
  documents = [],
  onDocumentsUpdate,
  disabled = false,
  onOpenReview,
}) => {
  const { t } = useTranslation('onboarding');
  const [actionError, setActionError] = useState('');
  const [editingDocId, setEditingDocId] = useState(null);
  const [editingDescription, setEditingDescription] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState(null);

  const normalizedDocuments = normalizeDocuments(documents);

  const handleDelete = async (documentId) => {
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (!response.ok) {
        throw new Error('Delete failed');
      }
      onDocumentsUpdate(normalizeDocuments(normalizedDocuments.filter((doc) => doc.id !== documentId)));
      setActionError('');
    } catch (error) {
      setActionError(t('documentUpload.errors.deleteFailed'));
      console.error('Delete error:', error);
    }
  };

  const handleDownload = async (documentId, originalName) => {
    try {
      const response = await axios.get(`/api/documents/${documentId}/download`, {
        responseType: 'blob',
      });
      const contentType = response.headers['content-type'] || 'application/octet-stream';
      const url = window.URL.createObjectURL(new Blob([response.data], { type: contentType }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', originalName || 'document');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setActionError('');
    } catch (err) {
      setActionError(err.response?.data?.message || t('documentUpload.errors.downloadFailed'));
    }
  };

  const handleRename = async (documentId) => {
    setRenameLoading(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/rename`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ description: editingDescription }),
      });
      if (!response.ok) {
        throw new Error('Rename failed');
      }
      const data = await response.json();
      onDocumentsUpdate(
        normalizeDocuments(
          normalizedDocuments.map((doc) =>
            doc.id === documentId ? { ...doc, description: data.document.description } : doc
          )
        )
      );
      setEditingDocId(null);
      setEditingDescription('');
      setActionError('');
    } catch (error) {
      setActionError(t('documentUpload.errors.renameFailed'));
      console.error('Rename error:', error);
    } finally {
      setRenameLoading(false);
    }
  };

  if (normalizedDocuments.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('profilePage.documents.empty')}
      </Typography>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}

      <List disablePadding>
        {normalizedDocuments.map((doc) => {
          const processingLabel = staticExtractionStatusLabel(doc, t);
          const showReview = canOpenCvReview(doc);

          const reviewLabel = isActiveCvExtractionDocument(doc)
            ? t('profilePage.documents.continueExtractionCta')
            : t('profilePage.documents.reviewCta');

          return (
            <ListItem
              key={doc.id}
              sx={{
                mb: 1,
                bgcolor: 'background.paper',
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'stretch', md: 'center' },
                gap: { xs: 1.5, md: 2 },
                px: { xs: 1.5, sm: 2 },
                py: { xs: 1.5, sm: 2 },
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: { xs: 1.5, sm: 2 },
                  minWidth: 0,
                  width: '100%',
                  flex: 1,
                }}
              >
                <DescriptionIcon
                  sx={{ color: 'primary.main', flexShrink: 0, mt: 0.25, fontSize: { xs: 28, sm: 32 } }}
                />
                <ListItemText
                  sx={{ minWidth: 0, m: 0, flex: 1 }}
                  secondaryTypographyProps={{ component: 'div' }}
                  primary={
                    editingDocId === doc.id ? (
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: { xs: 'column', sm: 'row' },
                          alignItems: { xs: 'stretch', sm: 'center' },
                          gap: 1,
                          width: '100%',
                        }}
                      >
                        <TextField
                          value={editingDescription}
                          onChange={(e) => setEditingDescription(e.target.value)}
                          size="small"
                          autoFocus
                          disabled={renameLoading || disabled}
                          sx={{ minWidth: 0, flex: 1, width: '100%' }}
                        />
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <Button
                            onClick={() => handleRename(doc.id)}
                            disabled={renameLoading || disabled || !editingDescription.trim()}
                            size="small"
                            variant="contained"
                          >
                            {t('documentUpload.documents.rename.saveCta')}
                          </Button>
                          <Button
                            onClick={() => {
                              setEditingDocId(null);
                              setEditingDescription('');
                            }}
                            disabled={renameLoading}
                            size="small"
                          >
                            {t('documentUpload.common.cancel')}
                          </Button>
                        </Box>
                      </Box>
                    ) : (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 0.5,
                          width: '100%',
                          minWidth: 0,
                        }}
                      >
                        <Typography
                          variant="body1"
                          sx={{ overflowWrap: 'anywhere', wordBreak: 'break-word', flex: 1, minWidth: 0 }}
                        >
                          {doc.description || doc.name || doc.originalName || t('documentUpload.documents.noTitle')}
                        </Typography>
                        <Tooltip title={t('documentUpload.documents.tooltips.edit')} placement="bottom">
                          <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
                            <IconButton
                              size="small"
                              disabled={disabled}
                              onClick={() => {
                                setEditingDocId(doc.id);
                                setEditingDescription(doc.description || '');
                              }}
                              aria-label={t('documentUpload.documents.tooltips.edit')}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </Tooltip>
                      </Box>
                    )
                  }
                  secondary={
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1,
                        mt: 0.5,
                        flexWrap: 'wrap',
                        width: '100%',
                      }}
                    >
                      <Chip
                        size="small"
                        label={documentTypeChipLabel(doc, t)}
                        color="primary"
                        variant="outlined"
                        sx={wrappingChipSx}
                      />
                      {processingLabel && (
                        <Chip
                          size="small"
                          label={processingLabel}
                          color="warning"
                          variant="outlined"
                          sx={wrappingChipSx}
                        />
                      )}
                      {doc.uploadDate && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                        >
                          {t('documentUpload.documents.uploadedOn', {
                            date: new Date(doc.uploadDate).toLocaleDateString(),
                          })}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 0.5,
                  width: { xs: '100%', md: 'auto' },
                  pl: { xs: 5, md: 0 },
                  flexShrink: 0,
                }}
              >
                {showReview && (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={disabled}
                    onClick={() => onOpenReview?.(doc.id)}
                    sx={{
                      flex: { xs: '1 1 100%', sm: '1 1 auto' },
                      minWidth: 0,
                      whiteSpace: 'normal',
                      textAlign: 'center',
                      lineHeight: 1.3,
                      py: 0.75,
                    }}
                  >
                    {reviewLabel}
                  </Button>
                )}
                <Tooltip title={t('documentUpload.documents.tooltips.download')} placement="bottom">
                  <Box component="span" sx={{ display: 'inline-flex' }}>
                    <IconButton
                      disabled={disabled}
                      onClick={() => handleDownload(doc.id, doc.originalName || doc.name)}
                      aria-label={t('documentUpload.documents.tooltips.download')}
                    >
                      <DownloadIcon />
                    </IconButton>
                  </Box>
                </Tooltip>
                <Tooltip title={t('documentUpload.documents.tooltips.delete')} placement="bottom">
                  <Box component="span" sx={{ display: 'inline-flex' }}>
                    <IconButton
                      disabled={disabled}
                      onClick={() => {
                        setDocToDelete(doc);
                        setDeleteDialogOpen(true);
                      }}
                      aria-label={t('documentUpload.documents.tooltips.delete')}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </Tooltip>
              </Box>
            </ListItem>
          );
        })}
      </List>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        aria-labelledby="profile-delete-document-dialog-title"
      >
        <DialogTitle id="profile-delete-document-dialog-title">
          {t('documentUpload.deleteDialog.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('documentUpload.deleteDialog.confirmation')}
          </DialogContentText>
          {docToDelete && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('documentUpload.deleteDialog.detailsTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>{t('documentUpload.deleteDialog.nameLabel')}</strong>{' '}
                {docToDelete.description
                  || docToDelete.name
                  || docToDelete.originalName
                  || t('documentUpload.deleteDialog.notSpecified')}
              </Typography>
            </Box>
          )}
          <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 'bold' }}>
            {t('documentUpload.deleteDialog.warning')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} variant="outlined" color="primary" autoFocus>
            {t('documentUpload.common.cancel')}
          </Button>
          <Button
            onClick={async () => {
              if (docToDelete) {
                await handleDelete(docToDelete.id);
              }
              setDeleteDialogOpen(false);
              setDocToDelete(null);
            }}
            variant="contained"
            color="error"
          >
            {t('documentUpload.deleteDialog.deleteCta')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProfileDocumentList;
