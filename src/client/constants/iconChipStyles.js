/** Shared outlined chip styling for icon chips (skills, skill domains, industry sectors). */
export const ICON_CHIP_BASE_SX = {
  color: '#111',
  borderColor: '#111',
  backgroundColor: '#fff',
  height: 'auto',
  minHeight: 40,
  px: 0.5,
  py: 0.5,
  borderRadius: '999px',
  '& .MuiChip-label': {
    px: 1.25,
    py: 0.5,
    fontWeight: 500,
    fontSize: '0.9375rem',
    lineHeight: 1.35,
    color: '#111',
    whiteSpace: 'normal',
  },
  '& .MuiChip-icon': {
    ml: 1,
    mr: -0.25,
    fontSize: 22,
  },
  '& .MuiChip-deleteIcon': {
    color: '#111',
    fontSize: 20,
    '&:hover': {
      color: '#000',
    },
  },
};

export const ICON_CHIP_SELECTED_SX = {
  backgroundColor: '#e9ecef',
  borderWidth: 2.5,
  borderColor: '#111',
  boxShadow: '0 0 0 1px #111',
  transform: 'translateY(-1px)',
};

/** Outlined role-detail chips (skills, domains, alt titles) — label wraps instead of ellipsis. */
export const WRAP_CHIP_LABEL_SX = {
  height: 'auto',
  maxWidth: { xs: '100%', sm: 'none' },
  alignSelf: 'flex-start',
  overflow: 'visible',
  '&.MuiChip-sizeSmall': {
    height: 'auto',
  },
  '& .MuiChip-label': {
    display: 'block',
    px: 1.25,
    py: 0.5,
    whiteSpace: 'normal',
    overflow: 'visible',
    textOverflow: 'clip',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
    lineHeight: 1.35,
    textAlign: 'left',
  },
};
