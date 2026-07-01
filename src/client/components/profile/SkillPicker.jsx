import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { postRoleSkillSearch, peekRoleSkillSearchCache } from '../../utils/roleSkillSearchApi';
import SkillChip from './SkillChip';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;
const EMPTY_EXCLUDE_LABELS = Object.freeze([]);

function normalizeSkillLabel(raw) {
  if (typeof raw === 'string') return raw.trim();
  return String(raw?.name || raw || '').trim();
}

function normalizeSelectedSkills(values = []) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const label = normalizeSkillLabel(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function normalizeExcludeLabelsKey(excludeLabels = []) {
  return JSON.stringify(
    (Array.isArray(excludeLabels) ? excludeLabels : [])
      .map((label) => String(label || '').trim().toLowerCase())
      .filter(Boolean)
      .sort()
  );
}

function dedupeSkillsByLabel(skills = []) {
  const seen = new Set();
  const out = [];
  for (const skill of skills) {
    const label = String(skill?.label || skill?.key || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

function excludeSkillLabels(skills = [], excludeLabels = []) {
  const excluded = new Set(
    (Array.isArray(excludeLabels) ? excludeLabels : [])
      .map((label) => String(label || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (excluded.size === 0) return skills;
  return skills.filter((skill) => {
    const label = String(skill?.label || skill?.key || '').trim().toLowerCase();
    return label && !excluded.has(label);
  });
}

function SkillPickerDialog({
  open,
  onClose,
  onSave,
  initialValues = [],
  maxItems = 10,
  recommendationContextTexts = [],
  excludeLabels = EMPTY_EXCLUDE_LABELS,
  translationKeyPrefix = 'skillSelection',
}) {
  const { t } = useTranslation('onboarding');
  const tk = useCallback((suffix) => `${translationKeyPrefix}.${suffix}`, [translationKeyPrefix]);
  const [draftValues, setDraftValues] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rawResults, setRawResults] = useState([]);
  const [resultMode, setResultMode] = useState('recommendations');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const initialValuesKey = useMemo(
    () => JSON.stringify(normalizeSelectedSkills(initialValues)),
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

  const excludeLabelsKey = useMemo(
    () => normalizeExcludeLabelsKey(excludeLabels),
    [excludeLabels]
  );

  const draftValuesRef = useRef(draftValues);
  draftValuesRef.current = draftValues;

  const fetchGenerationRef = useRef(0);

  const results = useMemo(
    () => excludeSkillLabels(dedupeSkillsByLabel(rawResults), excludeLabels),
    [rawResults, excludeLabelsKey]
  );

  useEffect(() => {
    if (!open) return;
    setDraftValues(normalizeSelectedSkills(initialValues));
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
    const cached = peekRoleSkillSearchCache({ query, contextTexts });
    if (cached) {
      const merged = dedupeSkillsByLabel([
        ...cached.requiredSkills,
        ...cached.optionalSkills,
      ]);
      setRawResults(merged);
      setResultMode(cached.mode);
      setLoading(false);
      setError('');
    } else {
      setLoading(true);
      setError('');
    }
    const token = localStorage.getItem('token');
    postRoleSkillSearch({
      token,
      query,
      contextTexts,
      selectedLabels: draftValuesRef.current,
    })
      .then((data) => {
        if (fetchGenerationRef.current !== fetchGeneration) return;
        const merged = dedupeSkillsByLabel([
          ...data.requiredSkills,
          ...data.optionalSkills,
        ]);
        setRawResults(merged);
        setResultMode(data.mode);
      })
      .catch((err) => {
        if (fetchGenerationRef.current !== fetchGeneration) return;
        setError(err.message || t(tk('errors.loadFailed')));
        setRawResults([]);
      })
      .finally(() => {
        if (fetchGenerationRef.current === fetchGeneration) {
          setLoading(false);
        }
      });
    return undefined;
  }, [open, debouncedSearch, contextKey, t, tk]);

  const displayResults = useMemo(() => {
    const apiLabels = new Set(results.map((item) => String(item.label || '').toLowerCase()));
    const selectedExtras = draftValues
      .filter((label) => !apiLabels.has(label.toLowerCase()))
      .map((label) => ({ key: label, label }));
    return [...selectedExtras, ...results];
  }, [results, draftValues]);

  const toggleSkill = useCallback((label) => {
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
    ? t(tk('searchResultsTitle'))
    : t(tk('recommendationsTitle'));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        {t(tk('dialogTitle'))}
        <IconButton
          aria-label={t('profilePage.actions.cancel', { ns: 'onboarding' })}
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <TextField
          fullWidth
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(tk('searchPlaceholder'))}
          sx={{ mb: 1.5 }}
          autoFocus
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {t(tk('selectedCount'), {
            count: draftValues.length,
            max: maxItems,
          })}
        </Typography>
        {!isSearchActive && !loading ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t(tk('searchHint'))}
          </Typography>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>
            {error}
          </Alert>
        ) : null}
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              {t(tk('loading'))}
            </Typography>
          </Box>
        ) : (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {resultsTitle}
            </Typography>
            {displayResults.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {isSearchActive
                  ? t(tk('noSearchResults'))
                  : t(tk('noRecommendations'))}
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
                {displayResults.map((item) => {
                  const label = String(item.label || item.key || '').trim();
                  if (!label) return null;
                  const key = String(item.key || label).trim();
                  const selected = selectedSet.has(label.toLowerCase());
                  const atLimit = !selected && draftValues.length >= maxItems;
                  return (
                    <SkillChip
                      key={key}
                      label={label}
                      skillKey={key}
                      selected={selected}
                      onClick={() => toggleSkill(label)}
                      disabled={atLimit}
                    />
                  );
                })}
              </Box>
            )}
            {!isSearchActive && resultMode === 'recommendations' && displayResults.length > 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                {t(tk('recommendationsHint'))}
              </Typography>
            ) : null}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('profilePage.actions.cancel', { ns: 'onboarding' })}</Button>
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
 * Skill picker for profile edit (saved to structuredUserInfo.skills or skillsInDevelopment).
 */
export default function SkillPicker({
  value = [],
  onChange,
  label,
  helperText,
  disabled = false,
  maxItems = 10,
  recommendationContextTexts = [],
  excludeLabels = EMPTY_EXCLUDE_LABELS,
  translationKeyPrefix = 'skillSelection',
}) {
  const { t } = useTranslation('onboarding');
  const tk = useCallback((suffix) => `${translationKeyPrefix}.${suffix}`, [translationKeyPrefix]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedValues = useMemo(() => normalizeSelectedSkills(value), [value]);

  const emitValues = (nextValues) => {
    onChange?.(normalizeSelectedSkills(nextValues).slice(0, maxItems));
  };

  const handleRemove = (index) => {
    emitValues(selectedValues.filter((_, itemIndex) => itemIndex !== index));
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
            <SkillChip
              key={`${item}-${index}`}
              label={item}
              skillKey={item}
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
        {t(tk('addButton'))}
      </Button>
      {helperText ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {helperText}
        </Typography>
      ) : null}
      <SkillPickerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={(next) => {
          emitValues(next);
          setDialogOpen(false);
        }}
        initialValues={selectedValues}
        maxItems={maxItems}
        recommendationContextTexts={recommendationContextTexts}
        excludeLabels={excludeLabels}
        translationKeyPrefix={translationKeyPrefix}
      />
    </Box>
  );
}
