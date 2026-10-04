/**
 * Glass — the material for floating chrome and pods.
 *
 * Layers (bottom → top):
 *   1. Backdrop blur (iOS only)
 *   2. Tint fill — warm near-black, mostly opaque so it reads over any scene
 *   3. Faint radial highlight from the top-left
 *   4. Rim: light top edge, hairline sides, dark bottom edge
 * plus a soft drop shadow on iOS.
 *
 * `tone` is either fixed ('dark' = translucent chrome over the camera / map,
 * 'light' = a raised, near-opaque pod) or a shared value 0→1 that blends the
 * two, so a control can change material smoothly.
 */

import React, { useState } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { AnimatedStyle, SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { glass, GlassTone, useTheme } from '../../lib/theme';

interface GlassProps {
  radius: number;
  tone?: GlassTone | SharedValue<number>;
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Height of the highlight ellipse (design: 90% for pills, 60% for tall rails, 50% for sheets). */
  highlightHeight?: string;
  pointerEvents?: 'box-none' | 'none' | 'auto' | 'box-only';
  children?: React.ReactNode;
}

/** Backdrop blur strength — kept low so the scene behind stays legible through the glass. */
const GLASS_BLUR = 22;

let gradientSeq = 0;

export default function Glass({ radius, tone: toneProp, style, highlightHeight = '90%', pointerEvents, children }: GlassProps) {
  const theme = useTheme();
  // Follows the app appearance unless a tone is given.
  const tone = toneProp ?? theme.tone;
  const animated = typeof tone !== 'string';
  const fixed = animated ? null : glass[tone as GlassTone];

  return (
    <Animated.View pointerEvents={pointerEvents} style={[styles.shadow, { borderRadius: radius }, fixed && { shadowOpacity: fixed.shadowOpacity }, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} pointerEvents="none">
        {animated ? (
          <>
            <Backdrop intensity={GLASS_BLUR} tint="dark" />
            <ToneLayer tone={tone as SharedValue<number>} which="dark" radius={radius} highlightHeight={highlightHeight} />
            <ToneLayer tone={tone as SharedValue<number>} which="light" radius={radius} highlightHeight={highlightHeight} />
          </>
        ) : (
          <>
            <Backdrop intensity={GLASS_BLUR} tint="dark" />
            <Material which={tone as GlassTone} radius={radius} highlightHeight={highlightHeight} />
          </>
        )}
      </View>
      {children}
    </Animated.View>
  );
}

/**
 * Backdrop blur — iOS only. Android blur needs the content behind wrapped in a
 * BlurTargetView, and our backdrops (camera preview, map) are native surfaces
 * it can't capture, so Android glass is the tint alone.
 */
export function Backdrop({ intensity, tint }: { intensity: number; tint: 'default' | 'dark' | 'light' }) {
  if (Platform.OS !== 'ios') return null;
  return <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />;
}

function ToneLayer({ tone, which, radius, highlightHeight }: { tone: SharedValue<number>; which: GlassTone; radius: number; highlightHeight: string }) {
  const style = useAnimatedStyle(() => ({ opacity: which === 'light' ? tone.value : 1 - tone.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Material which={which} radius={radius} highlightHeight={highlightHeight} />
    </Animated.View>
  );
}

function Material({ which, radius, highlightHeight }: { which: GlassTone; radius: number; highlightHeight: string }) {
  const t = glass[which];
  const [id] = useState(() => `glass${gradientSeq++}`);
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.fill }]} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={id} cx="25%" cy="0%" rx="130%" ry={highlightHeight} fx="25%" fy="0%">
            <Stop offset="0" stopColor="#F2EAD8" stopOpacity={t.highlight} />
            <Stop offset="0.55" stopColor="#F2EAD8" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.rim,
            borderTopWidth: 1,
            borderTopColor: t.rimTop,
            borderBottomWidth: 1,
            borderBottomColor: t.rimBottom,
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  shadow: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
    default: {},
  }) as ViewStyle,
});
