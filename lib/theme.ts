/**
 * Design tokens — "Emerald on soil", taken from the AgriOS logo.
 *
 * One dark appearance everywhere: warm near-black grounds, opaque rounded
 * "pods" in the logo's tile colour for cards and controls, cream text, and
 * the logo's two greens — bright emerald for the primary action / selected
 * state (with near-black content on it) and deep emerald for secondary fills
 * (with cream content on it). Icons and status use colour + glyph, never
 * colour alone.
 *
 * The camera and map keep translucent dark glass for floating chrome; scroll
 * screens and sheets use opaque pods on the ground colour.
 */

import { StyleSheet, TextStyle } from 'react-native';
import { Easing, WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

// ── Brand ─────────────────────────────────────────────────────────────────────

const EMERALD = '#239B6D'; // logo, left plane (measured from the artwork)
const EMERALD_BRIGHT = '#34C98E'; // small text / live indicators on dark
const EMERALD_DEEP = '#33644C'; // logo, right plane
const ON_EMERALD = '#0E0C08';

const BG = '#100E0A'; // camera + sheet ground
const GROUND = '#14110C'; // scrolling screens
const POD = '#1C1813'; // logo tile — cards, controls
const POD_RAISED = '#272119';
const POD_SUNKEN = '#0D0B08';

const CREAM = '#F2EAD8'; // logo light
const TEXT_SECONDARY = 'rgba(242,234,216,0.72)';
const TEXT_TERTIARY = 'rgba(242,234,216,0.5)';

/** Colours that are the same on every surface. */
export const colors = {
  black: '#000000',
  white: '#FFFFFF',

  // Grounds and surfaces
  bg: BG,
  ground: GROUND,
  pod: POD,
  podRaised: POD_RAISED,
  podSunken: POD_SUNKEN,
  line: 'rgba(242,234,216,0.08)',

  // Text
  cream: CREAM,
  text: CREAM,
  textSecondary: TEXT_SECONDARY,
  textTertiary: TEXT_TERTIARY,
  onDark: CREAM,
  onDarkSecondary: TEXT_SECONDARY,

  // Accent
  emerald: EMERALD,
  emeraldBright: EMERALD_BRIGHT,
  emeraldDeep: EMERALD_DEEP,
  emeraldTint: 'rgba(35,155,109,0.16)',
  emeraldTintStrong: 'rgba(35,155,109,0.3)',
  onEmerald: ON_EMERALD,
  /** Primary action fill and the content colour that reads on it. */
  primary: EMERALD,
  onPrimary: ON_EMERALD,
  scanning: EMERALD_BRIGHT,
  locate: EMERALD_BRIGHT,

  // Camera scrims
  scrim: 'rgba(12,10,7,0.74)',
  chipScrim: 'rgba(12,10,7,0.66)',
  pinHole: '#1C1813',
};

/**
 * Semantic status colours. Each reads as text on the dark pods and works as a
 * solid fill — pair a fill with `onColor()` for its content colour.
 */
export const status = {
  danger: '#F0564A',
  warning: '#F5A524',
  caution: '#F2C230',
  good: EMERALD,
  goodText: EMERALD_BRIGHT,
  neutral: '#9A958C',
  water: '#4DA3FF',
};

/** Near-black on bright fills, white on dark ones (crossover ≈ 4.4:1 either way). */
export function onColor(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.19 ? ON_EMERALD : '#FFFFFF';
}

export type Scheme = 'light' | 'dark';

/** Surface palette. The app is dark-only; both keys resolve to the same set. */
const dark = {
  label: CREAM,
  labelStrong: '#FFF8EA',
  labelSecondary: TEXT_SECONDARY,
  labelTertiary: TEXT_TERTIARY,
  separator: 'rgba(242,234,216,0.08)',
  fill: 'rgba(242,234,216,0.08)',
  fillStrong: 'rgba(242,234,216,0.13)',
  groundGrouped: GROUND,
  groundMap: BG,
  card: POD,
  cardRaised: POD_RAISED,
  cardSunken: POD_SUNKEN,
  sheetGlass: 'rgba(20,17,12,0.78)',
  popover: 'rgba(28,24,19,0.97)',
  tag: 'rgba(28,24,19,0.94)',
  voiceButton: EMERALD,
  voiceIcon: ON_EMERALD,
  waveIdle: 'rgba(242,234,216,0.18)',
  waveActive: EMERALD_BRIGHT,
  checkBorder: 'rgba(242,234,216,0.28)',
  numberBadge: 'rgba(35,155,109,0.18)',
  emptyArt: POD,
  statUrgent: '#F0564A',
  statHealthy: EMERALD_BRIGHT,
  gps: EMERALD_BRIGHT,
  accent: EMERALD,
  accentBright: EMERALD_BRIGHT,
  accentDeep: EMERALD_DEEP,
  accentTint: 'rgba(35,155,109,0.16)',
  onAccent: ON_EMERALD,
  /** Green for small text/links (≥4.5:1 on cards). */
  accentText: EMERALD_BRIGHT,
};

export const palettes = { light: dark, dark };

export type Palette = (typeof palettes)['light'];

/**
 * Glass materials.
 *   dark  — translucent chrome floating over the camera / map
 *   light — a raised, almost opaque pod on a dark ground (name kept for callers)
 * Both share the emerald selection lens with near-black content on it.
 */
const glassShared = {
  lens: EMERALD,
  lensEdge: EMERALD_BRIGHT,
  /** Content colour on the lens. */
  active: ON_EMERALD,
  /** Same as `active` — the name main's segmented controls use for content on the lens. */
  selected: ON_EMERALD,
  idle: '#EFE8D8',
  /** Accent colour for icons that are not on the lens. */
  accent: EMERALD_BRIGHT,
  text: CREAM,
  textSecondary: TEXT_SECONDARY,
  divider: 'rgba(242,234,216,0.09)',
  pin: CREAM,
  pinHole: POD,
  searching: 'rgba(242,234,216,0.09)',
};

export const glass = {
  dark: {
    fill: 'rgba(20,17,12,0.78)',
    highlight: 0.08,
    rimTop: 'rgba(242,234,216,0.16)',
    rim: 'rgba(242,234,216,0.07)',
    rimBottom: 'rgba(0,0,0,0.4)',
    shadowOpacity: 0.45,
    ...glassShared,
  },
  light: {
    fill: 'rgba(39,33,25,0.95)',
    highlight: 0.1,
    rimTop: 'rgba(242,234,216,0.2)',
    rim: 'rgba(242,234,216,0.08)',
    rimBottom: 'rgba(0,0,0,0.35)',
    shadowOpacity: 0.45,
    ...glassShared,
  },
};

export type GlassTone = keyof typeof glass;

// ── Shape & type ──────────────────────────────────────────────────────────────

export const radii = { chip: 16, card: 24, pod: 28, sheet: 36 };

/** Shared text styles so every screen's hierarchy reads the same. */
export const typography = {
  display: { fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 40, color: CREAM } satisfies TextStyle,
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5, color: CREAM } satisfies TextStyle,
  section: { fontSize: 19, fontWeight: '700', letterSpacing: -0.2, color: CREAM } satisfies TextStyle,
  body: { fontSize: 16, lineHeight: 23, color: CREAM } satisfies TextStyle,
  secondary: { fontSize: 15, lineHeight: 21, color: TEXT_SECONDARY } satisfies TextStyle,
  caption: { fontSize: 13, lineHeight: 18, color: TEXT_TERTIARY } satisfies TextStyle,
};

