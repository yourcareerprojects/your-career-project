import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import { useTranslation } from 'react-i18next';

function IdentityBulletsGroup({
  items,
  onItemsChange,
  disabled,
  groupLabel,
  addButtonLabel,
  itemAriaLabel,
  allowRemove = true,
  trailingActions = null,
}) {
  const inputRefs = useRef({});
  const [focusIndex, setFocusIndex] = useState(null);

  useLayoutEffect(() => {
    if (focusIndex == null) return undefined;
    const el = inputRefs.current[focusIndex];
    if (el) {
      el.focus({ preventScroll: true });
    }
    setFocusIndex(null);
    return undefined;
  }, [focusIndex, items.length]);

  const updateItem = useCallback((index, value) => {
    const next = [...items];
    next[index] = value.replace(/\r?\n/g, ' ');
    onItemsChange(next);
  }, [items, onItemsChange]);

  const addItem = useCallback(() => {
    onItemsChange([...items, '']);
    setFocusIndex(items.length);
  }, [items, onItemsChange]);

  const removeItem = useCallback((index) => {
    const next = items.filter((_, idx) => idx !== index);
    onItemsChange(next.length > 0 ? next : ['']);
  }, [items, onItemsChange]);

  const handleItemKeyDown = useCallback((index, event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const nextIndex = index + 1;
    if (nextIndex < items.length) {
      setFocusIndex(nextIndex);
      return;
    }
    onItemsChange([...items, '']);
    setFocusIndex(nextIndex);
  }, [items, onItemsChange]);

  return (
    <Box sx={{ mb: groupLabel ? 2 : 0 }}>
      {groupLabel ? (
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {groupLabel}
        </Typography>
      ) : null}
      {items.map((item, idx) => (
        <Box
          key={`${groupLabel || 'bullet'}-${idx}`}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.5,
            mb: idx < items.length - 1 ? 1.5 : 0,
          }}
        >
          <TextField
            fullWidth
            size="small"
            hiddenLabel
            value={item}
            onChange={(e) => updateItem(idx, e.target.value)}
            onKeyDown={(e) => handleItemKeyDown(idx, e)}
            disabled={disabled}
            inputRef={(el) => {
              if (el) {
                inputRefs.current[idx] = el;
              } else {
                delete inputRefs.current[idx];
              }
            }}
            aria-label={itemAriaLabel ? itemAriaLabel(idx) : undefined}
          />
          {allowRemove ? (
            <IconButton
              aria-label={itemAriaLabel ? `${itemAriaLabel(idx)} remove` : undefined}
              onClick={() => removeItem(idx)}
              disabled={disabled || (items.length <= 1 && !String(item || '').trim())}
              size="small"
              sx={{ mt: 0.25 }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          ) : null}
        </Box>
      ))}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          mt: 1,
        }}
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={addItem}
          disabled={disabled}
        >
          {addButtonLabel}
        </Button>
        {trailingActions}
      </Box>
    </Box>
  );
}

/**
 * Bullet-style identity editor matching manual profile fill (outlined box per bullet).
 */
const ProfileIdentityFieldEditor = ({
  fieldKey,
  draft,
  onDraftChange,
  disabled = false,
  onRestartCoachingChat,
}) => {
  const { t } = useTranslation('onboarding');

  const restartCoachingButton = onRestartCoachingChat ? (
    <Button
      size="small"
      variant="outlined"
      startIcon={<ReplayIcon />}
      onClick={onRestartCoachingChat}
      disabled={disabled}
    >
      {t('profilePage.actions.restartCoachingChat')}
    </Button>
  ) : null;

  if (!draft) return null;

  if (draft.kind === 'dual') {
    const primaryLabel = fieldKey === 'workEnvironmentFit'
      ? t('workEnvironmentCoaching.summary.workStylesHeading')
      : t('workingLifeAchievementCoaching.summary.careerGoalsHeading');
    const secondaryLabel = fieldKey === 'workEnvironmentFit'
      ? t('workEnvironmentCoaching.summary.workEnvironmentsHeading')
      : t('workingLifeAchievementCoaching.summary.prioritiesHeading');
    const addPrimaryLabel = fieldKey === 'workEnvironmentFit'
      ? t('profilePage.identityBullets.addWorkStyle')
      : t('profilePage.identityBullets.addCareerGoal');
    const addSecondaryLabel = fieldKey === 'workEnvironmentFit'
      ? t('profilePage.identityBullets.addWorkEnvironment')
      : t('profilePage.identityBullets.addPriority');

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <IdentityBulletsGroup
          items={draft.primary}
          onItemsChange={(primary) => onDraftChange({ ...draft, primary })}
          disabled={disabled}
          groupLabel={primaryLabel}
          addButtonLabel={addPrimaryLabel}
          itemAriaLabel={(index) => `${primaryLabel} ${index + 1}`}
        />
        <IdentityBulletsGroup
          items={draft.secondary}
          onItemsChange={(secondary) => onDraftChange({ ...draft, secondary })}
          disabled={disabled}
          groupLabel={secondaryLabel}
          addButtonLabel={addSecondaryLabel}
          itemAriaLabel={(index) => `${secondaryLabel} ${index + 1}`}
          trailingActions={restartCoachingButton}
        />
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <IdentityBulletsGroup
        items={draft.items}
        onItemsChange={(items) => onDraftChange({ kind: 'bullets', items })}
        disabled={disabled}
        addButtonLabel={t('profilePage.identityBullets.addBullet')}
        itemAriaLabel={(index) => t('profilePage.identityBullets.itemLabel', { index: index + 1 })}
        trailingActions={restartCoachingButton}
      />
    </Paper>
  );
};

export default ProfileIdentityFieldEditor;
