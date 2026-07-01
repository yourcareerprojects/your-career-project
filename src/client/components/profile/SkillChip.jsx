import React, { memo } from 'react';
import { Chip } from '@mui/material';
import { SkillIcon } from '../../constants/skillIcons';
import { ICON_CHIP_BASE_SX, ICON_CHIP_SELECTED_SX } from '../../constants/iconChipStyles';

/**
 * Skill picker chip with contextual icon (styled like industry sector chips).
 */
function SkillChip({
  label,
  skillKey,
  selected = false,
  disabled = false,
  onClick,
  onDelete,
  sx,
  ...chipProps
}) {
  const trimmedLabel = String(label || '').trim();
  if (!trimmedLabel) return null;

  const resolvedKey = skillKey || trimmedLabel;

  return (
    <Chip
      icon={<SkillIcon skillKey={resolvedKey} skillLabel={trimmedLabel} />}
      label={trimmedLabel}
      clickable={Boolean(onClick)}
      onClick={onClick}
      onDelete={onDelete}
      disabled={disabled}
      variant="outlined"
      aria-pressed={selected}
      sx={{
        ...ICON_CHIP_BASE_SX,
        ...(selected ? ICON_CHIP_SELECTED_SX : {}),
        ...(disabled
          ? {
              opacity: 0.55,
            }
          : {}),
        ...sx,
      }}
      {...chipProps}
    />
  );
}

export default memo(SkillChip);
