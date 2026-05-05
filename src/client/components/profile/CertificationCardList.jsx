import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  Alert,
  Chip,
  Tooltip
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import CertificationCard from './CertificationCard';
import SortToggle from './SortToggle';
import DragHandle from './DragHandle';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Sortable Certification Item Component - Memoized to prevent unnecessary re-renders
const SortableCertificationItem = React.memo(({ 
  certification, 
  index, 
  onFieldChange, 
  onEdit, 
  onDelete, 
  onSave, 
  onCancel, 
  isEditing, 
  loading, 
  errors, 
  showActionButtons, 
  sortOrder 
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `certification-${index}` });

  const style = React.useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }), [transform, transition, isDragging]);

  const isDragDisabled = sortOrder === 'chronological';

  // Memoize the field change handler to prevent unnecessary re-renders
  const handleFieldChange = React.useCallback((field, value) => {
    onFieldChange(index, field, value);
  }, [index, onFieldChange]);

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{ mb: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        {/* Drag Handle */}
        {!isDragDisabled && (
          <Box
            {...attributes}
            {...listeners}
            sx={{
              minHeight: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <DragHandle isVisible={true} size="small" />
          </Box>
        )}
        
        {/* Certification Card */}
        <Box sx={{ flex: 1 }}>
          <CertificationCard
            certification={certification}
            index={index}
            onEdit={onEdit}
            onDelete={onDelete}
            onSave={onSave}
            onCancel={onCancel}
            isEditing={isEditing}
            loading={loading}
            errors={errors}
            showActionButtons={showActionButtons}
            onFieldChange={handleFieldChange}
          />
        </Box>
      </Box>
    </Box>
  );
});

