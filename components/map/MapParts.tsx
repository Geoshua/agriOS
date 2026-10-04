/** Field map building blocks: pins, block labels, the pin popover and the layer legend. */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, FadeOut, LinearTransition, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import Glass from '../glass/Glass';
import PressableScale from '../glass/PressableScale';
import { ChevronDown, Close, PinGlyph, StatusDisc } from '../glass/Icons';
import { colors, makeStyles, Scheme, sentenceCase, severityGlyph, severityLabel, severityPin, spring, status, timing, useTheme } from '../../lib/theme';
import type { IssueRecord } from '../../lib/db';
import { SOIL_SOURCE_LABEL } from '../../lib/soil';
import type { SoilAdvisory, SoilProfile } from '../../lib/soil';

// ── Pin ───────────────────────────────────────────────────────────────────────

const pinDrop = (delay: number) => () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -18 }, { scale: 0.6 }] },
    animations: {
      opacity: withDelay(delay, withTiming(1, { duration: 160 })),
      transform: [
        { translateY: withDelay(delay, withSpring(0, spring.pop)) },
        { scale: withDelay(delay, withSpring(1, spring.pop)) },
      ],
    },
  };
};

export function Pin({ severity, selected, index }: { severity: string; selected: boolean; index: number }) {
  const styles = useStyles();
  const size = selected ? 40 : 30;
  const border = selected ? 3 : 2.5;
  return (
    <Animated.View entering={pinDrop(index * 40)} style={styles.pinWrap}>
      <View
        style={[
          styles.pin,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: border,
            backgroundColor: severityPin[severity] ?? severityPin.unknown,
          },
        ]}
      >
        <PinGlyph kind={severityGlyph(severity)} size={selected ? 19 : 15} />
      </View>
    </Animated.View>
  );
}

// ── Block label (health layer) ────────────────────────────────────────────────

const BLOCK_TEXT: Record<string, string> = {
  high: 'needs action',
  medium: 'watch',
  low: 'monitor',
  unknown: 'check',
  none: 'healthy',
};
const BLOCK_TONE: Record<string, string> = { high: status.danger, medium: status.warning, low: status.caution, unknown: '#D8D1C2', none: status.goodText };
const BLOCK_COLOR: Record<Scheme, Record<string, string>> = { light: BLOCK_TONE, dark: BLOCK_TONE };

/** Several nearby scans merged into one bubble: count, coloured by the worst severity. */
export function ClusterPin({ severity, count }: { severity: string; count: number }) {
  const styles = useStyles();
  const size = count >= 20 ? 46 : count >= 8 ? 40 : 34;
  return (
    <Animated.View entering={pinDrop(0)} style={styles.pinWrap}>
      <View
        style={[
          styles.pin,
          { width: size, height: size, borderRadius: size / 2, borderWidth: 3, backgroundColor: severityPin[severity] ?? severityPin.unknown },
        ]}
      >
        <Text style={styles.clusterText}>{count}</Text>
      </View>
    </Animated.View>
  );
}

export function BlockLabel({ block, worst }: { block: string; worst: string }) {
  const styles = useStyles();
  const { scheme } = useTheme();
  const text = BLOCK_TEXT[worst] ?? BLOCK_TEXT.unknown;
  const color = BLOCK_COLOR[scheme][worst] ?? BLOCK_COLOR[scheme].unknown;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.blockLabel}>
      <Text style={[styles.blockLabelText, { color }]} numberOfLines={1}>
        {block} · {text}
      </Text>
    </Animated.View>
  );
}

// ── Popover ───────────────────────────────────────────────────────────────────

const popIn = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.82 }, { translateY: 10 }] },
    animations: {
      opacity: withTiming(1, timing.fast),
      transform: [{ scale: withSpring(1, spring.snappy) }, { translateY: withSpring(0, spring.snappy) }],
    },
  };
};
const popOut = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }] },
    animations: {
      opacity: withTiming(0, timing.fast),
      transform: [{ scale: withTiming(0.9, timing.fast) }, { translateY: withTiming(6, timing.fast) }],
    },
  };
};

export const POPOVER_WIDTH = 232;

