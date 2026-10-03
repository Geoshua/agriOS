/**
 * Floating Liquid Glass tab bar (custom `tabBar` for expo-router Tabs).
 *
 * - Material follows the phone's appearance, blending smoothly when it changes.
 * - In the scanner's full-camera mode it minimizes to a single round button
 *   holding the Scan icon; tapping it expands back to AR.
 * - While the details sheet is up it slides away.
 */

import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import type { Tabs } from 'expo-router';
import Animated, { interpolate, Extrapolation, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import GlassSegmented, { SegmentItem } from './GlassSegmented';
import PressableScale from './PressableScale';
import { BarChart, MapFold, ScanFrame } from './Icons';
import { spring, timing, useTheme } from '../../lib/theme';
import { useShambaStore } from '../../lib/store';
import { TAB_BAR_HEIGHT, MINI_SIZE, SIDE, useChromeInsets } from '../../lib/layout';

/** Props expo-router passes to a custom `tabBar`. */
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const TAB_META: Record<string, Omit<SegmentItem, 'key'>> = {
  scan: { label: 'Scan', icon: (c) => <ScanFrame color={c} /> },
  map: { label: 'Field Map', icon: (c) => <MapFold color={c} /> },
  report: { label: 'Report', icon: (c) => <BarChart color={c} /> },
};

export default function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const { width } = useWindowDimensions();
  const { tabBottom } = useChromeInsets();
  const { scheme, g } = useTheme();
  const scanMode = useShambaStore((s) => s.scanMode);
  const setScanMode = useShambaStore((s) => s.setScanMode);

  const routeName = state.routes[state.index]?.name;
  const onScan = routeName === 'scan';
  const minimized = onScan && scanMode === 'camera';
  const hidden = onScan && scanMode === 'details';

  const tone = useSharedValue(scheme === 'dark' ? 0 : 1);
  const mini = useSharedValue(minimized ? 1 : 0);
  const hide = useSharedValue(hidden ? 1 : 0);

  useEffect(() => {
    tone.value = withTiming(scheme === 'dark' ? 0 : 1, timing.slow);
  }, [scheme]);
  useEffect(() => {
    mini.value = withSpring(minimized ? 1 : 0, spring.gentle);
  }, [minimized]);
  useEffect(() => {
    hide.value = hidden ? withTiming(1, timing.base) : withSpring(0, spring.gentle);
  }, [hidden]);

  const fullWidth = width - SIDE * 2;

  const barStyle = useAnimatedStyle(() => ({
    width: interpolate(mini.value, [0, 1], [fullWidth, MINI_SIZE]),
    height: interpolate(mini.value, [0, 1], [TAB_BAR_HEIGHT, MINI_SIZE]),
    bottom: tabBottom + 4 * mini.value,
    opacity: 1 - hide.value,
    transform: [{ translateY: hide.value * (TAB_BAR_HEIGHT + tabBottom + 20) }, { scale: 1 - 0.06 * hide.value }],
  }), [fullWidth, tabBottom]);

  const trackStyle = useAnimatedStyle(() => ({
    opacity: interpolate(mini.value, [0, 0.55], [1, 0], Extrapolation.CLAMP),
  }));

  const miniStyle = useAnimatedStyle(() => ({
    opacity: interpolate(mini.value, [0.45, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(mini.value, [0.45, 1], [0.6, 1], Extrapolation.CLAMP) }],
  }));

  const items: SegmentItem[] = state.routes.map((route) => ({
    key: route.key,
    ...(TAB_META[route.name] ?? { label: route.name, icon: () => null }),
  }));

  function onSelect(index: number) {
    const route = state.routes[index];
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (state.index !== index && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  }

  return (
    <GlassSegmented
      items={items}
      selectedIndex={state.index}
      onSelect={onSelect}
      direction="row"
      tone={tone}
      radius={TAB_BAR_HEIGHT / 2}
      style={[styles.bar, barStyle]}
      trackStyle={trackStyle}
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityLabel="Main"
      overlay={
        <Animated.View style={[StyleSheet.absoluteFill, miniStyle]} pointerEvents={minimized ? 'auto' : 'none'}>
          <PressableScale
            onPress={() => setScanMode('ar')}
            style={styles.miniButton}
            accessibilityRole="button"
            accessibilityLabel="Scan tab. Expand tab bar"
          >
            <ScanFrame size={26} color={g.active} />
          </PressableScale>
        </Animated.View>
      }
    />
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: SIDE },
  miniButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
