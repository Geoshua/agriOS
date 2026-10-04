/**
 * A generic coffee bush (not the farmer's actual tree — we can't see its
 * structure from leaf scans) used to point at *where* to act: leaf undersides,
 * lower branches, the crowded centre, suckers, old stems, or the soil.
 *
 * The highlighted zone pulses and gets a short callout ("Prune here").
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Line, Path } from 'react-native-svg';
import type { Zone } from '../../lib/insights';
import { spring, useTheme } from '../../lib/theme';

const W = 240;
const H = 250;

/** Centre (in diagram units) and radius of each zone's highlight. */
export const ZONES: Record<Zone, { x: number; y: number; r: number; label: string }> = {
  leaves_underside: { x: 62, y: 172, r: 20, label: 'Under the leaves' },
  lower_branches: { x: 120, y: 182, r: 34, label: 'Lower branches' },
  canopy_center: { x: 120, y: 110, r: 32, label: 'Crowded centre' },
  suckers: { x: 150, y: 206, r: 16, label: 'Suckers' },
  old_stems: { x: 116, y: 196, r: 14, label: 'Old stem' },
  soil: { x: 120, y: 232, r: 28, label: 'Soil' },
  whole: { x: 120, y: 125, r: 92, label: 'Whole tree' },
};

// Leaf pairs along each branch: [x, y, angle].
const LEAVES: [number, number, number][] = [
  // top
  [120, 38, -10], [104, 52, -40], [136, 52, 40], [96, 70, -55], [144, 70, 55],
  // upper-middle
  [86, 90, -60], [154, 90, 60], [100, 98, -20], [140, 98, 20], [74, 108, -70], [166, 108, 70],
  // middle
  [66, 128, -75], [174, 128, 75], [92, 126, -30], [148, 126, 30], [110, 120, -5], [130, 140, 10],
  // lower
  [56, 150, -80], [184, 150, 80], [80, 152, -40], [160, 152, 40], [48, 170, -85], [192, 170, 85],
  [70, 176, -60], [170, 176, 60], [96, 168, -25], [146, 170, 25],
];

export default function CoffeeBushDiagram({ zone, caption, size = 1 }: { zone: Zone | null; caption?: string; size?: number }) {
  const { scheme } = useTheme();
  const dark = scheme === 'dark';
  const leaf = dark ? '#3E8E57' : '#2F7A47';
  const leafLight = dark ? '#57A86F' : '#4C9A63';
  const stem = dark ? '#A68A6D' : '#7A5A3C';
  const soil = dark ? '#5B4636' : '#B48A63';

  const pulse = useSharedValue(0);
  const move = useSharedValue(0);
  useEffect(() => {
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1, false);
    move.value = withSequence(withTiming(0, { duration: 0 }), withSpring(1, spring.pop));
  }, [zone]);

  const z = zone ? ZONES[zone] : null;
  const scale = size;
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.85 * (1 - pulse.value),
    transform: [{ scale: 1 + 0.45 * pulse.value }],
  }));
  const coreStyle = useAnimatedStyle(() => ({ opacity: move.value, transform: [{ scale: 0.6 + 0.4 * move.value }] }));

  return (
    <View style={{ width: W * scale, height: H * scale }} accessible accessibilityLabel={z ? `Diagram of a coffee tree, pointing at: ${z.label}` : 'Diagram of a coffee tree'}>
      <Svg width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`}>
        {/* soil + roots */}
        <Ellipse cx={120} cy={232} rx={100} ry={12} fill={soil} opacity={0.55} />
        <Path d="M116 222 Q100 236 84 240 M124 222 Q140 236 158 240 M120 222 L120 244" stroke={stem} strokeWidth={2} fill="none" opacity={0.6} />
        {/* trunk + old stem */}
        <Path d="M114 222 L116 150 L118 40 M126 222 L124 150 L122 40" stroke={stem} strokeWidth={3} fill="none" />
        <Path d="M112 222 Q108 205 114 188" stroke={stem} strokeWidth={6} strokeLinecap="round" fill="none" opacity={0.7} />
        {/* suckers */}
        <Path d="M146 222 Q148 208 152 192 M150 222 Q156 212 160 200" stroke={leafLight} strokeWidth={2.5} strokeLinecap="round" fill="none" />
        <Ellipse cx={153} cy={190} rx={5} ry={9} fill={leafLight} transform="rotate(20 153 190)" />
        {/* laterals */}
        <G stroke={stem} strokeWidth={2} strokeLinecap="round" fill="none">
          <Line x1={118} y1={60} x2={92} y2={74} />
          <Line x1={122} y1={60} x2={148} y2={74} />
          <Line x1={118} y1={92} x2={72} y2={110} />
          <Line x1={122} y1={92} x2={168} y2={110} />
          <Line x1={118} y1={124} x2={62} y2={150} />
          <Line x1={122} y1={124} x2={178} y2={150} />
          <Line x1={117} y1={156} x2={46} y2={172} />
          <Line x1={123} y1={156} x2={194} y2={172} />
        </G>
        {/* leaves */}
        {LEAVES.map(([x, y, a], i) => (
          <Ellipse key={i} cx={x} cy={y} rx={7} ry={13} fill={i % 3 === 0 ? leafLight : leaf} transform={`rotate(${a} ${x} ${y})`} />
        ))}
        {/* cherries */}
        {[[104, 104], [138, 132], [86, 160], [156, 162], [128, 76]].map(([x, y], i) => (
          <G key={`c${i}`}>
            <Circle cx={x} cy={y} r={3.2} fill="#C0392B" />
            <Circle cx={x + 5} cy={y + 2} r={3.2} fill="#A93226" />
          </G>
        ))}
        {/* a lower leaf with rust spots, for the "under the leaves" zone */}
        <Ellipse cx={62} cy={172} rx={9} ry={15} fill={leafLight} transform="rotate(-70 62 172)" />
        {[[56, 170], [63, 174], [68, 169]].map(([x, y], i) => (
          <Circle key={`r${i}`} cx={x} cy={y} r={1.8} fill="#E8A33D" />
        ))}
      </Svg>

      {z && (
        <>
          <Animated.View
            pointerEvents="none"
            style={[styles.ring, { left: (z.x - z.r) * scale, top: (z.y - z.r) * scale, width: z.r * 2 * scale, height: z.r * 2 * scale, borderRadius: z.r * scale }, ringStyle]}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.core, { left: (z.x - z.r) * scale, top: (z.y - z.r) * scale, width: z.r * 2 * scale, height: z.r * 2 * scale, borderRadius: z.r * scale }, coreStyle]}
          />
          <Animated.View
            key={zone}
            entering={FadeIn.duration(260).delay(120)}
            pointerEvents="none"
            style={[styles.callout, calloutPosition(z, scale)]}
          >
            <Text style={styles.calloutText} numberOfLines={1}>{caption ?? z.label}</Text>
          </Animated.View>
        </>
      )}
    </View>
  );
}

function calloutPosition(z: { x: number; y: number; r: number }, scale: number) {
  // Above the zone, kept inside the diagram.
  const top = Math.max(0, (z.y - z.r) * scale - 30);
  const left = Math.max(0, Math.min(W * scale - 130, z.x * scale - 65));
  return { top, left };
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 3, borderColor: '#FFB800' },
  core: { position: 'absolute', borderWidth: 2.5, borderColor: '#FFB800', backgroundColor: 'rgba(255,184,0,0.16)' },
  callout: {
    position: 'absolute',
    width: 130,
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#1C1C1E',
  },
  calloutText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