// ── Severity ──────────────────────────────────────────────────────────────────

/** Bright status discs on dark chrome (camera). */
export const severityOnDark: Record<string, string> = {
  high: status.danger,
  medium: status.warning,
  low: status.caution,
  none: EMERALD_BRIGHT,
  unknown: status.neutral,
};

/** Map pins and list dots. */
export const severityPin: Record<string, string> = {
  high: '#E5342A',
  medium: '#E8841C',
  low: '#F2C230',
  none: EMERALD,
  unknown: '#8A857C',
};

/** Solid chips ("Act within 3 days") on sheets. */
export const severityChip: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#D7362A', fg: '#FFFFFF' },
  medium: { bg: status.warning, fg: '#1A1200' },
  low: { bg: status.caution, fg: '#1A1400' },
  none: { bg: EMERALD, fg: ON_EMERALD },
  unknown: { bg: '#3A342C', fg: CREAM },
};

/** Count badges in the report. */
const badge = {
  high: { bg: 'rgba(240,86,74,0.18)', fg: '#FF8075' },
  medium: { bg: 'rgba(245,165,36,0.18)', fg: '#FFBC4A' },
  low: { bg: 'rgba(242,194,48,0.16)', fg: '#FFD65C' },
  none: { bg: 'rgba(35,155,109,0.18)', fg: EMERALD_BRIGHT },
  unknown: { bg: 'rgba(242,234,216,0.1)', fg: '#D8D1C2' },
};
export const severityBadge: Record<Scheme, Record<string, { bg: string; fg: string }>> = { light: badge, dark: badge };

/** Health heat-map ramp, cool (healthy) → warm (urgent). */
export const heat: Record<string, string> = {
  none: EMERALD,
  low: '#F2C230',
  medium: '#E8841C',
  high: '#E5342A',
  unknown: '#6B665E',
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

/** Current appearance. Always the dark palette — the design is dark-only. */
export function useTheme() {
  const scheme: Scheme = 'dark';
  return { scheme, c: palettes.dark, g: glass.dark, tone: 'dark' as GlassTone };
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
