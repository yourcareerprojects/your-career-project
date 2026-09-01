import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import SkillDomainChip from './SkillDomainChip';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;

async function postRoleSkillDomainSearch({ token, query, contextTexts, selectedLabels }) {
  const res = await fetch(`/api/profile/role-skill-domains/search?${getProfileApiLangQuery()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: query || '',
      contextTexts: Array.isArray(contextTexts) ? contextTexts : [],
      selectedLabels: Array.isArray(selectedLabels) ? selectedLabels : [],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.details || 'Failed to load skill domains');
    err.status = res.status;
    throw err;
  }
  return {
    mode: data.mode === 'search' ? 'search' : 'recommendations',
    skillDomains: Array.isArray(data.skillDomains) ? data.skillDomains : [],
  };
}

function normalizeSelectedLabels(values = []) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const label = String(raw || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function dedupeCatalogByLabel(catalog = []) {
  const seen = new Set();
  const out = [];
  for (const item of catalog) {
    const label = String(item?.label || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function SkillDomainPickerDialog({
  open,
  onClose,
  onSave,
  initialValues = [],
  maxItems = 5,
  recommendationContextTexts = [],
}) {
  const { t } = useTranslation('onboarding');
  const [draftValues, setDraftValues] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const initialValuesKey = useMemo(
    () => JSON.stringify(normalizeSelectedLabels(initialValues)),
    [initialValues]
  );

  const contextKey = useMemo(
    () => JSON.stringify(
      (Array.isArray(recommendationContextTexts) ? recommendationContextTexts : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ),
    [recommendationContextTexts]
  );

  const contextTexts = useMemo(() => {
    try {
      const parsed = JSON.parse(contextKey);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [contextKey]);

  const draftValuesRef = React.useRef(draftValues);
  draftValuesRef.current = draftValues;

  const fetchGenerationRef = React.useRef(0);

  useEffect(() => {
    if (!open) return;
    setDraftValues(normalizeSelectedLabels(initialValues));
    setSearch('');
    setDebouncedSearch('');
    setError('');
  }, [open, initialValuesKey, initialValues]);

  useEffect(() => {
    if (!open) return undefined;
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [open, search]);

  const selectedSet = useMemo(
    () => new Set(draftValues.map((item) => item.toLowerCase())),
    [draftValues]
  );

  useEffect(() => {
    if (!open) {
      setLoading(false);
      return undefined;
    }
    const fetchGeneration = fetchGenerationRef.current + 1;
    fetchGenerationRef.current = fetchGeneration;
    const query = debouncedSearch.length >= SEARCH_MIN_CHARS ? debouncedSearch : '';
    setLoading(true);
    setError('');
    const token = localStorage.getItem('token');
    postRoleSkillDomainSearch({
      token,
      query,
      contextTexts,
      selectedLabels: draftValuesRef.current,
    })
      .then((data) => {
        if (fetchGenerationRef.current !== fetchGeneration) return;
        setResults(dedupeCatalogByLabel(data.skillDomains));
      })
      .catch((err) => {
        if (fetchGenerationRef.current !== fetchGeneration) return;
        setError(err.message || t('naturallyGoodAtCoaching.skillDomainPicker.errors.loadFailed'));
        setResults([]);
      })
      .finally(() => {
        if (fetchGenerationRef.current === fetchGeneration) {
          setLoading(false);
        }
      });
    return undefined;
  }, [open, debouncedSearch, contextKey, t]);

  const toggleDomain = useCallback((label) => {
    const trimmed = String(label || '').trim();
    if (!trimmed) return;
    setDraftValues((prev) => {
      const exists = prev.some((item) => item.toLowerCase() === trimmed.toLowerCase());
      if (exists) return prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
      if (prev.length >= maxItems) return prev;
      return [...prev, trimmed];
    });
  }, [maxItems]);

  const isSearchActive = debouncedSearch.length >= SEARCH_MIN_CHARS;
  const resultsTitle = isSearchActive
    ? t('naturallyGoodAtCoaching.skillDomainPicker.searchResultsTitle')
    : t('naturallyGoodAtCoaching.skillDomainPicker.recommendationsTitle');

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle sx={{ pr: 6 }}>
        {t('naturallyGoodAtCoaching.skillDomainPicker.dialogTitle')}
        <IconButton
          aria-label={t('profilePage.actions.cancel', { ns: 'onboarding' })}
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {draftValues.length > 0 ? (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="body1" sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}>
              {t('naturallyGoodAtCoaching.skillDomainPicker.dialogSelectionHint')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
              {draftValues.map((label) => (
                <SkillDomainChip
                  key={label}
                  label={label}
                  domainKey={label}
                  selected
                  onClick={() => toggleDomain(label)}
                />
              ))}
            </Box>
          </Box>
        ) : null}
        <TextField
          fullWidth
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('naturallyGoodAtCoaching.skillDomainPicker.searchPlaceholder')}
          sx={{ mb: 1.5 }}
          autoFocus
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {t('naturallyGoodAtCoaching.skillDomainPicker.selectedCount', {
            count: draftValues.length,
            max: maxItems,
          })}
        </Typography>
        {error ? (
          <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>
            {error}
          </Alert>
        ) : null}
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              {t('naturallyGoodAtCoaching.skillDomainPicker.loading')}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ mb: 1 }}>
            <Typography variant="body1" sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}>
              {resultsTitle}
            </Typography>
            {results.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {isSearchActive
                  ? t('naturallyGoodAtCoaching.skillDomainPicker.noSearchResults')
                  : t('naturallyGoodAtCoaching.skillDomainPicker.noRecommendations')}
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
                {results.map((item) => {
                  const label = String(item.label || '').trim();
                  if (!label) return null;
                  const key = String(item.key || label).trim();
                  const selected = selectedSet.has(label.toLowerCase());
                  const atLimit = !selected && draftValues.length >= maxItems;
                  return (
                    <SkillDomainChip
                      key={key}
                      label={label}
                      domainKey={key}
                      selected={selected}
                      onClick={() => toggleDomain(label)}
                      disabled={atLimit}
                    />
                  );
                })}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">{t('profilePage.actions.cancel', { ns: 'onboarding' })}</Button>
        <Button
          variant="contained"
          onClick={() => onSave?.(draftValues)}
          disabled={draftValues.length === 0}
        >
          {t('profilePage.actions.save', { ns: 'onboarding' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Skill domain picker for manual profile fill (saved to structuredUserInfo.skillDomains).
 */
export default function SkillDomainPicker({
  value = [],
  onChange,
  label,
  helperText,
  disabled = false,
  maxItems = 5,
  recommendationContextTexts = [],
  defaultDialogOpen = false,
  onDialogSave,
  onDialogCancel,
}) {
  const { t } = useTranslation('onboarding');
  const [dialogOpen, setDialogOpen] = useState(defaultDialogOpen);

  const selectedValues = useMemo(() => normalizeSelectedLabels(value), [value]);

  const emitValues = (nextValues) => {
    const next = normalizeSelectedLabels(nextValues).slice(0, maxItems);
    onChange?.(next);
    return next;
  };

  const handleRemove = (index) => {
    emitValues(selectedValues.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleClose = () => {
    setDialogOpen(false);
    onDialogCancel?.();
  };

  return (
    <Box>
      {label ? (
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {label}
        </Typography>
      ) : null}
      {selectedValues.length > 0 ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, mb: 1.5 }}>
          {selectedValues.map((item, index) => (
            <SkillDomainChip
              key={`${item}-${index}`}
              label={item}
              domainKey={item}
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
        disabled={disabled || selectedValues.length >= maxItems}
        sx={{ color: '#111', borderColor: '#111' }}
      >
        {t('naturallyGoodAtCoaching.skillDomainPicker.addButton')}
      </Button>
      {helperText ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {helperText}
        </Typography>
      ) : null}
      <SkillDomainPickerDialog
        open={dialogOpen}
        onClose={handleClose}
        onSave={(next) => {
          const saved = emitValues(next);
          setDialogOpen(false);
          onDialogSave?.(saved);
        }}
        initialValues={selectedValues}
        maxItems={maxItems}
        recommendationContextTexts={recommendationContextTexts}
      />
    </Box>
  );
}
