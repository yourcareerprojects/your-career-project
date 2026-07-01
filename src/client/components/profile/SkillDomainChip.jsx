import React from 'react';
import SkillChip from './SkillChip';

/**
 * Skill domain chip with contextual icon (styled like skill and industry sector chips).
 */
export default function SkillDomainChip({
  label,
  domainKey,
  selected = false,
  disabled = false,
  onClick,
  onDelete,
  sx,
  ...chipProps
}) {
  return (
    <SkillChip
      label={label}
      skillKey={domainKey}
      selected={selected}
      disabled={disabled}
      onClick={onClick}
      onDelete={onDelete}
      sx={sx}
      {...chipProps}
    />
  );
}
