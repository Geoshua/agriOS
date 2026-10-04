/**
 * Small insight visuals built for low literacy: colour + face + one word,
 * a weekly dot strip instead of a line chart, and big action icons.
 */

import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming, ZoomIn } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import type { ActionType } from '../../lib/db';
import type { Confidence, HealthLevel, Insight, Trend, WeekCell } from '../../lib/insights';
import { ease, makeStyles, severityGlyph, severityPin, useTheme } from '../../lib/theme';
import { PinGlyph } from '../glass/Icons';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const LEVEL_COLOR: Record<HealthLevel, string> = {
  good: '#248A3D',
  watch: '#D86A00',
  sick: '#D70015',
  unknown: '#8E8E93',
};
export const LEVEL_WORD: Record<HealthLevel, string> = { good: 'Healthy', watch: 'Watch', sick: 'Sick', unknown: 'Not checked' };
export const TREND_WORD: Record<Trend, string> = { improving: 'Getting better', worsening: 'Getting worse', stable: 'Steady', new: 'New' };
export const CONFIDENCE_WORD: Record<Confidence, string> = {
  none: 'no scans yet',
  low: 'rough estimate',
  medium: 'fair estimate',
  high: 'good estimate',
};

// ── Face ──────────────────────────────────────────────────────────────────────

export function Face({ level, size = 28, color = '#FFFFFF' }: { level: HealthLevel; size?: number; color?: string }) {
  const mouth =
    level === 'good' ? 'M8 14.5c1.2 1.6 2.5 2.4 4 2.4s2.8-.8 4-2.4' : level === 'sick' ? 'M8 17c1.2-1.6 2.5-2.4 4-2.4s2.8.8 4 2.4' : level === 'watch' ? 'M8.5 15.5h7' : 'M9 15.5h6';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      {level === 'unknown' ? (
        <Path d="M9.4 9.2a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.3 1-1.3 1.9v.5M12 17.6v.1" />
      ) : (
        <>
          <Circle cx={8.6} cy={9.6} r={0.9} fill={color} />
          <Circle cx={15.4} cy={9.6} r={0.9} fill={color} />
          <Path d={mouth} />
        </>
      )}
    </Svg>
  );
}

// ── Health ring ───────────────────────────────────────────────────────────────

/** Ring filled to the health score, face in the middle. */
export function HealthRing({ health, size = 56, stroke = 6 }: { health: Insight['health']; size?: number; stroke?: number }) {
  const { c } = useTheme();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming((health.score ?? 0) / 100, { duration: 700, easing: ease.out });
  }, [health.score]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - p.value) }));
  const color = LEVEL_COLOR[health.level];
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.fill} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circ} ${circ}`}
          animatedProps={props}
        />
      </Svg>
      <View style={{ width: size - stroke * 2 - 6, height: size - stroke * 2 - 6, borderRadius: size, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Face level={health.level} size={size * 0.48} />
      </View>
    </View>
  );
}

// ── Action icons ──────────────────────────────────────────────────────────────

export const ACTION_LABEL: Record<ActionType, string> = {
  sprayed: 'Sprayed',
  pruned: 'Pruned',
  fertilised: 'Fed',
  removed_leaves: 'Removed leaves',
  watered: 'Watered',
  rained: 'It rained',
  none: 'Nothing yet',
};

export function ActionIcon({ type, size = 22, color = '#000' }: { type: ActionType; size?: number; color?: string }) {
  const s = { fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {type === 'sprayed' && (
        <>
          <Path {...s} d="M7 10h6v10H7zM9 10V7h2v3M13 12h2.5M10 7V5h3" />
          <Path {...s} d="M18 9.5v.01M20 11v.01M18 13v.01M20.5 14.5v.01" strokeWidth={2.6} />
        </>
      )}
      {type === 'pruned' && <Path {...s} d="M6 6l12 12M6 18 18 6M5 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM5 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />}
      {type === 'fertilised' && <Path {...s} d="M6 20c0-6 3-10 9-12M15 8c0 4-2 7-6 8M15 8l3-3M18 5h-3M18 5v3" />}
      {type === 'removed_leaves' && <Path {...s} d="M5 19c0-7 4-12 13-13-1 8-6 13-13 13ZM5 19l7-7M15 15l4 4M19 15l-4 4" />}
      {type === 'watered' && <Path {...s} d="M12 3.5s-6 6.6-6 10.7a6 6 0 0 0 12 0c0-4.1-6-10.7-6-10.7Z" />}
      {type === 'rained' && <Path {...s} d="M7 15a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7H7ZM8 18l-1 2M12 18l-1 2M16 18l-1 2" />}
      {type === 'none' && <Path {...s} d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />}
    </Svg>
  );
}

// ── Weekly strip ──────────────────────────────────────────────────────────────

/** One dot per week (colour = worst result that week), action icons below. */
export function HealthStrip({ weeks }: { weeks: WeekCell[] }) {
  const { c } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.strip} accessible accessibilityLabel={stripLabel(weeks)}>
      {weeks.map((w, i) => (
        <View key={w.start} style={styles.week}>
          <Animated.View
            entering={ZoomIn.springify().damping(14).stiffness(220).delay(i * 50)}
            style={[
              styles.dot,
              w.worst
                ? { backgroundColor: severityPin[w.worst] ?? severityPin.unknown, borderColor: 'transparent' }
                : { backgroundColor: 'transparent', borderColor: c.checkBorder, borderStyle: 'dashed' },
            ]}
          >
            {w.worst && <PinGlyph kind={severityGlyph(w.worst)} size={14} />}
          </Animated.View>
          <View style={styles.actions}>
            {[...new Set(w.actions)].slice(0, 2).map((a) => (
              <ActionIcon key={a} type={a} size={14} color={c.labelSecondary} />
            ))}
          </View>
          <Text style={styles.weekLabel}>{i === weeks.length - 1 ? 'now' : `${weeks.length - 1 - i}w`}</Text>
        </View>
      ))}
    </View>
  );
}

function stripLabel(weeks: WeekCell[]) {
  const scanned = weeks.filter((w) => w.worst);
  return `Last ${weeks.length} weeks: ${scanned.length} weeks with scans`;
}

const useStyles = makeStyles((c) => ({
  strip: { flexDirection: 'row', justifyContent: 'space-between' },
  week: { alignItems: 'center', gap: 4, flex: 1 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  actions: { height: 14, flexDirection: 'row', gap: 1 },
  weekLabel: { fontSize: 11, color: c.labelTertiary, fontVariant: ['tabular-nums'] },
}));
