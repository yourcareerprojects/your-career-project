import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { listIndustryOptions, resolveCanonicalIndustry } from '../../../constants/industries';
import { listGroupedIndustryOptions } from '../../utils/industrySectorGroups';
import IndustrySectorChip from './IndustrySectorChip';

function normalizeDraftValues(values = []) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const canonical = resolveCanonicalIndustry(raw) || String(raw || '').trim();
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

const SELECTED_CHIP_SX = {
  backgroundColor: '#e9ecef',
  borderWidth: 2.5,
  borderColor: '#111',
  boxShadow: '0 0 0 1px #111',
  transform: 'translateY(-1px)',
};

function IndustryPickChip({ option, lang, selected, disabled, onToggle }) {
  return (
    <IndustrySectorChip
      value={option.value}
      lang={lang}
      industryId={option.id}
      onClick={() => {
        if (!disabled) onToggle(option);
      }}
      sx={{
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        ...(selected ? SELECTED_CHIP_SX : {}),
        '&:hover': disabled ? {} : { opacity: 0.88 },
      }}
    />
  );
}

export default function IndustrySectorPickerDialog({
  open,
  onClose,
  onSave,
  lang = 'en',
  initialValues = [],
  multiple = true,
  maxItems = 10,
}) {
  const { t } = useTranslation('onboarding');
  const [draftValues, setDraftValues] = useState([]);
  const latestInitialValuesRef = useRef(initialValues);

  latestInitialValuesRef.current = initialValues;

  const grouped = useMemo(() => {
    const options = listIndustryOptions(lang);
    return listGroupedIndustryOptions(options);
  }, [lang]);

  // Initialise draft only when the dialog opens — not on every parent re-render.
  useEffect(() => {
    if (!open) return;
    setDraftValues(
      normalizeDraftValues(latestInitialValuesRef.current).slice(0, multiple ? maxItems : 1)
    );
  }, [open, multiple, maxItems]);

  const draftSet = useMemo(
    () => new Set(draftValues),
    [draftValues]
  );

  const atDraftLimit = multiple && draftValues.length >= maxItems;

  const handleToggle = (option) => {
    const canonical = option.value;
    if (!multiple) {
      setDraftValues([canonical]);
      return;
    }
    setDraftValues((prev) => {
      if (prev.includes(canonical)) {
        return prev.filter((value) => value !== canonical);
      }
      if (prev.length >= maxItems) return prev;
      return [...prev, canonical];
    });
  };

  const handleSave = () => {
    onSave?.(draftValues);
    onClose?.();
  };

  const saveDisabled = !multiple && draftValues.length === 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle sx={{ pr: 6 }}>
        {t('profilePage.structuredInfo.industrySectors.dialogTitle')}
        <IconButton
          aria-label={t('profilePage.actions.cancel')}
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {multiple && draftValues.length > 0 ? (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t('profilePage.structuredInfo.industrySectors.dialogSelectionHint')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {draftValues.map((value) => (
                <IndustrySectorChip
                  key={value}
                  value={value}
                  lang={lang}
                  sx={SELECTED_CHIP_SX}
                />
              ))}
            </Box>
          </Box>
        ) : null}
        {grouped.map((group) => (
          <Box key={group.key} sx={{ mb: 3 }}>
            <Typography
              variant="subtitle2"
              color="text.secondary"
              sx={{ mb: 1.5, fontWeight: 600 }}
            >
              {t(`profilePage.structuredInfo.industrySectors.groups.${group.key}`)}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {group.options.map((option) => {
                const selected = draftSet.has(option.value);
                const disabled = !selected && atDraftLimit;
                return (
                  <IndustryPickChip
                    key={option.id}
                    option={option}
                    lang={lang}
                    selected={selected}
                    disabled={disabled}
                    onToggle={handleToggle}
                  />
                );
              })}
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          {t('profilePage.actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saveDisabled}
        >
          {t('profilePage.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
