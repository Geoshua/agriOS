/**
 * Design tokens for direction A · Liquid Glass (Coffee Leaf Scanner canvas).
 * Camera screens use dark glass over the live feed; Map, Report and sheets use
 * light glass over paper-grey grounds.
 */

import { StyleSheet, useColorScheme } from 'react-native';
import { Easing, WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

/** Colours that don't change between light and dark mode. */
export const colors = {
  black: '#000000',
  white: '#FFFFFF',

  // Text on the camera scrims (always dark)
  onDark: '#FFFFFF',
  onDarkSecondary: 'rgba(255,255,255,0.85)',

  // Accents
  scanning: '#30D158',
  activeOnDark: '#5BD47E',
  activeOnLight: '#1E7B3C',
  primary: '#1E7B3C',
  locate: '#0A84FF',
  pinHole: '#3A3A3C',
  scrim: 'rgba(0,0,0,0.72)',
  chipScrim: 'rgba(0,0,0,0.66)',
};

export type Scheme = 'light' | 'dark';

/** Surface palette per appearance (iOS system colours). */
export const palettes = {
  light: {
    label: '#000000',
    labelStrong: '#1C1C1E',
    labelSecondary: '#3A3A3C',
    labelTertiary: '#6C6C70',
    separator: '#E5E5EA',
    fill: 'rgba(120,120,128,0.16)',
    fillStrong: 'rgba(120,120,128,0.2)',
    groundGrouped: '#F2F2F7',
    groundMap: '#EDEFE8',
    card: '#FFFFFF',
    sheetGlass: 'rgba(250,250,252,0.62)',
    popover: 'rgba(250,250,252,0.86)',
    tag: 'rgba(255,255,255,0.9)',
    voiceButton: '#1D1D1F',
    voiceIcon: '#FFFFFF',
    waveIdle: '#C7C7CC',
    waveActive: '#1D1D1F',
    checkBorder: '#AEAEB2',
    numberBadge: '#E5E5EA',
    emptyArt: '#E5E5EA',
    statUrgent: '#A3130B',
    statHealthy: '#17652B',
    gps: '#17652B',
    /** Green for small text/links (≥4.5:1 on cards). */
    accentText: '#1E7B3C',
  },
  dark: {
    label: '#FFFFFF',
    labelStrong: '#F2F2F7',
    labelSecondary: 'rgba(235,235,245,0.75)',
    labelTertiary: 'rgba(235,235,245,0.55)',
    separator: '#38383A',
    fill: 'rgba(120,120,128,0.32)',
    fillStrong: 'rgba(120,120,128,0.36)',
    groundGrouped: '#000000',
    groundMap: '#101311',
    card: '#1C1C1E',
    sheetGlass: 'rgba(30,30,32,0.62)',
    popover: 'rgba(44,44,46,0.88)',
    tag: 'rgba(28,28,30,0.88)',
    voiceButton: '#F2F2F7',
    voiceIcon: '#000000',
    waveIdle: '#48484A',
    waveActive: '#F2F2F7',
    checkBorder: '#636366',
    numberBadge: '#3A3A3C',
    emptyArt: '#1C1C1E',
    statUrgent: '#FF6961',
    statHealthy: '#30D158',
    gps: '#30D158',
    accentText: '#4CD27A',
  },
};

export type Palette = (typeof palettes)['light'];

export const glass = {
  dark: {
    fill: 'rgba(24,24,26,0.34)',
    highlight: 0.18,
    rimTop: 'rgba(255,255,255,0.5)',
    rim: 'rgba(255,255,255,0.22)',
    rimBottom: 'rgba(255,255,255,0.12)',
    shadowOpacity: 0.24,
    lens: 'rgba(255,255,255,0.2)',
    lensEdge: 'rgba(255,255,255,0.35)',
    active: '#5BD47E',
    idle: '#FFFFFF',
    text: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.85)',
    divider: 'rgba(255,255,255,0.18)',
    pin: '#FFFFFF',
    pinHole: '#3A3A3C',
    searching: 'rgba(255,255,255,0.12)',
  },
  light: {
    fill: 'rgba(250,250,252,0.5)',
    highlight: 0.55,
    rimTop: 'rgba(255,255,255,0.95)',
    rim: 'rgba(0,0,0,0.08)',
    rimBottom: 'rgba(0,0,0,0.08)',
    shadowOpacity: 0.12,
    lens: 'rgba(0,0,0,0.06)',
    lensEdge: 'rgba(255,255,255,0.8)',
    active: '#1E7B3C',
    idle: '#1C1C1E',
    text: '#000000',
    textSecondary: 'rgba(60,60,67,0.85)',
    divider: 'rgba(60,60,67,0.18)',
    pin: '#1C1C1E',
    pinHole: '#FFFFFF',
    searching: 'rgba(0,0,0,0.08)',
  },
};

export type GlassTone = keyof typeof glass;

// ── Severity ──────────────────────────────────────────────────────────────────

/** Bright status discs on dark glass (camera). */
export const severityOnDark: Record<string, string> = {
  high: '#FF453A',
  medium: '#FF9F0A',
  low: '#FFD60A',
  none: '#30D158',
  unknown: '#8E8E93',
};

