import { createTheme } from '@mui/material/styles';

/**
 * MUI `createPalette` augments colors with lighten/darken and cannot parse CSS variables.
 * Keep palette channels as hex/rgba here; they mirror `src/styles/tokens.css` per mode.
 * Custom styling still uses `var(--token)` in `sx` / CSS where needed.
 */

const PALETTE_LIGHT = {
  primary: {
    main: '#1c662a',
    light: '#3aa34e',
    dark: '#0f3d1d',
    contrastText: '#ffffff',
  },
  secondary: {
    main: '#dc004e',
    light: '#ff5983',
    dark: '#9a0036',
    contrastText: '#ffffff',
  },
  success: {
    main: '#4caf50',
    light: '#81c784',
    dark: '#2e7d32',
    contrastText: '#ffffff',
  },
  warning: {
    main: '#ff9800',
    light: '#ffb74d',
    dark: '#f57c00',
    contrastText: 'rgba(0, 0, 0, 0.87)',
  },
  error: {
    main: '#f44336',
    light: '#e57373',
    dark: '#d32f2f',
    contrastText: '#ffffff',
  },
  info: {
    main: '#1c662a',
    light: '#52bb64',
    dark: '#155222',
    contrastText: '#ffffff',
  },
  background: {
    default: '#f5f5f5',
    paper: '#ffffff',
  },
  text: {
    primary: '#212121',
    secondary: '#757575',
  },
  divider: 'rgba(0, 0, 0, 0.12)',
};

const PALETTE_DARK = {
  primary: {
    main: '#8fd99f',
    light: '#b5ecc0',
    dark: '#5cb870',
    contrastText: 'rgba(0, 0, 0, 0.87)',
  },
  secondary: {
    main: '#ff4081',
    light: '#ff79b0',
    dark: '#c60055',
    contrastText: '#ffffff',
  },
  success: {
    main: '#4caf50',
    light: '#81c784',
    dark: '#388e3c',
    contrastText: '#ffffff',
  },
  warning: {
    main: '#ff9800',
    light: '#ffb74d',
    dark: '#f57c00',
    contrastText: 'rgba(0, 0, 0, 0.87)',
  },
  error: {
    main: '#f44336',
    light: '#e57373',
    dark: '#d32f2f',
    contrastText: '#ffffff',
  },
  info: {
    main: '#8fd99f',
    light: '#b5ecc0',
    dark: '#5cb870',
    contrastText: 'rgba(0, 0, 0, 0.87)',
  },
  background: {
    default: '#111827',
    paper: '#273549',
  },
  text: {
    primary: '#f9fafb',
    secondary: '#9ca3af',
  },
  divider: 'rgba(255, 255, 255, 0.12)',
};

export function createAppTheme(mode) {
  const chroma = mode === 'dark' ? PALETTE_DARK : PALETTE_LIGHT;

  return createTheme({
    palette: {
      mode,
      ...chroma,
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      h1: {
        fontSize: '2.5rem',
        fontWeight: 500,
      },
      h2: {
        fontSize: '2rem',
        fontWeight: 500,
      },
      h3: {
        fontSize: '1.75rem',
        fontWeight: 500,
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 8,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            boxShadow: 'var(--shadow-card-md)',
          },
        },
      },
    },
  });
}
