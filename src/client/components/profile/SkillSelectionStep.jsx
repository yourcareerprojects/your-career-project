import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  postRoleSkillSearch,
  peekRoleSkillSearchCache,
  peekBestRoleSkillRecommendationsCache,
  peekRoleSkillSearchInflight,
} from '../../utils/roleSkillSearchApi';
import SkillChip from './SkillChip';
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;
const EMPTY_EXCLUDE_LABELS = Object.freeze([]);

function normalizeExcludeLabelsKey(excludeLabels = []) {
  return JSON.stringify(
    (Array.isArray(excludeLabels) ? excludeLabels : [])
      .map((label) => String(label || '').trim().toLowerCase())
      .filter(Boolean)
      .sort()
  );
}

function normalizeSkillName(item) {
  if (typeof item === 'string') return item.trim();
  return String(item?.name || '').trim();
}

function skillNamesFromProfile(skills = []) {
  return (Array.isArray(skills) ? skills : [])
    .map(normalizeSkillName)
    .filter(Boolean);
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

function SkillChipGroup({
  skills,
  selectedNames,
  onToggle,
  maxSelected,
}) {  if (!skills.length) return null;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
      {skills.map((skill) => {
        const label = String(skill.label || skill.key || '').trim();
        const key = String(skill.key || label).trim();
        if (!label) return null;
        const selected = selectedNames.has(label);
        const atLimit = !selected && selectedNames.size >= maxSelected;
        return (
          <SkillChip
            key={key}
            label={label}
            skillKey={key}
            selected={selected}
            onClick={() => onToggle(label)}
            disabled={atLimit}
          />
        );
      })}
    </Box>
  );}

/**
 * Manual profile fill: search and pick skills (saved to structuredUserInfo.skills or skillsInDevelopment).
 */
