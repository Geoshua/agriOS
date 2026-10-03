/**
 * ScreenTransition — fades + settles a tab screen in whenever it gains focus,
 * so switching tabs never hard-cuts, and sets the status bar to match.
 *
 * `backdrop` renders behind the animated layer and is never faded or scaled:
 * native surfaces like Google Maps render blank on Android under an animated
 * parent, so the map goes there and only the controls on top animate.
 */

import React, { useCallback } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { spring, useTheme } from '../../lib/theme';

interface Props {
  children: React.ReactNode;
  background: string;
  /** Defaults to the theme: light text in dark mode, dark text in light mode. */
  statusBar?: 'light' | 'dark';
  backdrop?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export default function ScreenTransition({ children, background, statusBar, backdrop, style }: Props) {
  const { scheme } = useTheme();
  const barStyle = statusBar ?? (scheme === 'dark' ? 'light' : 'dark');
  const progress = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(barStyle, true);
      progress.value = 0;
      progress.value = withSpring(1, spring.gentle);
    }, [barStyle]),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.5),
    transform: [{ scale: 0.975 + 0.025 * progress.value }],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      {backdrop}
      <Animated.View style={[StyleSheet.absoluteFill, style, animatedStyle]} pointerEvents="box-none">
        {children}
      </Animated.View>
    </View>
  );
}
