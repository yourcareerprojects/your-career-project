import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  Paper,
  List,
  ListItemButton,
  ListItemText,
  CircularProgress,
  Alert,
  Chip,
  InputAdornment,
  IconButton,
  Autocomplete,
} from '@mui/material';
import {
  Search as SearchIcon,
  ArrowForward as ArrowForwardIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useDebounce } from '../../hooks/useDebounce';
import { useOccupationSearch } from '../../hooks/useOccupationSearch';
import { baseUILanguage } from '../../hooks/useProfileQueries';
import { listIndustryOptions, resolveIndustryDisplayLabel } from '../../../constants/industries';
import IndustrySectorChip, { IndustrySectorOptionLabel } from '../profile/IndustrySectorChip';
import PageHeader from '../common/PageHeader';

const RoleSearch = () => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const lang = baseUILanguage();
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const debouncedQuery = useDebounce(query, 300);
  // Apply text clears immediately so results reset without waiting for debounce.
  const searchText = query.trim() === '' ? '' : debouncedQuery;
  const domainOptions = useMemo(() => listIndustryOptions(lang), [lang]);
  const domainFilter = searchParams.get('domain') || null;
  const domainOption = useMemo(
    () =>
      domainFilter
        ? domainOptions.find((option) => option.value === domainFilter) || null
        : null,
    [domainFilter, domainOptions]
  );
  const searchQuery = useOccupationSearch(searchText, { domain: domainFilter });

  // Keep the last search in the URL so back from role details can restore it.
  useEffect(() => {
    const currentQ = searchParams.get('q') || '';
    if (query === currentQ) return;
    const next = new URLSearchParams(searchParams);
    if (query) next.set('q', query);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [query, searchParams, setSearchParams]);

  const trimmed = searchText.trim();
  const hasActiveSearch = trimmed.length >= 2 || Boolean(domainFilter);
  const showMinLengthHint =
    !domainFilter && query.trim().length > 0 && trimmed.length < 2;
  const showEmpty =
    hasActiveSearch &&
    !searchQuery.isLoading &&
    !searchQuery.isFetching &&
    !searchQuery.isError &&
    (searchQuery.data?.length ?? 0) === 0;
  // Never show stale rows once both filters are cleared.
  const results = hasActiveSearch ? (searchQuery.data ?? []) : [];

  const handleDomainChange = (_event, next) => {
    const params = new URLSearchParams(searchParams);
    if (next?.value) params.set('domain', next.value);
    else params.delete('domain');
    setSearchParams(params, { replace: true });
  };

  const handleClearQuery = () => {
    setQuery('');
  };

  const handleSelect = (escoId) => {
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/role/${encodeURIComponent(escoId)}`, { state: { returnTo } });
  };

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: 3 }}>
      <PageHeader title={t('roleSearch.pageTitle')} description={t('roleSearch.subtitle')} />

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 2,
            alignItems: { sm: 'flex-start' },
          }}
        >
          <TextField
            fullWidth
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('roleSearch.searchPlaceholder')}
            autoFocus
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  {searchQuery.isFetching && (
                    <CircularProgress size={20} sx={{ mr: query ? 0.5 : 0 }} />
                  )}
                  {query ? (
                    <IconButton
                      size="small"
                      aria-label={t('roleSearch.actions.clearSearch')}
                      onClick={handleClearQuery}
                      edge="end"
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  ) : null}
                </InputAdornment>
              ),
            }}
            inputProps={{
              'aria-label': t('roleSearch.searchPlaceholder'),
            }}
          />
          <Autocomplete
            sx={{ width: { xs: '100%', sm: 280 }, flexShrink: 0 }}
            options={domainOptions}
            value={domainOption}
            onChange={handleDomainChange}
            getOptionLabel={(option) => option?.label || ''}
            isOptionEqualToValue={(option, value) => option?.value === value?.value}
            clearOnEscape
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <IndustrySectorOptionLabel industryId={option.id} label={option.label} />
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('roleSearch.domainFilterLabel')}
                placeholder={t('roleSearch.domainFilterPlaceholder')}
              />
            )}
          />
        </Box>
      </Paper>

      {showMinLengthHint && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('roleSearch.minLengthHint')}
        </Typography>
      )}

      {searchQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('roleSearch.errors.searchFailed')}
        </Alert>
      )}

      {showEmpty && (
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            {t('roleSearch.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('roleSearch.emptySubtitle')}
          </Typography>
        </Paper>
      )}

      {results.length > 0 && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('roleSearch.resultsFound', { count: results.length })}
          </Typography>
          <Paper>
            <List disablePadding>
              {results.map((result) => {
                const synonyms = Array.isArray(result.synonymsPreview)
                  ? result.synonymsPreview.filter(Boolean)
                  : [];
                const matchedHint =
                  result.matchedBy && result.matchedBy !== 'title' && result.matchedValue
                    ? t('roleSearch.matchedVia', {
                        field: t(`roleSearch.matchedFields.${result.matchedBy}`, {
                          defaultValue: result.matchedBy,
                        }),
                        value: result.matchedValue,
                      })
                    : null;
                const domainLabel = result.domain
                  ? resolveIndustryDisplayLabel(result.domain, lang) || result.domain
                  : null;

                return (
                  <ListItemButton
                    key={result.escoId}
                    onClick={() => handleSelect(result.escoId)}
                    divider
                    sx={{ py: 1.5 }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                          <Typography component="span" variant="body1">
                            {result.title}
                          </Typography>
                          {domainLabel && result.domain && result.domain !== 'UNASSIGNED' && (
                            <IndustrySectorChip
                              value={result.domain}
                              lang={lang}
                              size="small"
                              sx={{
                                minHeight: 24,
                                height: 24,
                                px: 0.25,
                                py: 0,
                                '& .MuiChip-label': {
                                  px: 0.75,
                                  py: 0,
                                  fontSize: '0.75rem',
                                  lineHeight: 1.2,
                                  fontWeight: 500,
                                },
                                '& .MuiChip-icon': {
                                  fontSize: 16,
                                  ml: 0.5,
                                  mr: -0.25,
                                },
                              }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box component="span" sx={{ display: 'block', mt: 1.25 }}>
                          {matchedHint && (
                            <Typography component="span" variant="caption" color="text.secondary" display="block">
                              {matchedHint}
                            </Typography>
                          )}
                          {synonyms.length > 0 && (
                            <Box
                              component="span"
                              sx={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 0.75,
                                mt: matchedHint ? 1 : 0,
                              }}
                            >
                              {synonyms.map((syn) => (
                                <Chip key={syn} label={syn} size="small" variant="outlined" />
                              ))}
                            </Box>
                          )}
                        </Box>
                      }
                    />
                    <ArrowForwardIcon color="action" />
                  </ListItemButton>
                );
              })}
            </List>
          </Paper>
        </>
      )}
    </Box>
  );
};

export default RoleSearch;
