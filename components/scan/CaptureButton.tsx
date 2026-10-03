/**
 * Manual capture shutter for full-camera mode (bottom centre, above the
 * minimized tab bar). Press → screen flash → spinner → green check, and a
 * toast confirming what was saved to the scanned list.
 */

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutUp,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import PressableScale from '../glass/PressableScale';
import Glass from '../glass/Glass';
import { Check, StatusDisc } from '../glass/Icons';
import { colors, sentenceCase, severityGlyph, severityOnDark, spring, useTheme } from '../../lib/theme';
import type { CaptureResult, CaptureState } from '../../lib/useManualCapture';
import { MINI_SIZE, useChromeInsets } from '../../lib/layout';

const SIZE = 74;

const enter = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.6 }, { translateY: 24 }] },
    animations: {
      opacity: withTiming(1, { duration: 180 }),
      transform: [{ scale: withSpring(1, spring.pop) }, { translateY: withSpring(0, spring.gentle) }],
    },
  };
};

export default function CaptureButton({ state, last, onPress }: { state: CaptureState; last: CaptureResult | null; onPress: () => void }) {
  const { miniBottom, top } = useChromeInsets();
  const { g } = useTheme();
  const flash = useSharedValue(0);
  const inner = useSharedValue(1);
  const saved = useSharedValue(0);

  useEffect(() => {
    if (state === 'busy') {
      flash.value = withSequence(withTiming(0.7, { duration: 60 }), withTiming(0, { duration: 260 }));
      inner.value = withSpring(0.62, spring.snappy);
    } else {
      inner.value = withSpring(1, spring.pop);
    }
    saved.value = withSpring(state === 'saved' ? 1 : 0, spring.gentle);
  }, [state]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: inner.value }],
    backgroundColor: interpolateColor(saved.value, [0, 1], ['#FFFFFF', colors.scanning]),
  }));

  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} />

      <Animated.View entering={enter} exiting={ZoomOut.duration(160)} style={[styles.wrap, { bottom: miniBottom + MINI_SIZE + 22 }]}>
        <PressableScale
          onPress={onPress}
          disabled={state === 'busy'}
          pressedScale={0.88}
          style={styles.ring}
          accessibilityRole="button"
          accessibilityLabel="Capture and save to scanned list"
        >
          <Animated.View style={[styles.inner, innerStyle]}>
            {state === 'busy' && (
              <Animated.View entering={ZoomIn.duration(150)} exiting={ZoomOut.duration(120)}>
                <ActivityIndicator color="#1C1C1E" />
              </Animated.View>
            )}
            {state === 'saved' && (
              <Animated.View entering={ZoomIn.springify().damping(12).stiffness(300)} exiting={ZoomOut.duration(120)}>
                <Check size={28} />
              </Animated.View>
            )}
          </Animated.View>
        </PressableScale>
      </Animated.View>

      {(state === 'saved' || state === 'failed') && (
        <Animated.View
          key={state}
          entering={FadeInDown.springify().damping(20).stiffness(260)}
          exiting={FadeOutUp.duration(180)}
          style={[styles.toastRow, { top: top + 60 }]}
          pointerEvents="none"
        >
          <Glass radius={20} style={styles.toast}>
            {state === 'saved' && last ? (
              <>
                <StatusDisc size={22} color={severityOnDark[last.severity] ?? severityOnDark.unknown} kind={severityGlyph(last.severity)} />
                <Text style={[styles.toastText, { color: g.text }]} numberOfLines={1}>
                  Saved · {sentenceCase(last.diseaseName)} · {last.plantName ?? `Block ${last.block}`}
                </Text>
              </>
            ) : (
              <Text style={[styles.toastText, { color: g.text }]}>Couldn't capture — try again</Text>
            )}
          </Glass>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flash: { backgroundColor: '#FFFFFF' },
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  inner: { width: SIZE - 14, height: SIZE - 14, borderRadius: (SIZE - 14) / 2, alignItems: 'center', justifyContent: 'center' },
  toastRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 10, paddingRight: 16, maxWidth: '90%' },
  toastText: { color: colors.onDark, fontSize: 15, fontWeight: '600', flexShrink: 1 },
});