const SkillSelectionStep = ({
  selectedSkills = [],
  onSelectedSkillsChange,
  maxSelected = 25,
  recommendationContextTexts = [],
  excludeLabels = EMPTY_EXCLUDE_LABELS,
  translationKeyPrefix = 'skillSelection',
}) => {
  const { t } = useTranslation('onboarding');
  const tk = useCallback((suffix) => `${translationKeyPrefix}.${suffix}`, [translationKeyPrefix]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [resultMode, setResultMode] = useState('recommendations');
  const [rawCatalog, setRawCatalog] = useState({ requiredSkills: [], optionalSkills: [] });

  const excludeLabelsKey = useMemo(
    () => normalizeExcludeLabelsKey(excludeLabels),
    [excludeLabels]
  );

  const catalog = useMemo(() => ({
    requiredSkills: excludeSkillLabels(
      dedupeSkillsByLabel(rawCatalog.requiredSkills),
      excludeLabels
    ),
    optionalSkills: excludeSkillLabels(
      dedupeSkillsByLabel(rawCatalog.optionalSkills),
      excludeLabels
    ),
  }), [rawCatalog, excludeLabelsKey]);

  const selectedNames = useMemo(
    () => new Set(skillNamesFromProfile(selectedSkills)),
    [selectedSkills]
  );

  const selectedLabels = useMemo(
    () => skillNamesFromProfile(selectedSkills),
    [selectedSkills]
  );

  const selectedLabelsRef = useRef(selectedLabels);
  selectedLabelsRef.current = selectedLabels;

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

  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const fetchGeneration = fetchGenerationRef.current + 1;
    fetchGenerationRef.current = fetchGeneration;
    const query = debouncedSearch.length >= SEARCH_MIN_CHARS ? debouncedSearch : '';
    const cached = peekRoleSkillSearchCache({ query, contextTexts });
    const staleCatalog = !cached && !query
      ? peekBestRoleSkillRecommendationsCache(contextTexts)
      : null;
    const displayCatalog = cached || staleCatalog;
    if (displayCatalog) {
      setRawCatalog({
        requiredSkills: dedupeSkillsByLabel(displayCatalog.requiredSkills),
        optionalSkills: dedupeSkillsByLabel(displayCatalog.optionalSkills),
      });
      setResultMode(displayCatalog.mode);
      setLoading(!cached);
      setError('');
    } else {
      setLoading(true);
      setError('');
    }
    const inflight = peekRoleSkillSearchInflight({ query, contextTexts });
    const token = localStorage.getItem('token');
    const request = inflight || postRoleSkillSearch({
      token,
      query,
      contextTexts,
      selectedLabels: selectedLabelsRef.current,
    });
    request
      .then((data) => {
        if (fetchGenerationRef.current !== fetchGeneration) return;
        setRawCatalog({
          requiredSkills: dedupeSkillsByLabel(data.requiredSkills),
          optionalSkills: dedupeSkillsByLabel(data.optionalSkills),
        });
        setResultMode(data.mode);
      })
      .catch((err) => {
        if (fetchGenerationRef.current !== fetchGeneration) return;
        setError(err.message || t(tk('errors.loadFailed')));
        if (!displayCatalog) {
          setRawCatalog({ requiredSkills: [], optionalSkills: [] });
        }
      })
      .finally(() => {
        if (fetchGenerationRef.current === fetchGeneration) {
          setLoading(false);
        }
      });
    return undefined;
  }, [debouncedSearch, contextKey, contextTexts, t, tk]);

  const handleToggle = useCallback((label) => {
    const trimmed = String(label || '').trim();
    if (!trimmed) return;
    const current = skillNamesFromProfile(selectedSkills);
    const exists = current.some((name) => name.toLowerCase() === trimmed.toLowerCase());
    let next;
    if (exists) {
      next = current.filter((name) => name.toLowerCase() !== trimmed.toLowerCase());
    } else {
      if (current.length >= maxSelected) return;
      next = [...current, trimmed];
    }
    onSelectedSkillsChange(next.map((name) => ({ name })));
  }, [maxSelected, onSelectedSkillsChange, selectedSkills]);

  const isSearchActive = debouncedSearch.length >= SEARCH_MIN_CHARS;
  const resultsTitle = isSearchActive
    ? t(tk('searchResultsTitle'))
    : t(tk('recommendationsTitle'));

  const hasResults = catalog.requiredSkills.length > 0 || catalog.optionalSkills.length > 0;

  const displaySkills = useMemo(
    () => dedupeSkillsByLabel([...catalog.requiredSkills, ...catalog.optionalSkills]),
    [catalog.requiredSkills, catalog.optionalSkills]
  );

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(tk('intro'))}
      </Typography>
      <TextField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(tk('searchPlaceholder'))}
        size="small"
        fullWidth
        sx={{ mb: 1.5 }}
        hiddenLabel
        aria-label={t(tk('searchPlaceholder'))}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t(tk('selectedCount'), { count: selectedNames.size, max: maxSelected })}
      </Typography>
      {selectedLabels.length > 0 ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t(tk('selectedTitle'))}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
            {selectedLabels.map((label) => (
              <SkillChip
                key={label}
                label={label}
                skillKey={label}
                selected
                onDelete={() => handleToggle(label)}
              />
            ))}
          </Box>        </Box>
      ) : null}
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
      {loading && !hasResults ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">
            {t(tk('loading'))}
          </Typography>
        </Box>
      ) : (
        <>
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">
                {t(tk('loading'))}
              </Typography>
            </Box>
          ) : null}
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
            {resultsTitle}
          </Typography>
          {!hasResults ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {isSearchActive
                ? t(tk('noSearchResults'))
                : t(tk('noRecommendations'))}
            </Typography>
          ) : (
            <SkillChipGroup
              skills={displaySkills}
              selectedNames={selectedNames}
              onToggle={handleToggle}
              maxSelected={maxSelected}
            />          )}
          {!isSearchActive && resultMode === 'recommendations' && hasResults ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {t(tk('recommendationsHint'))}
            </Typography>
          ) : null}
        </>
      )}
    </Box>
  );
};

export default SkillSelectionStep;
