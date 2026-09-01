import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import { PUZZLE_CATEGORIES } from '../../../constants/puzzleCategories';
import { localizedPuzzleText } from '../../hooks/useCareerPuzzleQueries';
import { baseUILanguage } from '../../hooks/useProfileQueries';
import { useDebounce } from '../../hooks/useDebounce';
import { useOccupationSearch } from '../../hooks/useOccupationSearch';
import { extractFirstSentence } from '../../utils/splitDescriptionIntoParagraphs';
import { getRoleTitleForLocale } from '../../utils/roleTitleDisplay';

const LABEL_SX = {
  color: '#950202',
  fontWeight: 600,
  mb: 1,
  lineHeight: 1.35,
};

const FIELD_GAP = 2.5;

function buildMonthOptions(t) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return {
      value: String(month),
      label: t(`careerPuzzle.editDialog.months.${month}`),
    };
  });
}

function buildYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = currentYear + 3; year >= 1950; year -= 1) {
    years.push(String(year));
  }
  return years;
}

function emptyForm() {
  return {
    category: '',
    title: '',
    description: '',
    endMonth: '',
    endYear: '',
  };
}

function initialFormFromNode(node, lang) {
  if (!node) return emptyForm();
  const category = node?.snapshot?.category || node?.piece?.category || '';
  const title =
    localizedPuzzleText(node?.snapshot?.title, lang) ||
    localizedPuzzleText(node?.piece?.title, lang) ||
    '';
  const description =
    localizedPuzzleText(node?.snapshot?.shortDescription, lang) ||
    localizedPuzzleText(node?.piece?.shortDescription, lang) ||
    '';
  const endDate = node?.snapshot?.endDate || null;
  const month =
    endDate?.month != null && endDate?.month !== ''
      ? String(endDate.month)
      : '';
  const year =
    endDate?.year != null && endDate?.year !== ''
      ? String(endDate.year)
      : '';

  return {
    category,
    title,
    description,
    endMonth: month,
    endYear: year,
  };
}

