import React, { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';
import axios from 'axios';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Box,
  Slider,
  Typography,
  Avatar,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  Delete as DeleteIcon,
  CameraAlt as CameraIcon
} from '@mui/icons-material';
import { getCroppedImg } from '../../utils/imageUtils';
import { useTranslation } from 'react-i18next';

const ProfilePictureEditor = ({ open, onClose, currentPicture, onPictureUpdate }) => {
  const { t } = useTranslation('onboarding');
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef(null);

  // Load current picture when dialog opens
  React.useEffect(() => {
    if (open && currentPicture) {
      const imageUrl = `/uploads/${currentPicture}`;
      setImageSrc(imageUrl);
      // Reset crop and zoom when loading existing image
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    } else if (open && !currentPicture) {
      setImageSrc(null);
      setCroppedAreaPixels(null);
    }
  }, [open, currentPicture]);

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setImageSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setError(null);
      setShowDeleteConfirm(false);
    }
  }, [open]);

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError(t('profilePage.photo.editor.errors.invalidType'));
      return;
    }

    // Validate file size (5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setError(t('profilePage.photo.editor.errors.fileTooLarge'));
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setImageSrc(reader.result);
      setZoom(1);
      setCrop({ x: 0, y: 0 });
    });
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_croppedArea, croppedAreaPixels) => {
    if (croppedAreaPixels && croppedAreaPixels.width > 0 && croppedAreaPixels.height > 0) {
      setCroppedAreaPixels(croppedAreaPixels);
    }
  }, []);

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) {
      setError(t('profilePage.photo.editor.errors.selectAndCropFirst'));
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // Create cropped image blob
      const croppedImageBlob = await getCroppedImg(imageSrc, croppedAreaPixels, 0);
      
      // Create FormData
      const formData = new FormData();
      formData.append('profilePicture', croppedImageBlob, 'profile-picture.jpg');

      // Upload to server
      const response = await axios.put('/api/profile/profile-picture', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        // Notify parent component with the new picture filename
        if (onPictureUpdate) {
          onPictureUpdate(response.data.profilePicture);
        }
        
        // Close dialog after a brief delay to show success
        setTimeout(() => {
          onClose();
        }, 100);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || err.message || t('profilePage.photo.editor.errors.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!currentPicture) {
      setError(t('profilePage.photo.editor.errors.noPictureToDelete'));
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await axios.delete('/api/profile/profile-picture');
      
      if (response.data.success) {
        // Notify parent component
        if (onPictureUpdate) {
          onPictureUpdate(null);
        }
        
        setShowDeleteConfirm(false);
        onClose();
      }
    } catch (err) {
      console.error('Delete error:', err);
      setError(err.response?.data?.error || err.message || t('profilePage.photo.editor.errors.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.1, 4));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.1, 1));
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <>
      <Dialog 
        open={open} 
        onClose={handleCancel}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            minHeight: '500px'
          }
        }}
      >
        <DialogTitle>
          {currentPicture ? t('profilePage.photo.editor.titleEdit') : t('profilePage.photo.editor.titleAdd')}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {!imageSrc ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '400px',
                border: '2px dashed',
                borderColor: 'divider',
                borderRadius: 2,
                p: 4,
                cursor: 'pointer',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'action.hover'
                }
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <CameraIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                {t('profilePage.photo.editor.selectImageCta')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('profilePage.photo.editor.supportedFormats')}
              </Typography>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </Box>
          ) : (
            <Box>
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  height: '400px',
                  bgcolor: 'grey.900',
                  borderRadius: 2,
                  overflow: 'hidden',
                  mb: 3
                }}
              >
                <Cropper
                  image={imageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                  cropShape="round"
                  showGrid={false}
                />
              </Box>

              {/* Zoom Controls */}
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                  <Tooltip title={t('profilePage.photo.editor.zoomOut')}>
                    <IconButton onClick={handleZoomOut} disabled={zoom <= 1}>
                      <ZoomOutIcon />
                    </IconButton>
                  </Tooltip>
                  <Slider
                    value={zoom}
                    min={1}
                    max={4}
                    step={0.1}
                    onChange={(e, value) => setZoom(value)}
                    sx={{ flexGrow: 1 }}
                    aria-label={t('profilePage.photo.editor.zoomAriaLabel')}
                  />
                  <Tooltip title={t('profilePage.photo.editor.zoomIn')}>
                    <IconButton onClick={handleZoomIn} disabled={zoom >= 4}>
                      <ZoomInIcon />
                    </IconButton>
                  </Tooltip>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: '60px' }}>
                    {zoom.toFixed(1)}x
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {t('profilePage.photo.editor.cropHint')}
                </Typography>
              </Box>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'nowrap', gap: 1 }}>
          {currentPicture && (
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setShowDeleteConfirm(true)}
              disabled={uploading || deleting}
            >
              {t('profilePage.photo.editor.delete')}
            </Button>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {imageSrc && (
            <Button
              variant="outlined"
              startIcon={<CameraIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || deleting}
            >
              {t('profilePage.photo.editor.changeImage')}
            </Button>
          )}
          <Button onClick={handleCancel} disabled={uploading || deleting}>
            {t('profilePage.actions.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!imageSrc || uploading || deleting}
          >
            {uploading ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                {t('profilePage.photo.editor.uploading')}
              </>
            ) : (
              t('profilePage.actions.save')
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="delete-profile-picture-dialog-title"
        aria-describedby="delete-profile-picture-dialog-description"
      >
        <DialogTitle id="delete-profile-picture-dialog-title">
          {t('profilePage.photo.editor.deleteDialog.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-profile-picture-dialog-description">
            {t('profilePage.photo.editor.deleteDialog.confirmation')}
          </DialogContentText>
          {currentPicture && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1, textAlign: 'center' }}>
              <Avatar
                src={`/uploads/${currentPicture}`}
                alt={t('profilePage.photo.editor.deleteDialog.currentAlt')}
                sx={{ width: 80, height: 80, mx: 'auto', mb: 1 }}
              />
              <Typography variant="caption" color="text.secondary">
                {t('profilePage.photo.editor.deleteDialog.currentLabel')}
              </Typography>
            </Box>
          )}
          <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 'bold' }}>
            {t('profilePage.photo.editor.deleteDialog.warning')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setShowDeleteConfirm(false)}
            variant="outlined"
            color="primary"
            disabled={deleting}
            autoFocus
          >
            {t('profilePage.actions.cancel')}
          </Button>
          <Button
            onClick={handleDelete}
            variant="contained"
            color="error"
            disabled={deleting}
          >
            {deleting ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                {t('profilePage.photo.editor.deleting')}
              </>
            ) : (
              t('profilePage.photo.editor.delete')
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ProfilePictureEditor;