export function Popover({ issue, left, bottom, arrowX }: { issue: IssueRecord; left: number; bottom: number; arrowX: number }) {
  const styles = useStyles();
  const { scheme } = useTheme();
  const color = severityPin[issue.severity] ?? severityPin.unknown;
  return (
    <Animated.View
      key={issue.id}
      entering={popIn}
      exiting={popOut}
      style={[styles.popover, { left, bottom, transformOrigin: [arrowX + 9, '100%', 0] }]}
      pointerEvents="none"
    >
      <View style={[StyleSheet.absoluteFill, styles.popoverGlass]} />
      <View style={[styles.arrow, { left: arrowX }]} />
      <View style={styles.popoverHead}>
        <StatusDisc size={16} color={color} kind={severityGlyph(issue.severity)} />
        <Text style={[styles.popoverSeverity, { color: issue.severity === 'low' ? status.caution : issue.severity === 'high' ? status.danger : color }]}>
          {severityLabel[issue.severity] ?? 'Unsure'}
        </Text>
      </View>
      <Text style={styles.popoverTitle} numberOfLines={1}>{sentenceCase(issue.diseaseName)}</Text>
      <Text style={styles.popoverMeta}>
        {formatWhen(issue.timestamp)}
        {issue.block ? ` · Block ${issue.block}` : ''} · {Math.round(issue.confidence * 100)}% match
      </Text>
    </Animated.View>
  );
}

export function formatWhen(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

// ── Legend accessory ──────────────────────────────────────────────────────────

const LEGEND = [
  { key: 'high', label: 'Urgent' },
  { key: 'medium', label: 'Watch' },
  { key: 'low', label: 'Monitor' },
  { key: 'none', label: 'Healthy' },
];

export function PinsLegend({ issues }: { issues: IssueRecord[] }) {
  const styles = useStyles();
  return (
    <Animated.View entering={FadeIn.duration(220).delay(60)} exiting={FadeOut.duration(120)} style={styles.legendRow}>
      {LEGEND.map(({ key, label }) => {
        const count = issues.filter((i) => i.severity === key).length;
        return (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: severityPin[key] }, key === 'low' && styles.legendDotEdge]} />
            <Text style={styles.legendText}>
              {label} {count}
            </Text>
          </View>
        );
      })}
    </Animated.View>
  );
}

export function HealthLegend() {
  const styles = useStyles();
  return (
    <Animated.View entering={FadeIn.duration(220).delay(60)} exiting={FadeOut.duration(120)} style={styles.healthLegend}>
      <View style={styles.healthRow}>
        <Text style={styles.legendText}>Healthy</Text>
        <View style={styles.ramp}>
          <Svg width="100%" height="10">
            <Defs>
              <LinearGradient id="ramp" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#239B6D" />
                <Stop offset="0.3" stopColor="#8FD9B8" />
                <Stop offset="0.5" stopColor="#3A342C" />
                <Stop offset="0.66" stopColor="#F2C230" />
                <Stop offset="0.82" stopColor="#E8841C" />
                <Stop offset="1" stopColor="#E5342A" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="10" rx="5" fill="url(#ramp)" />
          </Svg>
        </View>
        <Text style={styles.legendText}>Urgent</Text>
      </View>
      <Text style={styles.healthHint}>No colour = not scanned yet</Text>
    </Animated.View>
  );
}

// ── Community (regional) view ─────────────────────────────────────────────────

/** Regional aggregate from the hub/cloud `/heatmap` (GPS anonymised to ~10 km). */
export interface HeatmapRegion {
  /** Village / area name, when the source knows it. */
  name?: string;
  lat: number;
  lng: number;
  dominant: string;
  total: number;
  counts: Record<string, number>;
}

export const DISEASE_COLOR: Record<string, string> = {
  coffee_leaf_rust: '#DD6B20',
  coffee_leaf_miner: '#D69E2E',
  coffee_phoma: '#E53E3E',
  coffee_brown_eye: '#9B2C2C',
  healthy: '#239B6D',
  unknown: '#8A857C',
};

export const DISEASE_LABEL: Record<string, string> = {
  coffee_leaf_rust: 'Rust',
  coffee_leaf_miner: 'Leaf miner',
  coffee_phoma: 'Phoma',
  coffee_brown_eye: 'Brown eye',
  healthy: 'Healthy',
  unknown: 'Unknown',
};

