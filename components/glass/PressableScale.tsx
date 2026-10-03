/** Pressable with a crisp spring scale + dim on press — used for every tappable glass control. */

import React, { useEffect } from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { AnimatedStyle, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { spring, timing } from '../../lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Scale while pressed (default 0.94). */
  pressedScale?: number;
  children?: React.ReactNode;
}

export default function PressableScale({ style, pressedScale = 0.94, onPressIn, onPressOut, disabled, children, ...rest }: Props) {
  const pressed = useSharedValue(0);
  const enabled = useSharedValue(disabled ? 0 : 1);

  useEffect(() => {
    enabled.value = withTiming(disabled ? 0 : 1, timing.base);
  }, [disabled]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - pressedScale) * pressed.value }],
    opacity: (0.4 + 0.6 * enabled.value) * (1 - 0.15 * pressed.value),
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.value = withTiming(1, timing.fast);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withSpring(0, spring.press);
        onPressOut?.(e);
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
