/**
 * Five-axis health "pentagon" (radar). Each corner is an Axis from the insight
 * engine, scored 0–5. Axes without data are drawn hollow and labelled
 * "no data" instead of pretending to be zero. The shape grows from the centre
 * on mount and morphs when values change.
 */

import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';
import type { Axis } from '../../lib/insights';
import { colors, makeStyles, useTheme } from '../../lib/theme';

// Animate a Path's `d`: native SVG nodes understand `d`, not Polygon's `points`
// (Reanimated sends animated props straight to the native view).
const AnimatedPath = Animated.createAnimatedComponent(Path);

// 300 px canvas, radius 84: labels at radius 112 stay inside on every side.
const SIZE = 300;
const C = SIZE / 2;
const R = 84;

const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / 5;
const point = (i: number, radius: number) => ({ x: C + radius * Math.cos(angle(i)), y: C + radius * Math.sin(angle(i)) });

export default function Pentagon({ axes }: { axes: Axis[] }) {
  const { c } = useTheme();
  const styles = useStyles();
  const grow = useSharedValue(0);
  const v0 = useSharedValue(0);
  const v1 = useSharedValue(0);
  const v2 = useSharedValue(0);
  const v3 = useSharedValue(0);
  const v4 = useSharedValue(0);
  const values = [v0, v1, v2, v3, v4];

  useEffect(() => {
    grow.value = withSpring(1, { damping: 18, stiffness: 140 });
  }, []);
  useEffect(() => {
    axes.forEach((a, i) => {
      values[i].value = withSpring((a.value ?? 0) / 5, { damping: 20, stiffness: 160 });
    });
  }, [axes.map((a) => a.value).join(',')]);

  const animatedProps = useAnimatedProps(() => {
    const vs = [v0.value, v1.value, v2.value, v3.value, v4.value];
    const pts = vs.map((v, i) => {
      const r = Math.max(0.04, v) * R * grow.value;
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      return `${C + r * Math.cos(a)},${C + r * Math.sin(a)}`;
    });
    return { d: `M${pts.join(' L')} Z` };
  });

  const ring = (k: number) => [0, 1, 2, 3, 4].map((i) => point(i, (R * k) / 5)).map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View style={styles.wrap} accessible accessibilityLabel={axes.map((a) => `${a.label} ${a.value == null ? 'no data' : `${a.value} of 5`}`).join(', ')}>
      <Svg width={SIZE} height={SIZE}>
        {[1, 2, 3, 4, 5].map((k) => (
          <Polygon key={k} points={ring(k)} fill="none" stroke={c.separator} strokeWidth={k === 5 ? 1.5 : 1} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => {
          const p = point(i, R);
          return <Line key={i} x1={C} y1={C} x2={p.x} y2={p.y} stroke={c.separator} strokeWidth={1} />;
        })}
        <AnimatedPath animatedProps={animatedProps} fill="rgba(35,155,109,0.28)" stroke={colors.emeraldBright} strokeWidth={2.5} strokeLinejoin="round" />
        {axes.map((a, i) => {
          const p = point(i, ((a.value ?? 0) / 5) * R);
          return a.value == null ? (
            <Circle key={a.key} cx={point(i, R).x} cy={point(i, R).y} r={4} fill="none" stroke={c.labelTertiary} strokeDasharray="2 2" strokeWidth={1.5} />
          ) : (
            <Circle key={a.key} cx={p.x} cy={p.y} r={4} fill={colors.emeraldBright} />
          );
        })}
      </Svg>

      {axes.map((a, i) => {
        const p = point(i, R + 28);
        return (
          <View key={a.key} style={[styles.label, { left: p.x - 42, top: p.y - 16 }]} pointerEvents="none">
            <Text style={styles.labelName} numberOfLines={1}>{a.label}</Text>
            <Text style={[styles.labelValue, a.value == null && styles.labelNoData]}>{a.value == null ? 'no data' : `${a.value}/5`}</Text>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { width: SIZE, height: SIZE, alignSelf: 'center' },
  label: { position: 'absolute', width: 84, alignItems: 'center' },
  labelName: { fontSize: 13, fontWeight: '700', color: c.label },
  labelValue: { fontSize: 12, fontWeight: '600', color: c.labelSecondary, fontVariant: ['tabular-nums'] },
  labelNoData: { color: c.labelTertiary, fontStyle: 'italic' },
}));

