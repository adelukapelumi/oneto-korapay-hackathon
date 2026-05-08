// Design tokens extracted from design-reference-jsx/
// Source of truth for colors, typography, spacing, radii, shadows.

// ─── Colors ────────────────────────────────────────────────────────────────

export const colors = {
  // Shared across themes
  primary: '#20E698',
  primaryText: '#001C3D',
  secondary: '#FFB800',
  error: '#FF4757',

  dark: {
    bg: '#001C3D',
    bgAlt: '#002B5C',
    card: '#0A2E55',
    cardAlt: '#0D3461',
    text: '#FFFFFF',
    textSec: '#8BA3C0',
    textMut: '#5A7A9B',
    border: 'rgba(255,255,255,0.13)',
    borderSolid: '#1E3A5F',
    inputBg: 'rgba(255,255,255,0.07)',
    keyBg: '#0D3461',
    overlay: 'rgba(0,20,50,0.85)',
  },

  light: {
    bg: '#F7F5F0',
    bgAlt: '#EEEBE4',
    card: '#FFFFFF',
    cardAlt: '#F7F5F0',
    text: '#001C3D',
    textSec: '#5A6B7F',
    textMut: '#8896A6',
    border: '#1a1a1a',
    borderSolid: '#1a1a1a',
    inputBg: '#FFFFFF',
    keyBg: '#FFFFFF',
    overlay: 'rgba(0,0,0,0.6)',
  },
} as const;

// ─── Typography ────────────────────────────────────────────────────────────

export const fonts = {
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
  pixel: 'PressStart2P_400Regular',
} as const;

export const fontSizes = {
  xs: 11,
  sm: 12,
  caption: 13,
  body: 14,
  bodyLg: 15,
  input: 16,
  button: 16,
  sectionTitle: 16,
  headerTitle: 18,
  cardTitle: 18,
  h3: 20,
  h2: 26,
  h2Lg: 28,
  h1: 32,
  balance: 36,
  balanceLg: 40,
  numPad: 26,
  otpInput: 22,
  logo: 60,
} as const;

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

export const pixelFontSizes = {
  xs: 6,
  sm: 7,
  md: 8,
  lg: 10,
} as const;

// ─── Spacing ───────────────────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 60,

  screenHorizontal: 24,
  screenTop: 20,
  cardPad: 16,
  cardPadLg: 20,
  sectionGap: 28,
} as const;

// ─── Border Radii ──────────────────────────────────────────────────────────

export const radii = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  pill: 50,
  full: 9999,
} as const;

// ─── Borders ───────────────────────────────────────────────────────────────

export const borders = {
  thin: 1.5,
  medium: 2,
  standard: 2.5,
  thick: 3,
} as const;

// ─── Shadows (neumorphic / neo-brutalist) ──────────────────────────────────

export const shadows = {
  neu: {
    dark: {
      shadowColor: '#000000',
      shadowOffset: { width: 4, height: 4 },
      shadowOpacity: 0.45,
      shadowRadius: 0,
      elevation: 4,
    },
    light: {
      shadowColor: '#1a1a1a',
      shadowOffset: { width: 4, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 0,
      elevation: 4,
    },
  },
  glow: {
    shadowColor: '#20E698',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
} as const;

// ─── Component Dimensions ──────────────────────────────────────────────────

export const dimensions = {
  button: {
    height: 52,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  input: {
    height: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  otpCell: {
    width: 46,
    height: 54,
  },
  numPadKey: {
    size: 72,
  },
  numPadGap: {
    row: 14,
    col: 22,
  },
  pinDot: {
    size: 20,
    gap: 18,
  },
  headerBackButton: {
    size: 36,
  },
  headerMinHeight: 48,
  txnIcon: {
    size: 42,
  },
  settingsAvatar: {
    size: 72,
  },
} as const;

// ─── Animation Durations ───────────────────────────────────────────────────

export const durations = {
  fast: 150,
  normal: 300,
  slow: 500,
  screenTransition: 320,
} as const;

// ─── Theme Helper ──────────────────────────────────────────────────────────

export type ThemeMode = 'dark' | 'light';

export interface Theme {
  mode: ThemeMode;
  bg: string;
  bgAlt: string;
  card: string;
  cardAlt: string;
  text: string;
  textSec: string;
  textMut: string;
  border: string;
  borderSolid: string;
  inputBg: string;
  keyBg: string;
  overlay: string;
  primary: string;
  primaryText: string;
  secondary: string;
  error: string;
  shadow: typeof shadows.neu.dark | typeof shadows.neu.light;
}

export function getTheme(mode: ThemeMode): Theme {
  const palette = mode === 'dark' ? colors.dark : colors.light;
  return {
    mode,
    ...palette,
    primary: colors.primary,
    primaryText: colors.primaryText,
    secondary: colors.secondary,
    error: colors.error,
    shadow: mode === 'dark' ? shadows.neu.dark : shadows.neu.light,
  };
}
