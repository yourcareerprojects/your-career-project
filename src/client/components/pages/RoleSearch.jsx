import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
} from '@mui/material';
import { Search as SearchIcon, ArrowForward as ArrowForwardIcon } from '@mui/icons-material';
import { useDebounce } from '../../hooks/useDebounce';
import { useOccupationSearch } from '../../hooks/useOccupationSearch';

const RoleSearch = () => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const searchQuery = useOccupationSearch(debouncedQuery);

  const trimmed = debouncedQuery.trim();
  const showMinLengthHint = query.trim().length > 0 && trimmed.length < 2;
  const showEmpty = trimmed.length >= 2 && !searchQuery.isLoading && !searchQuery.isError && (searchQuery.data?.length ?? 0) === 0;
  const results = searchQuery.data ?? [];

  const handleSelect = (escoId) => {
    navigate(`/role/${encodeURIComponent(escoId)}`);
  };

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" component="h1" gutterBottom>
        {t('roleSearch.pageTitle')}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        {t('roleSearch.subtitle')}
      </Typography>

      <Paper sx={{ p: 2, mb: 3 }}>
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
            endAdornment: searchQuery.isFetching ? (
              <InputAdornment position="end">
                <CircularProgress size={20} />
              </InputAdornment>
            ) : null,
          }}
          inputProps={{
            'aria-label': t('roleSearch.searchPlaceholder'),
          }}
        />
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

                return (
                  <ListItemButton
                    key={result.escoId}
                    onClick={() => handleSelect(result.escoId)}
                    divider
                    sx={{ py: 1.5 }}
                  >
                    <ListItemText
                      primary={result.title}
                      secondary={
                        <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                          {matchedHint && (
                            <Typography component="span" variant="caption" color="text.secondary" display="block">
                              {matchedHint}
                            </Typography>
                          )}
                          {synonyms.length > 0 && (
                            <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
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
