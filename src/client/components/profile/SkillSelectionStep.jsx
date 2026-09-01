import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
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

function findScrollableAncestor(element) {
  let node = element?.parentElement || null;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style?.overflowY || '';
    if (
      (overflowY === 'auto' || overflowY === 'scroll')
      && node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
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
            onClick={(event) => onToggle(label, event.currentTarget)}
            disabled={atLimit}
          />
        );
      })}
    </Box>
  );}

const resultsPanelSx = {
  mt: 1,
  pt: 1,
  borderTop: '1px solid',
  borderColor: 'divider',
};

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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
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

  const handleToggle = useCallback((label, sourceEl = null) => {
    const trimmed = String(label || '').trim();
    if (!trimmed) return;
    const scrollContainer = findScrollableAncestor(sourceEl);
    const previousScrollTop = scrollContainer?.scrollTop ?? null;
    const previousWindowScrollY = window.scrollY;
    if (sourceEl instanceof HTMLElement) {
      sourceEl.blur();
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
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
    requestAnimationFrame(() => {
      if (scrollContainer && previousScrollTop != null) {
        scrollContainer.scrollTop = previousScrollTop;
      } else if (window.scrollY !== previousWindowScrollY) {
        window.scrollTo({ top: previousWindowScrollY, behavior: 'auto' });
      }
    });
  }, [maxSelected, onSelectedSkillsChange, selectedSkills]);

  const isSearchActive = debouncedSearch.length >= SEARCH_MIN_CHARS;
  const isSearchUiActive = search.trim().length >= SEARCH_MIN_CHARS;
  const isMobileSearchMode = isMobile && isSearchUiActive;
  const showRecommendations = !isMobileSearchMode;
  const showSelectedOnMobile = !isMobile || !isSearchUiActive;
  const resultsTitle = (isSearchActive || isMobileSearchMode)
    ? t(tk('searchResultsTitle'))
    : t(tk('recommendationsTitle'));

  const hasResults = catalog.requiredSkills.length > 0 || catalog.optionalSkills.length > 0;
  const hasSearchResultsReady = isSearchActive && resultMode === 'search';
  const isWaitingForSearch = isMobileSearchMode && !isSearchActive;
  const showResultsLoading = isWaitingForSearch
    || (isMobileSearchMode && (!hasSearchResultsReady || loading))
    || (showRecommendations && loading && !hasResults);

  const displaySkills = useMemo(
    () => dedupeSkillsByLabel([...catalog.requiredSkills, ...catalog.optionalSkills]),
    [catalog.requiredSkills, catalog.optionalSkills]
  );

  return (
    <Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: { xs: 1, sm: 2 }, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}
      >
        {t(tk('intro'))}
      </Typography>
      <TextField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(tk('searchPlaceholder'))}
        size="small"
        fullWidth
        sx={{ mb: 1 }}
        hiddenLabel
        aria-label={t(tk('searchPlaceholder'))}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t(tk('selectedCount'), { count: selectedNames.size, max: maxSelected })}
      </Typography>
      {selectedLabels.length > 0 && showSelectedOnMobile ? (
        <Box sx={{ mb: 1.25 }}>
          <Typography variant="body1" sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}>
            {t(tk('selectedTitle'))}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {selectedLabels.map((label) => (
              <SkillChip
                key={label}
                label={label}
                skillKey={label}
                selected
                onDelete={(event) => handleToggle(label, event?.currentTarget)}
              />
            ))}
          </Box>
        </Box>
      ) : null}
      <Box sx={resultsPanelSx}>
        {error ? (
          <Alert severity="error" sx={{ mb: 1.25 }} onClose={() => setError('')}>
            {error}
          </Alert>
        ) : null}
        {showResultsLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
            <CircularProgress size={22} />
            <Typography variant="body2" color="text.secondary">
              {t(tk('loading'))}
            </Typography>
          </Box>
        ) : (
          <>
            {loading && showRecommendations ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="caption" color="text.secondary">
                  {t(tk('loading'))}
                </Typography>
              </Box>
            ) : null}
            <Typography variant="body1" sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}>
              {resultsTitle}
            </Typography>
            {!hasResults || (isMobileSearchMode && !hasSearchResultsReady) ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {(isSearchActive || isMobileSearchMode)
                  ? t(tk('noSearchResults'))
                  : t(tk('noRecommendations'))}
              </Typography>
            ) : (
              <SkillChipGroup
                skills={displaySkills}
                selectedNames={selectedNames}
                onToggle={handleToggle}
                maxSelected={maxSelected}
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

export default SkillSelectionStep;