/** Count badge marking a region's centre. */
export function RegionBadge({ region, selected }: { region: HeatmapRegion; selected: boolean }) {
  const styles = useStyles();
  const color = DISEASE_COLOR[region.dominant] ?? DISEASE_COLOR.unknown;
  return (
    <Animated.View entering={pinDrop(0)} style={[styles.regionBadge, { backgroundColor: color }, selected && styles.regionBadgeSelected]}>
      <Text style={styles.regionBadgeText} numberOfLines={1}>
        {region.total}
      </Text>
    </Animated.View>
  );
}

/** Glass card for a tapped region: dominant disease, scan count, breakdown. */
export function RegionCard({ region, bottom, onClose }: { region: HeatmapRegion; bottom: number; onClose: () => void }) {
  const styles = useStyles();
  const { c } = useTheme();
  const color = DISEASE_COLOR[region.dominant] ?? DISEASE_COLOR.unknown;
  const breakdown = Object.entries(region.counts).sort((a, b) => b[1] - a[1]);
  return (
    <Animated.View entering={popIn} exiting={popOut} style={[styles.regionCardWrap, { bottom }]}>
      <Glass radius={24} tone="light" highlightHeight="50%" style={styles.regionCard}>
        <View style={styles.regionHead}>
          <View style={[styles.legendDot, { backgroundColor: color }]} />
          <Text style={styles.popoverTitle}>
            {region.name ? `${region.name} · ` : ''}
            {DISEASE_LABEL[region.dominant] ?? 'Unknown'}
          </Text>
          <PressableScale onPress={onClose} style={styles.regionClose} accessibilityLabel="Close region details">
            <Close size={14} color={c.labelSecondary} />
          </PressableScale>
        </View>
        <Text style={styles.popoverMeta}>
          {region.total} scan{region.total === 1 ? '' : 's'} · regional data (anonymised)
        </Text>
        {breakdown.length > 1 && (
          <Text style={styles.regionBreakdown}>
            {breakdown.map(([id, n]) => `${DISEASE_LABEL[id] ?? id} ×${n}`).join('  ·  ')}
          </Text>
        )}
      </Glass>
    </Animated.View>
  );
}

