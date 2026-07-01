import React, { useMemo, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import {
  listIndustryOptions,
  resolveCanonicalIndustry,
  resolveIndustryDisplayLabel,
} from '../../../constants/industries';
import IndustrySectorChip from './IndustrySectorChip';
import IndustrySectorPickerDialog from './IndustrySectorPickerDialog';

const EMPTY_INDUSTRY_VALUES = [];

function buildSelectedOptions(values = [], lang = 'en') {
  const options = listIndustryOptions(lang);
  const optionsByValue = new Map(options.map((option) => [option.value, option]));

  return values.map((stored) => {
    const canonical = resolveCanonicalIndustry(stored) || String(stored || '').trim();
    const known = optionsByValue.get(canonical);
    if (known) return known;
    return {
      id: null,
      value: canonical,
      label: resolveIndustryDisplayLabel(canonical, lang) || canonical,
      legacy: true,
    };
  }).filter((option) => option.value);
}

/**
 * Industry domain picker: selected chips + “Add industry” opens a thematic chip dialog.
 */
export default function IndustrySectorPicker({
  value,
  onChange,
  lang = 'en',
  label,
  helperText,
  disabled = false,
  multiple = true,
  maxItems = 10,
}) {
  const { t } = useTranslation('onboarding');
  const [dialogOpen, setDialogOpen] = useState(false);
  const stableValue = value ?? EMPTY_INDUSTRY_VALUES;

  const selectedValues = useMemo(
    () => (multiple ? stableValue : (stableValue.length > 0 ? [stableValue[0]] : [])),
    [multiple, stableValue]
  );
  const selectedOptions = useMemo(
    () => buildSelectedOptions(selectedValues, lang),
    [selectedValues, lang]
  );

  const emitValues = (nextValues) => {
    const cleaned = nextValues.map((v) => resolveCanonicalIndustry(v) || String(v || '').trim()).filter(Boolean);
    if (!multiple) {
      onChange?.(cleaned.length > 0 ? [cleaned[0]] : []);
      return;
    }
    onChange?.(cleaned.slice(0, maxItems));
  };

  const handleSave = (draftValues) => {
    emitValues(draftValues);
  };

  const handleRemove = (index) => {
    const next = selectedValues.filter((_, itemIndex) => itemIndex !== index);
    emitValues(next);
  };

  const addButtonLabel = multiple
    ? t('profilePage.structuredInfo.industrySectors.addButton')
    : (selectedOptions.length > 0
      ? t('profilePage.structuredInfo.industrySectors.changeButton')
      : t('profilePage.structuredInfo.industrySectors.addButton'));

  return (
    <Box>
      {label ? (
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
          {label}
        </Typography>
      ) : null}

      {selectedOptions.length > 0 ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          {selectedOptions.map((option, index) => (
            <IndustrySectorChip
              key={`${option.value}-${index}`}
              value={option.value}
              lang={lang}
              industryId={option.id}
              legacy={Boolean(option.legacy)}
              onDelete={!disabled ? () => handleRemove(index) : undefined}
            />
          ))}
        </Box>
      ) : null}

      <Button
        variant="outlined"
        size="small"
        startIcon={<AddIcon />}
        onClick={() => setDialogOpen(true)}
        disabled={disabled}
        sx={{ color: '#111', borderColor: '#111' }}
      >
        {addButtonLabel}
      </Button>

      {helperText ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {helperText}
        </Typography>
      ) : null}

      <IndustrySectorPickerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        lang={lang}
        initialValues={selectedValues}
        multiple={multiple}
        maxItems={maxItems}
      />
    </Box>
  );
}
