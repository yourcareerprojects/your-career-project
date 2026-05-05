import React from 'react';
import {
  Box,
  TextField,
  Grid,
  Typography,
  Button,
  MenuItem,
  IconButton,
  Paper,
  FormControl,
  InputLabel,
  Select,
  Chip
} from '@mui/material';
import { Delete as DeleteIcon, Add as AddIcon, DragIndicator as DragIndicatorIcon } from '@mui/icons-material';
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

// Sortable Language Item Component - Defined outside to prevent recreation
const SortableLanguageItem = React.memo(({ 
  language = {}, 
  index = 0, 
  onLanguageChange = () => {}, 
  onRemoveLanguage = () => {}, 
  errors = {}, 
  loading = false 
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `language-${index}` });

  const style = React.useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }), [transform, transition, isDragging]);

  // Memoize the language change handler to prevent unnecessary re-renders
  const handleLanguageChange = React.useCallback((field, value) => {
    onLanguageChange(index, field, value);
  }, [index, onLanguageChange]);

  return (
    <Paper 
      ref={setNodeRef} 
      style={style} 
      sx={{ p: 2, mb: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton
          {...attributes}
          {...listeners}
          sx={{ mr: 1, cursor: 'grab' }}
          disabled={loading}
        >
          <DragIndicatorIcon />
        </IconButton>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          Language #{index + 1}
        </Typography>
        <IconButton 
          onClick={() => onRemoveLanguage(index)}
          disabled={loading}
          color="error"
        >
          <DeleteIcon />
        </IconButton>
      </Box>
      
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <TextField
            required
            fullWidth
            label="Language"
            value={language.language || ''}
            onChange={(e) => handleLanguageChange('language', e.target.value)}
            disabled={loading}
            error={!!errors[`languages.${index}.language`]}
            helperText={errors[`languages.${index}.language`]}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <FormControl fullWidth required>
            <InputLabel>Proficiency Level</InputLabel>
            <Select
              value={language.proficiency || ''}
              onChange={(e) => handleLanguageChange('proficiency', e.target.value)}
              label="Proficiency Level"
              disabled={loading}
              error={!!errors[`languages.${index}.proficiency`]}
            >
              <MenuItem value="basic">Basic</MenuItem>
              <MenuItem value="conversational">Conversational</MenuItem>
              <MenuItem value="fluent">Fluent</MenuItem>
              <MenuItem value="native">Native</MenuItem>
            </Select>
          </FormControl>
          {errors[`languages.${index}.proficiency`] && (
            <Typography color="error" variant="caption">{errors[`languages.${index}.proficiency`]}</Typography>
          )}
        </Grid>
      </Grid>
    </Paper>
  );
});

const LanguagesSection = ({ 
  languages,
  onLanguageChange,
  onAddLanguage,
  onRemoveLanguage,
  onReorder,
  sortOrder = 'manual',
  onSortOrderChange,
  loading,
  errors
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    
    if (active.id !== over.id && onReorder) {
      const oldIndex = languages.findIndex((item, index) => `language-${index}` === active.id);
      const newIndex = languages.findIndex((item, index) => `language-${index}` === over.id);
      
      const newLanguages = arrayMove(languages, oldIndex, newIndex);
      onReorder(newLanguages);
    }
  };


  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>
            Languages
          </Typography>
          {languages.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={`${languages.length} ${languages.length === 1 ? 'language' : 'languages'}`}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Chip
                label="Manual order"
                size="small"
                color="info"
              />
            </Box>
          )}
        </Box>

        <Button
          startIcon={<AddIcon />}
          onClick={onAddLanguage}
          disabled={loading}
          variant="outlined"
          size="small"
        >
          Add Language
        </Button>
      </Box>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={languages.map((language, index) => `language-${index}`)}
          strategy={verticalListSortingStrategy}
        >
          <Box>
            {languages.map((language, index) => {
              // Create a stable key based on index only
              const stableKey = `language-${index}`;
              return (
                <SortableLanguageItem
                  key={stableKey}
                  language={language}
                  index={index}
                  onLanguageChange={onLanguageChange}
                  onRemoveLanguage={onRemoveLanguage}
                  errors={errors}
                  loading={loading}
                />
              );
            })}
          </Box>
        </SortableContext>
      </DndContext>
    </Box>
  );
};

export default LanguagesSection;
