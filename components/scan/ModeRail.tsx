/**
 * Vertical glass scan-mode control: AR · Camera · Details.
 *
 * Swipe it right to tuck it away: the rail follows the finger and, past a
 * threshold (or with a flick), collapses into a small glass tab docked at the
 * right edge with an arrow. Tap the tab or swipe it left to bring the rail back.
 * The whole thing also slides off while the details sheet is up.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import GlassSegmented, { SegmentItem } from '../glass/GlassSegmented';
import Glass from '../glass/Glass';
import PressableScale from '../glass/PressableScale';
import { Camera, ChevronLeft, Cube, Document } from '../glass/Icons';
import { spring, timing, useTheme } from '../../lib/theme';
import type { ScanMode } from '../../lib/store';
import { SIDE } from '../../lib/layout';

const MODES: ScanMode[] = ['ar', 'camera', 'details'];
const RAIL_WIDTH = 62;
const ITEM = 58;
const RAIL_HEIGHT = ITEM * 3 + 2 * 2 + 4 * 2;
/** Distance the rail travels to fully tuck away. */
const TRAVEL = RAIL_WIDTH + SIDE;
const TAB_WIDTH = 30;
const TAB_HEIGHT = 72;

interface Props {
  mode: ScanMode;
  detailsEnabled: boolean;
  onSelect: (mode: ScanMode) => void;
}

export default function ModeRail({ mode, detailsEnabled, onSelect }: Props) {
  const { height } = useWindowDimensions();
  const { g } = useTheme();
  const hidden = mode === 'details';
  const [collapsed, setCollapsed] = useState(false);

  const h = useSharedValue(hidden ? 1 : 0); // hidden for the sheet
  const c = useSharedValue(0); // 0 expanded → 1 collapsed (follows the finger)
  const start = useSharedValue(0);

  useEffect(() => {
    h.value = hidden ? withTiming(1, timing.base) : withSpring(0, spring.gentle);
  }, [hidden]);

  function settle(next: boolean) {
    setCollapsed(next);
  }

  function animateTo(next: boolean, velocity = 0) {
    c.value = withSpring(next ? 1 : 0, { ...spring.gentle, velocity });
    setCollapsed(next);
  }

  // Shared drag logic for both the rail and the collapsed tab.
  const makeSwipe = () =>
    Gesture.Pan()
      .activeOffsetX([-10, 10])
      .failOffsetY([-14, 14])
      .onBegin(() => {
        start.value = c.value;
      })
      .onUpdate((e) => {
        const next = start.value + e.translationX / TRAVEL;
        // Rubber-band beyond the two resting positions.
        c.value = next < 0 ? next * 0.2 : next > 1 ? 1 + (next - 1) * 0.2 : next;
      })
      .onEnd((e) => {
        const projected = c.value + (e.velocityX / 1000) * 0.3;
        const next = projected > 0.5;
        c.value = withSpring(next ? 1 : 0, { ...spring.gentle, velocity: e.velocityX / TRAVEL });
        runOnJS(settle)(next);
      });

  const railSwipe = makeSwipe();
  const tabSwipe = makeSwipe();

  const railStyle = useAnimatedStyle(() => {
    const cv = c.value;
    return {
      opacity: (1 - h.value) * interpolate(cv, [0, 0.7, 1], [1, 0.6, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: (cv + h.value) * TRAVEL },
        { scale: interpolate(cv, [0, 1], [1, 0.9], Extrapolation.CLAMP) },
      ],
    };
  });

  const tabStyle = useAnimatedStyle(() => {
    const cv = c.value;
    return {
      opacity: (1 - h.value) * interpolate(cv, [0.4, 1], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateX: interpolate(cv, [0, 1], [TAB_WIDTH + 12, 0], Extrapolation.CLAMP) + h.value * (TAB_WIDTH + 12) }],
    };
  });

  const items: SegmentItem[] = [
    { key: 'ar', label: 'AR', icon: (col) => <Cube color={col} /> },
    { key: 'camera', label: 'Camera', icon: (col) => <Camera color={col} /> },
    { key: 'details', label: 'Details', disabled: !detailsEnabled, icon: (col) => <Document color={col} /> },
  ];

  // Design places the rail at y=356 on an 844pt screen.
  const top = Math.round(height * 0.422);

  return (
    <>
      <GestureDetector gesture={railSwipe}>
        <Animated.View
          style={[styles.rail, { top }, railStyle]}
          pointerEvents={hidden || collapsed ? 'none' : 'auto'}
        >
          <GlassSegmented
            items={items}
            selectedIndex={MODES.indexOf(mode)}
            onSelect={(i) => onSelect(MODES[i])}
            direction="column"
            itemStyle={{ height: ITEM }}
            radius={RAIL_WIDTH / 2}
            highlightHeight="60%"
            accessibilityLabel="Scan mode"
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </GestureDetector>

      <GestureDetector gesture={tabSwipe}>
        <Animated.View
          style={[styles.tab, { top: top + (RAIL_HEIGHT - TAB_HEIGHT) / 2 }, tabStyle]}
          pointerEvents={!hidden && collapsed ? 'auto' : 'none'}
        >
          <PressableScale
            onPress={() => animateTo(false)}
            pressedScale={0.9}
            // The tab is 30 wide; extend the touch area to the 44 dp minimum.
            hitSlop={{ left: 10, right: 6, top: 0, bottom: 0 }}
            accessibilityRole="button"
            accessibilityLabel="Show scan modes"
            style={StyleSheet.absoluteFill}
          >
            <Glass radius={TAB_WIDTH / 2} highlightHeight="60%" style={styles.tabGlass}>
              <ChevronLeft size={18} color={g.text} />
            </Glass>
          </PressableScale>
        </Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: SIDE, width: RAIL_WIDTH, height: RAIL_HEIGHT },
  tab: { position: 'absolute', right: 6, width: TAB_WIDTH, height: TAB_HEIGHT },
  tabGlass: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
