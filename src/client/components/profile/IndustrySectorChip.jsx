import React from 'react';
import { Box, Chip } from '@mui/material';
import { resolveIndustryDisplayLabel, resolveIndustryId } from '../../../constants/industries';
import { IndustrySectorIcon } from '../../constants/industrySectorIcons';
import { ICON_CHIP_BASE_SX } from '../../constants/iconChipStyles';

export function IndustrySectorOptionLabel({ industryId, label }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: label ? 1 : 0 }}>
      <IndustrySectorIcon industryId={industryId} fontSize="small" />
      {label ? <span>{label}</span> : null}
    </Box>
  );
}

/**
 * Read-only or picker chip for a stored industry domain value.
 */
export default function IndustrySectorChip({
  value,
  lang = 'en',
  industryId: industryIdProp,
  color,
  variant = 'outlined',
  legacy = false,
  sx,
  ...chipProps
}) {
  const label = resolveIndustryDisplayLabel(value, lang) || String(value || '').trim();
  const industryId = industryIdProp ?? resolveIndustryId(value);

  return (
    <Chip
      icon={<IndustrySectorIcon industryId={industryId} />}
      label={label}
      color={color}
      variant={variant}
      sx={{
        ...ICON_CHIP_BASE_SX,
        ...(legacy
          ? {
              borderStyle: 'dashed',
            }
          : {}),
        ...sx,
      }}
      {...chipProps}
    />
  );
}
