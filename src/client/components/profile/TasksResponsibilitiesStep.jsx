import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';
import {
  getProfileStructuredListMaxItems,
  PROFILE_REVIEW_STRUCTURED_MAX,
} from '../../../constants/profileReviewFieldLimits';

function normalizeResponsibilities(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => String(item || ''));
}

/**
 * Manual profile fill: collect tasks and responsibilities as bullet points.
 * @param {{
 *   responsibilities?: string[],
 *   onResponsibilitiesChange: (items: string[]) => void,
 *   maxItems?: number,
 *   fieldErrors?: Record<string, string>,
 * }} props
 */
const TasksResponsibilitiesStep = ({
  responsibilities = [],
  onResponsibilitiesChange,
  maxItems = getProfileStructuredListMaxItems('keyResponsibilities'),
  fieldErrors = {},
}) => {
  const { t } = useTranslation('onboarding');
  const inputRefs = useRef({});
  const [focusIndex, setFocusIndex] = useState(null);
  const items = useMemo(() => {
    const normalized = normalizeResponsibilities(responsibilities);
    return normalized.length > 0 ? normalized : [''];
  }, [responsibilities]);

  const filledCount = items.filter((item) => String(item || '').trim()).length;
  const atLimit = items.length >= maxItems;

  const updateItem = useCallback((index, value) => {
    const next = [...items];
    next[index] = value;
    onResponsibilitiesChange(next);
  }, [items, onResponsibilitiesChange]);

  const addItem = useCallback(() => {
    if (atLimit) return;
    onResponsibilitiesChange([...items, '']);
  }, [atLimit, items, onResponsibilitiesChange]);

  const removeItem = useCallback((index) => {
    const next = items.filter((_, idx) => idx !== index);
    onResponsibilitiesChange(next.length > 0 ? next : ['']);
  }, [items, onResponsibilitiesChange]);

  useLayoutEffect(() => {
    if (focusIndex == null) return undefined;
    const el = inputRefs.current[focusIndex];
    if (el) {
      el.focus({ preventScroll: true });
    }
    setFocusIndex(null);
    return undefined;
  }, [focusIndex, items.length]);

  const handleItemKeyDown = useCallback((index, event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();

    const nextIndex = index + 1;
    if (nextIndex < items.length) {
      setFocusIndex(nextIndex);
      return;
    }
    if (!atLimit) {
      onResponsibilitiesChange([...items, '']);
      setFocusIndex(nextIndex);
    }
  }, [atLimit, items, onResponsibilitiesChange]);

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('tasksResponsibilitiesStep.intro')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('tasksResponsibilitiesStep.count', { count: filledCount, max: maxItems })}
      </Typography>
      {fieldErrors['structuredUserInfo.keyResponsibilities'] && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
          {fieldErrors['structuredUserInfo.keyResponsibilities']}
        </Typography>
      )}
      {items.map((item, idx) => {
        const fieldKey = `structuredUserInfo.keyResponsibilities.${idx}`;
        return (
          <Box
            key={`responsibility-${idx}`}
            sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 1.5 }}
          >
            <TextField
              value={item}
              onChange={(e) => updateItem(idx, e.target.value.replace(/\r?\n/g, ' '))}
              onKeyDown={(e) => handleItemKeyDown(idx, e)}
              placeholder={t('tasksResponsibilitiesStep.placeholder')}
              fullWidth
              size="small"
              hiddenLabel
              error={Boolean(fieldErrors[fieldKey])}
              helperText={fieldErrors[fieldKey]}
              inputProps={{ maxLength: PROFILE_REVIEW_STRUCTURED_MAX.keyResponsibilities }}
              inputRef={(el) => {
                if (el) {
                  inputRefs.current[idx] = el;
                } else {
                  delete inputRefs.current[idx];
                }
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    •
                  </InputAdornment>
                ),
              }}
              aria-label={t('tasksResponsibilitiesStep.itemLabel', { index: idx + 1 })}
            />
            <IconButton
              aria-label={t('tasksResponsibilitiesStep.removeItem')}
              onClick={() => removeItem(idx)}
              disabled={items.length <= 1 && !String(item || '').trim()}
              size="small"
              sx={{ mt: 0.25 }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
      <Button
        size="small"
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={addItem}
        disabled={atLimit}
        title={atLimit ? t('documentUpload.review.maxEntriesTitle', { max: maxItems }) : undefined}
        sx={{ alignSelf: 'flex-start', mt: 0.5 }}
      >
        {t('tasksResponsibilitiesStep.addCta')}
      </Button>
      {atLimit && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {t('documentUpload.review.goodAtLimit', { max: maxItems })}
        </Typography>
      )}
    </Box>
  );
};

export default TasksResponsibilitiesStep;