async function lookupOccupation(escoId, lang) {
  const qs = new URLSearchParams({ escoId, lang });
  const res = await fetch(`/api/occupations/lookup?${qs.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success || !data.occupation) {
    throw new Error(data.error || 'Role lookup failed');
  }
  return data.occupation;
}

/**
 * Edit/create dialog for locked profile puzzle pieces — matches profile review field styling.
 * @param {{
 *   open: boolean,
 *   node?: object|null,
 *   mode?: 'edit'|'create',
 *   saving?: boolean,
 *   canDelete?: boolean,
 *   deleting?: boolean,
 *   onClose: () => void,
 *   onSave: (payload: {
 *     category: string,
 *     title: string,
 *     shortDescription: string,
 *     endDate: {month: number, year: number}|null,
 *   }) => void|Promise<void>,
 *   onDelete?: () => void,
 * }} props
 */
export default function PuzzlePieceEditDialog({
  open,
  node = null,
  mode = 'edit',
  saving = false,
  canDelete = false,
  deleting = false,
  onClose,
  onSave,
  onDelete,
}) {
  const { t } = useTranslation(['dashboard', 'onboarding']);
  const lang = baseUILanguage();
  const isCreate = mode === 'create';
  const [form, setForm] = useState(() =>
    isCreate ? emptyForm() : initialFormFromNode(node, lang)
  );
  const [fieldErrors, setFieldErrors] = useState({});
  const [roleQuery, setRoleQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);
  const [roleLookupLoading, setRoleLookupLoading] = useState(false);
  const [roleLookupError, setRoleLookupError] = useState('');

  const monthOptions = useMemo(() => buildMonthOptions(t), [t]);
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const nodeKey = node?.instanceId || '';
  const isOccupation = form.category === 'occupation';
  const busy = saving || deleting || roleLookupLoading;
  const debouncedRoleQuery = useDebounce(roleQuery, 300);
  const roleSearchQuery = useOccupationSearch(debouncedRoleQuery, {
    enabled: open && isOccupation,
    limit: 12,
  });
  const roleOptions = roleSearchQuery.data || [];

  useEffect(() => {
    if (!open) return;
    setForm(isCreate ? emptyForm() : initialFormFromNode(node, lang));
    setFieldErrors({});
    setRoleQuery('');
    setSelectedRole(null);
    setRoleLookupError('');
    setRoleLookupLoading(false);
  }, [open, nodeKey, lang, node, isCreate]);

  useEffect(() => {
    if (isOccupation) return;
    setRoleQuery('');
    setSelectedRole(null);
    setRoleLookupError('');
  }, [isOccupation]);

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (next[field]) delete next[field];
      if ((field === 'endMonth' || field === 'endYear') && next.endDate) {
        delete next.endDate;
      }
      return next;
    });
  };

  const handleRoleSelect = async (_event, value) => {
    setSelectedRole(value);
    setRoleLookupError('');
    if (!value?.escoId) return;

    setRoleLookupLoading(true);
    try {
      const occupation = await lookupOccupation(value.escoId, lang);
      const title = getRoleTitleForLocale(occupation.title, lang).slice(0, 200);
      const description = extractFirstSentence(
        getRoleTitleForLocale(occupation.description, lang)
      ).slice(0, 1000);
      setForm((prev) => ({
        ...prev,
        title,
        description,
      }));
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.title;
        return next;
      });
    } catch {
      setRoleLookupError(t('careerPuzzle.editDialog.errors.roleLookupFailed'));
    } finally {
      setRoleLookupLoading(false);
    }
  };

  const validate = () => {
    const errs = {};
    if (!String(form.category || '').trim()) {
      errs.category = t('careerPuzzle.editDialog.errors.categoryRequired');
    }
    if (!String(form.title || '').trim()) {
      errs.title = t('careerPuzzle.editDialog.errors.titleRequired');
    }
    const hasMonth = Boolean(form.endMonth);
    const hasYear = Boolean(form.endYear);
    if (hasMonth !== hasYear) {
      errs.endDate = t('careerPuzzle.editDialog.errors.endDateIncomplete');
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleClose = () => {
    if (busy) return;
    onClose?.();
  };

  const handleSave = async () => {
    if (busy || !validate()) return;
    const trimmedTitle = form.title.trim();
    const trimmedDescription = form.description.trim();
    const endDate =
      form.endMonth && form.endYear
        ? { month: Number(form.endMonth), year: Number(form.endYear) }
        : null;

    await onSave?.({
      category: form.category,
      title: trimmedTitle,
      shortDescription: trimmedDescription,
      endDate,
    });
  };

  const handleDelete = () => {
    if (busy || !canDelete || !onDelete) return;
    onDelete();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pr: 1,
        }}
      >
        {isCreate
          ? t('careerPuzzle.editDialog.createTitle')
          : t('careerPuzzle.editDialog.title')}
        <IconButton
          onClick={handleClose}
          disabled={busy}
          aria-label={t('careerPuzzle.editDialog.closeAria')}
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: FIELD_GAP, pt: 0.5 }}>
          <Box>
            <Typography variant="body1" component="label" htmlFor="puzzle-edit-category" sx={LABEL_SX}>
              {t('careerPuzzle.editDialog.categoryLabel')}
            </Typography>
            <TextField
              id="puzzle-edit-category"
              select
              fullWidth
              hiddenLabel
              value={form.category}
              onChange={handleChange('category')}
              disabled={busy}
              error={Boolean(fieldErrors.category)}
              helperText={fieldErrors.category || undefined}
            >
              {PUZZLE_CATEGORIES.map((category) => (
                <MenuItem key={category} value={category}>
                  {t(`careerPuzzle.categories.${category}`, {
                    defaultValue: category.replace(/_/g, ' '),
                  })}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <Box>
            <Typography variant="body1" component="label" htmlFor="puzzle-edit-title" sx={LABEL_SX}>
              {t('careerPuzzle.editDialog.titleLabel')}
            </Typography>
            <TextField
              id="puzzle-edit-title"
              fullWidth
              hiddenLabel
              value={form.title}
              onChange={handleChange('title')}
              disabled={busy}
              error={Boolean(fieldErrors.title)}
              helperText={fieldErrors.title || undefined}
              inputProps={{ maxLength: 200 }}
            />
          </Box>

          <Box>
            <Typography
              variant="body1"
              component="label"
              htmlFor="puzzle-edit-description"
              sx={LABEL_SX}
            >
              {t('careerPuzzle.editDialog.descriptionLabel')}
            </Typography>
            <TextField
              id="puzzle-edit-description"
              fullWidth
              hiddenLabel
              multiline
              minRows={3}
              value={form.description}
              onChange={handleChange('description')}
              disabled={busy}
              inputProps={{ maxLength: 1000 }}
            />
          </Box>

          {isOccupation ? (
            <Box>
              <Typography
                variant="body1"
                component="label"
                htmlFor="puzzle-edit-role-search"
                sx={LABEL_SX}
              >
                {t('careerPuzzle.editDialog.roleSearchLabel')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('careerPuzzle.editDialog.roleSearchHint')}
              </Typography>
              <Autocomplete
                id="puzzle-edit-role-search"
                options={roleOptions}
                value={selectedRole}
                inputValue={roleQuery}
                onInputChange={(_event, value) => {
                  setRoleQuery(value);
                }}
                onChange={handleRoleSelect}
                getOptionLabel={(option) => option?.title || ''}
                isOptionEqualToValue={(option, value) =>
                  Boolean(option?.escoId) && option.escoId === value?.escoId
                }
                filterOptions={(options) => options}
                loading={roleSearchQuery.isFetching || roleLookupLoading}
                disabled={busy}
                noOptionsText={
                  debouncedRoleQuery.trim().length < 2
                    ? t('roleSearch.minLengthHint')
                    : t('roleSearch.emptyTitle')
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    hiddenLabel
                    placeholder={t('careerPuzzle.editDialog.roleSearchPlaceholder')}
                    error={Boolean(roleLookupError)}
                    helperText={roleLookupError || undefined}
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <>
                          <SearchIcon color="action" sx={{ ml: 0.5, mr: 0.5 }} />
                          {params.InputProps.startAdornment}
                        </>
                      ),
                      endAdornment: (
                        <>
                          {roleSearchQuery.isFetching || roleLookupLoading ? (
                            <CircularProgress color="inherit" size={18} />
                          ) : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
            </Box>
          ) : null}

          <Box>
            <Typography variant="body1" component="div" sx={LABEL_SX}>
              {t('careerPuzzle.editDialog.endDateLabel')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('careerPuzzle.editDialog.endDateHint')}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                gap: 1.5,
              }}
            >
              <TextField
                select
                fullWidth
                hiddenLabel
                value={form.endMonth}
                onChange={handleChange('endMonth')}
                disabled={busy}
                error={Boolean(fieldErrors.endDate)}
                SelectProps={{ displayEmpty: true }}
              >
                <MenuItem value="">
                  {t('careerPuzzle.editDialog.monthPlaceholder')}
                </MenuItem>
                {monthOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                hiddenLabel
                value={form.endYear}
                onChange={handleChange('endYear')}
                disabled={busy}
                error={Boolean(fieldErrors.endDate)}
                helperText={fieldErrors.endDate || undefined}
                SelectProps={{ displayEmpty: true }}
              >
                <MenuItem value="">
                  {t('careerPuzzle.editDialog.yearPlaceholder')}
                </MenuItem>
                {yearOptions.map((year) => (
                  <MenuItem key={year} value={year}>
                    {year}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          py: 2,
          justifyContent: canDelete ? 'space-between' : 'flex-end',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        {canDelete ? (
          <Button color="error" onClick={handleDelete} disabled={busy}>
            {t('careerPuzzle.editDialog.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          <Button onClick={handleClose} disabled={busy}>
            {t('profilePage.actions.cancel', { ns: 'onboarding' })}
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            color="primary"
            disabled={
              busy ||
              !String(form.title || '').trim() ||
              !form.category
            }
          >
            {saving ? (
              <CircularProgress size={20} />
            ) : (
              t('profilePage.actions.save', { ns: 'onboarding' })
            )}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