const CertificationCardList = ({ 
  certifications = [], 
  onAdd, 
  onEdit, 
  onDelete, 
  onSave, 
  onCancel,
  onFieldChange,
  onReorder,
  loading = false,
  errors = {},
  showActionButtons = true,
  isEditMode = true,
  sortOrder = 'chronological',
  onSortOrderChange
}) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [certificationToDelete, setCertificationToDelete] = useState(null);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [previousSortOrder, setPreviousSortOrder] = useState(sortOrder);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Detect if certifications are in chronological order
  const isChronologicallySorted = useCallback((certifications) => {
    if (certifications.length <= 1) return true;
    
    const chronologicalOrder = [...certifications].sort((a, b) => {
      const dateA = new Date(a.date || '1900-01-01');
      const dateB = new Date(b.date || '1900-01-01');
      return dateB - dateA; // Most recent first
    });
    
    return certifications.every((cert, index) => cert === chronologicalOrder[index]);
  }, []);

  // Detect actual sort order based on current order
  const detectSortOrder = useCallback((certifications) => {
    return isChronologicallySorted(certifications) ? 'chronological' : 'manual';
  }, [isChronologicallySorted]);

  // Reset user interaction flag when component mounts or certifications change significantly
  useEffect(() => {
    setHasUserInteracted(false);
  }, [certifications.length]); // Reset when number of certifications changes

  // Detect actual sort order and sync with parent component (only on initial load)
  useEffect(() => {
    if (!hasUserInteracted) {
      const actualSortOrder = detectSortOrder(certifications);
      
      // Only update if detected order differs from current prop
      if (actualSortOrder !== sortOrder && onSortOrderChange) {
        onSortOrderChange(actualSortOrder);
      }
    }
  }, [certifications, sortOrder, onSortOrderChange, detectSortOrder, hasUserInteracted]);

  // Auto-sort certifications by date only when user switches to chronological order
  useEffect(() => {
    // Only auto-sort if the sort order changed from 'manual' to 'chronological'
    if (sortOrder === 'chronological' && previousSortOrder === 'manual' && onReorder) {
      const sortedCertifications = [...certifications].sort((a, b) => {
        const dateA = new Date(a.date || '1900-01-01');
        const dateB = new Date(b.date || '1900-01-01');
        return dateB - dateA; // Most recent first
      });
      
      // Only update if order actually changed
      const orderChanged = sortedCertifications.some((cert, index) => 
        cert !== certifications[index]
      );
      
      if (orderChanged && certifications.length > 0) {
        onReorder(sortedCertifications);
      }
    }
    
    // Update previous sort order
    setPreviousSortOrder(sortOrder);
  }, [sortOrder, certifications, onReorder, previousSortOrder]);

  const handleSortToggle = () => {
    const newSortOrder = sortOrder === 'chronological' ? 'manual' : 'chronological';
    setHasUserInteracted(true); // Mark that user has interacted with sort toggle
    if (onSortOrderChange) {
      onSortOrderChange(newSortOrder);
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    
    if (active.id !== over.id && onReorder) {
      const oldIndex = certifications.findIndex(item => `certification-${certifications.indexOf(item)}` === active.id);
      const newIndex = certifications.findIndex(item => `certification-${certifications.indexOf(item)}` === over.id);
      
      const newCertifications = arrayMove(certifications, oldIndex, newIndex);
      onReorder(newCertifications);
    }
  };

  const handleEdit = (index) => {
    // Individual editing is no longer used - handled at section level
  };

  const handleDelete = (index) => {
    setCertificationToDelete({ index, certification: certifications[index] });
    setDeleteDialogOpen(true);
  };


  const handleSave = (index, data) => {
    onSave(index, data);
  };

  const handleCancel = (index) => {
    onCancel(index);
  };

  const confirmDelete = () => {
    if (certificationToDelete) {
      onDelete(certificationToDelete.index);
    }
    setDeleteDialogOpen(false);
    setCertificationToDelete(null);
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setCertificationToDelete(null);
  };

  const handleAddCertification = () => {
    onAdd();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant={isEditMode ? "h6" : "subtitle2"} color={isEditMode ? "inherit" : "text.secondary"} sx={isEditMode ? {} : { mb: 2 }} gutterBottom={isEditMode}>
            Certifications
          </Typography>
          {certifications.length > 0 && isEditMode && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={`${certifications.length} ${certifications.length === 1 ? 'entry' : 'entries'}`}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Chip
                label={sortOrder === 'chronological' ? 'Auto-sorted' : 'Manual order'}
                size="small"
                color={sortOrder === 'chronological' ? 'success' : 'info'}
              />
            </Box>
          )}
        </Box>

        {showActionButtons && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Add Button */}
            <Button
              startIcon={<AddIcon />}
              onClick={handleAddCertification}
              disabled={loading}
              variant="outlined"
              size="small"
            >
              Add Certification
            </Button>

            {/* Sort Toggle */}
            <SortToggle
              sortOrder={sortOrder}
              onToggle={handleSortToggle}
              disabled={certifications.length <= 1}
              size="small"
            />
          </Box>
        )}
      </Box>

      {certifications.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          No certifications added yet. Click "Add Certification" to get started.
        </Alert>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={certifications.map((_, index) => `certification-${index}`)}
            strategy={verticalListSortingStrategy}
          >
            <Box>
              {certifications.map((certification, index) => {
                // Create a stable key based on index only
                const stableKey = `certification-${index}`;
                return (
                  <SortableCertificationItem
                    key={stableKey}
                    certification={certification}
                    index={index}
                    onFieldChange={onFieldChange}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onSave={onSave}
                    onCancel={onCancel}
                    isEditing={isEditMode}
                    loading={loading}
                    errors={errors}
                    showActionButtons={showActionButtons}
                    sortOrder={sortOrder}
                  />
                );
              })}
            </Box>
          </SortableContext>
        </DndContext>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={cancelDelete}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">
          Delete Certification
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            Are you sure you want to delete this certification?
          </DialogContentText>
          {certificationToDelete?.certification && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                Certification Details:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Name:</strong> {certificationToDelete.certification.name || 'Not specified'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Issued by:</strong> {certificationToDelete.certification.issuer || 'Not specified'}
              </Typography>
            </Box>
          )}
          <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 'bold' }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={cancelDelete}
            variant="outlined"
            color="primary"
            autoFocus
          >
            Cancel
          </Button>
          <Button 
            onClick={confirmDelete}
            variant="contained"
            color="error"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CertificationCardList;
