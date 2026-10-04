/**
 * AR annotation layer: a cream ring around every detected lesion plus a
 * "N spots" label. Rings pop in with a stagger, glide to new positions as
 * detections update, and shrink away when they disappear.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  ZoomOut,
} from 'react-native-reanimated';
import type { Spot } from '../../lib/inference';
import { colors, spring, timing } from '../../lib/theme';

export default function ARSpots({ spots, visible }: { spots: Spot[]; visible: boolean }) {
  const { width, height } = useWindowDimensions();
  const shown = visible ? spots : [];

  const labelTop = shown.length
    ? Math.min(height * 0.72, Math.max(...shown.map((s) => s.y * height + s.radius * width)) + 12)
    : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {shown.map((spot, i) => (
        <Ring key={i} index={i} cx={spot.x * width} cy={spot.y * height} size={Math.max(28, spot.radius * 2 * width)} />
      ))}

      {shown.length > 0 && (
        <SpotLabel count={shown.length} top={labelTop} />
      )}
    </View>
  );
}

function Ring({ index, cx, cy, size }: { index: number; cx: number; cy: number; size: number }) {
  const x = useSharedValue(cx);
  const y = useSharedValue(cy);
  const s = useSharedValue(size);
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.value = withDelay(index * 45, withSpring(1, { damping: 14, stiffness: 260, mass: 0.7 }));
  }, []);

  useEffect(() => {
    x.value = withSpring(cx, spring.gentle);
    y.value = withSpring(cy, spring.gentle);
    s.value = withSpring(size, spring.gentle);
  }, [cx, cy, size]);

  const style = useAnimatedStyle(() => ({
    width: s.value,
    height: s.value,
    borderRadius: s.value / 2,
    opacity: appear.value,
    transform: [
      { translateX: x.value - s.value / 2 },
      { translateY: y.value - s.value / 2 },
      { scale: 0.4 + 0.6 * appear.value },
    ],
  }));

  return <Animated.View exiting={ZoomOut.duration(180)} style={[styles.ring, style]} />;
}

function SpotLabel({ count, top }: { count: number; top: number }) {
  const t = useSharedValue(top);
  useEffect(() => {
    t.value = withTiming(top, timing.slow);
  }, [top]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: t.value }] }));

  return (
    <Animated.View entering={FadeIn.duration(240).delay(120)} exiting={FadeOut.duration(160)} style={[styles.label, style]}>
      <Animated.Text key={count} entering={FadeIn.duration(180)} style={styles.labelCount}>
        {count} spot{count === 1 ? '' : 's'}
      </Animated.Text>
      <Text style={styles.labelHint}>on leaf</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderWidth: 2.5,
    borderColor: colors.cream,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  label: {
    position: 'absolute',
    left: 20,
    top: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.scrim,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(242,234,216,0.12)',
  },
  labelCount: { color: colors.emeraldBright, fontSize: 17, fontWeight: '700' },
  labelHint: { color: colors.onDarkSecondary, fontSize: 14 },
});