export function CommunityLegend() {
  const styles = useStyles();
  return (
    <Animated.View entering={FadeIn.duration(220).delay(60)} exiting={FadeOut.duration(120)} style={styles.communityLegend}>
      {Object.entries(DISEASE_LABEL).map(([id, label]) => (
        <View key={id} style={styles.communityItem}>
          <View style={[styles.legendDot, { backgroundColor: DISEASE_COLOR[id] }]} />
          <Text style={styles.legendTextSmall}>{label}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

// ── Soil conditions (SoilGrids) ───────────────────────────────────────────────

const PH_LABEL: Record<SoilAdvisory['phStatus'], string> = { low: 'acidic', optimal: 'optimal', high: 'alkaline' };
const PH_TONE: Record<SoilAdvisory['phStatus'], { bg: string; fg: string }> = {
  low: { bg: 'rgba(245,165,36,0.2)', fg: '#FFBC4A' },
  optimal: { bg: colors.emeraldTint, fg: colors.emeraldBright },
  high: { bg: 'rgba(77,163,255,0.2)', fg: '#7DB9FF' },
};
const PH_COLOR: Record<Scheme, Record<SoilAdvisory['phStatus'], { bg: string; fg: string }>> = { light: PH_TONE, dark: PH_TONE };

const soilLayout = LinearTransition.springify().damping(24).stiffness(260);

/** Collapsible glass card: "Soil · pH 5.6 acidic ⌄" → advice + source. */
export function SoilCard({ profile, advisory }: { profile: SoilProfile; advisory: SoilAdvisory }) {
  const [open, setOpen] = useState(false);
  const { scheme, c } = useTheme();
  const styles = useStyles();
  const status = { label: PH_LABEL[advisory.phStatus], ...PH_COLOR[scheme][advisory.phStatus] };
  return (
    <Animated.View entering={FadeInUp.duration(320)} layout={soilLayout} style={styles.soilWrap}>
      <PressableScale
        pressedScale={0.98}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Field soil, pH ${profile.ph.toFixed(1)}, ${status.label}`}
      >
        <Glass radius={22} tone="light" highlightHeight="50%" style={styles.soil}>
          <View style={styles.soilHead}>
            <Text style={styles.soilTitle}>Soil</Text>
            <View style={[styles.phBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.phText, { color: status.fg }]}>pH {profile.ph.toFixed(1)} · {status.label}</Text>
            </View>
            <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
              <ChevronDown size={12} color={c.labelSecondary} />
            </View>
          </View>
          {open && (
            <Animated.View entering={FadeIn.duration(220).delay(80)} exiting={FadeOut.duration(120)} style={styles.soilBody}>
              <Text style={styles.soilAdvice}>{advisory.phAdvice}</Text>
              {advisory.phStatus !== 'optimal' && <Text style={styles.soilSub}>{advisory.generalAdvice}</Text>}
              <Text style={styles.soilSource}>
                SoilGrids (ISRIC) · ~250 m · 0–5 cm · {SOIL_SOURCE_LABEL[profile.source]}
              </Text>
            </Animated.View>
          )}
        </Glass>
      </PressableScale>
    </Animated.View>
  );
}

const useStyles = makeStyles((c, g) => ({
  soilWrap: { alignSelf: 'flex-start', maxWidth: '100%' },
  soil: { paddingVertical: 10, paddingHorizontal: 14 },
  soilHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  soilTitle: { fontSize: 15, fontWeight: '600', color: c.label },
  phBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  phText: { fontSize: 13, fontWeight: '700' },
  soilBody: { marginTop: 8, gap: 4, maxWidth: 320 },
  soilAdvice: { fontSize: 14, lineHeight: 20, color: c.labelStrong },
  soilSub: { fontSize: 13, lineHeight: 18, color: c.labelSecondary },
  soilSource: { fontSize: 12, color: c.labelTertiary, marginTop: 2 },
  pinWrap: { padding: 6 },
  pin: {
    borderColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  blockLabel: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.tag, borderWidth: StyleSheet.hairlineWidth, borderColor: c.separator },
  blockLabelText: { fontSize: 13, fontWeight: '700' },

  popover: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 3,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  popoverGlass: {
    borderRadius: 24,
    backgroundColor: c.popover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: g.rim,
    borderTopWidth: 1,
    borderTopColor: g.rimTop,
  },
  arrow: {
    position: 'absolute',
    bottom: -8,
    width: 18,
    height: 18,
    borderBottomRightRadius: 5,
    backgroundColor: c.popover,
    transform: [{ rotate: '45deg' }],
  },
  popoverHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  popoverSeverity: { fontSize: 15, fontWeight: '600' },
  popoverTitle: { fontSize: 19, fontWeight: '700', letterSpacing: -0.2, color: c.label },
  popoverMeta: { fontSize: 15, color: c.labelSecondary },

  legendRow: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  legendItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  legendDot: { width: 11, height: 11, borderRadius: 6 },
  clusterText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  legendDotEdge: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(242,234,216,0.25)' },
  legendText: { fontSize: 14, fontWeight: '600', color: c.label },
  legendTextSmall: { fontSize: 13, fontWeight: '600', color: c.label },
  communityLegend: { ...StyleSheet.absoluteFill, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', paddingHorizontal: 14, rowGap: 4 },
  communityItem: { width: '33.3%', flexDirection: 'row', alignItems: 'center', gap: 5 },
  regionBadge: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 9,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  regionBadgeSelected: { transform: [{ scale: 1.25 }] },
  regionBadgeText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  regionCardWrap: { position: 'absolute', left: 20, right: 20 },
  regionCard: { paddingVertical: 12, paddingHorizontal: 16, gap: 3 },
  regionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  regionClose: { marginLeft: 'auto', width: 44, height: 44, marginVertical: -10, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  regionBreakdown: { fontSize: 13, lineHeight: 19, color: c.labelSecondary, marginTop: 2 },
  healthLegend: { ...StyleSheet.absoluteFill, justifyContent: 'center', gap: 5, paddingHorizontal: 20 },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ramp: { flex: 1, height: 10 },
  healthHint: { fontSize: 12, color: c.labelSecondary, textAlign: 'center' },
}));