/** Map pins and list dots on light surfaces. */
export const severityPin: Record<string, string> = {
  high: '#D70015',
  medium: '#D86A00',
  low: '#FFC400',
  none: '#248A3D',
  unknown: '#8E8E93',
};

/** Solid chips ("Act within 3 days") on sheets. */
export const severityChip: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#C4170C', fg: '#FFFFFF' },
  medium: { bg: '#C4570A', fg: '#FFFFFF' },
  low: { bg: '#C99A06', fg: '#111827' },
  none: { bg: '#248A3D', fg: '#FFFFFF' },
  unknown: { bg: '#6B7280', fg: '#FFFFFF' },
};

/** Count badges in the report, per appearance. */
export const severityBadge: Record<Scheme, Record<string, { bg: string; fg: string }>> = {
  light: {
    high: { bg: '#FDE3E1', fg: '#A3130B' },
    medium: { bg: '#FDEBD9', fg: '#8F3F00' },
    low: { bg: '#FFF4CC', fg: '#6E5300' },
    none: { bg: '#DDF3E3', fg: '#17652B' },
    unknown: { bg: '#E5E5EA', fg: '#1C1C1E' },
  },
  dark: {
    high: { bg: 'rgba(255,69,58,0.22)', fg: '#FF6961' },
    medium: { bg: 'rgba(255,159,10,0.22)', fg: '#FFB340' },
    low: { bg: 'rgba(255,214,10,0.2)', fg: '#FFD60A' },
    none: { bg: 'rgba(48,209,88,0.2)', fg: '#30D158' },
    unknown: { bg: 'rgba(142,142,147,0.26)', fg: '#D1D1D6' },
  },
};

/** Health heat-map ramp, cool (healthy) → warm (urgent). */
export const heat: Record<string, string> = {
  none: '#2A9D8F',
  low: '#F2C14E',
  medium: '#E07B28',
  high: '#B3261E',
  unknown: '#9A9A9A',
};

export const severityLabel: Record<string, string> = {
  high: 'Urgent',
  medium: 'Watch',
  low: 'Monitor',
  none: 'Healthy',
  unknown: 'Unsure',
};

/** Long form for sheets. */
export const severityAction: Record<string, string> = {
  high: 'Act within 3 days',
  medium: 'Act within a week',
  low: 'Keep an eye on it',
  none: 'All clear',
  unknown: 'Ask your extension officer',
};

/** Short form for the detection pill. */
export const severityShort: Record<string, string> = {
  high: 'act within 3 days',
  medium: 'act within a week',
  low: 'keep an eye on it',
  none: 'all clear',
  unknown: 'ask an officer',
};

export const severityTiny: Record<string, string> = {
  high: '3 days',
  medium: '1 week',
  low: 'monitor',
  none: 'all clear',
  unknown: 'unsure',
};

export function severityGlyph(severity: string): 'alert' | 'warning' | 'info' | 'check' | 'question' {
  switch (severity) {
    case 'high': return 'alert';
    case 'medium': return 'warning';
    case 'low': return 'info';
    case 'none': return 'check';
    default: return 'question';
  }
}

/** "Coffee Leaf Rust" → "Coffee leaf rust" (design uses sentence case). */
export function sentenceCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// ── Motion ────────────────────────────────────────────────────────────────────
// Springs settle fast without wobble; timings use an emphasized curve for a
// crisp start and a soft landing.

export const ease = {
  emphasized: Easing.bezier(0.2, 0, 0, 1),
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.45, 0, 0.55, 1),
};

export const spring = {
  /** Selection lenses, indicators — snappy, no overshoot. */
  snappy: { damping: 26, stiffness: 320, mass: 0.9 } satisfies WithSpringConfig,
  /** Sheets, bars changing shape — smooth with a hint of life. */
  gentle: { damping: 24, stiffness: 220, mass: 1 } satisfies WithSpringConfig,
  /** Small pops (icons, pins). */
  pop: { damping: 14, stiffness: 300, mass: 0.7 } satisfies WithSpringConfig,
  /** Press feedback release. */
  press: { damping: 18, stiffness: 420, mass: 0.6 } satisfies WithSpringConfig,
};

export const timing = {
  fast: { duration: 160, easing: ease.emphasized } satisfies WithTimingConfig,
  base: { duration: 240, easing: ease.emphasized } satisfies WithTimingConfig,
  slow: { duration: 360, easing: ease.out } satisfies WithTimingConfig,
};

// ── Appearance ────────────────────────────────────────────────────────────────

/** Current appearance: palette, glass tone and scheme, following the phone setting. */
export function useTheme() {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, c: palettes[scheme], g: glass[scheme], tone: scheme as GlassTone };
}

/**
 * Theme-aware StyleSheet: `const useStyles = makeStyles((c, g) => ({ ... }))`,
 * then `const styles = useStyles()` in the component. Cached per scheme.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette, g: (typeof glass)['light']) => T) {
  const cache: Partial<Record<Scheme, T>> = {};
  return function useStyles(): T {
    const { scheme } = useTheme();
    return (cache[scheme] ??= StyleSheet.create(factory(palettes[scheme], glass[scheme])));
  };
}
