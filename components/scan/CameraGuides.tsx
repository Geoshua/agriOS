/**
 * Full-camera framing: "Scanning — hold steady" chip, four rounded corner
 * brackets, and a scan line sweeping up and down inside the frame.
 * Brackets settle inward from slightly outside when the mode is entered.
 */

import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeIn,
  FadeInDown,
  FadeOut,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { PingDot } from './ScanTopBar';
import { colors, ease, spring } from '../../lib/theme';
import { useChromeInsets } from '../../lib/layout';

const BRACKET = 46;
const STROKE = 4;
const CORNER = 30;

export default function CameraGuides({ scanning }: { scanning: boolean }) {
  const { width, height } = useWindowDimensions();
  const { top } = useChromeInsets();

  // Frame proportions from the design (390×844): x 48→342, y 220→626.
  const frameLeft = Math.round(width * 0.123);
  const frameTop = top + Math.round(height * 0.197);
  const frameWidth = width - frameLeft * 2;
  const frameHeight = Math.round(height * 0.481);

  const settle = useSharedValue(0);
  const sweep = useSharedValue(0);

  useEffect(() => {
    settle.value = withSpring(1, spring.gentle);
    sweep.value = withDelay(250, withRepeat(withTiming(1, { duration: 2400, easing: ease.inOut }), -1, true));
    return () => cancelAnimation(sweep);
  }, []);

  const sweepRange = frameHeight - 36;
  const lineStyle = useAnimatedStyle(() => ({
    opacity: settle.value,
    transform: [{ translateY: sweep.value * sweepRange }],
  }));

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View entering={FadeInDown.springify().damping(20).stiffness(240)} style={[styles.chipRow, { top: frameTop - 54 }]}>
        <View style={styles.chip}>
          <PingDot active={scanning} size={8} />
          <Text style={styles.chipText}>{scanning ? 'Scanning — hold steady' : 'Paused'}</Text>
        </View>
      </Animated.View>

      <Bracket settle={settle} dx={-1} dy={-1} style={[styles.tl, { left: frameLeft, top: frameTop }]} />
      <Bracket settle={settle} dx={1} dy={-1} style={[styles.tr, { left: frameLeft + frameWidth - BRACKET, top: frameTop }]} />
      <Bracket settle={settle} dx={-1} dy={1} style={[styles.bl, { left: frameLeft, top: frameTop + frameHeight - BRACKET }]} />
      <Bracket settle={settle} dx={1} dy={1} style={[styles.br, { left: frameLeft + frameWidth - BRACKET, top: frameTop + frameHeight - BRACKET }]} />

      <Animated.View style={[styles.line, { left: frameLeft + 16, top: frameTop + 16, width: frameWidth - 32 }, lineStyle]}>
        <Svg width="100%" height="2">
          <Defs>
            <LinearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#fff" stopOpacity={0} />
              <Stop offset="0.5" stopColor="#fff" stopOpacity={1} />
              <Stop offset="1" stopColor="#fff" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="2" fill="url(#sweep)" />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

function Bracket({ settle, dx, dy, style }: { settle: SharedValue<number>; dx: number; dy: number; style: StyleProp<ViewStyle> }) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: settle.value,
    transform: [{ translateX: dx * 14 * (1 - settle.value) }, { translateY: dy * 14 * (1 - settle.value) }],
  }));
  return <Animated.View style={[styles.bracket, style, animatedStyle]} />;
}

const styles = StyleSheet.create({
  chipRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  chip: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.chipScrim,
  },
  chipText: { color: colors.onDark, fontSize: 15, fontWeight: '600' },
  bracket: { position: 'absolute', width: BRACKET, height: BRACKET, borderColor: colors.white },
  tl: { borderTopWidth: STROKE, borderLeftWidth: STROKE, borderTopLeftRadius: CORNER },
  tr: { borderTopWidth: STROKE, borderRightWidth: STROKE, borderTopRightRadius: CORNER },
  bl: { borderBottomWidth: STROKE, borderLeftWidth: STROKE, borderBottomLeftRadius: CORNER },
  br: { borderBottomWidth: STROKE, borderRightWidth: STROKE, borderBottomRightRadius: CORNER },
  line: { position: 'absolute', height: 2 },
});
