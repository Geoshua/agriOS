/**
 * BrandMark — the AgriOS emblem in a small rounded pod, shown top-left on
 * every main screen. `glass` floats over the camera / map; `pod` sits on the
 * ground colour of scrolling screens. Decorative: it is hidden from screen
 * readers because the screen title already names the app context.
 */

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Glass from './Glass';
import { Emblem } from './Icons';
import { colors } from '../../lib/theme';

interface Props {
  size?: number;
  tone?: 'glass' | 'pod';
  style?: StyleProp<ViewStyle>;
}

export default function BrandMark({ size = 44, tone = 'pod', style }: Props) {
  const radius = Math.round(size * 0.32);
  const emblem = <Emblem size={Math.round(size * 0.58)} />;
  if (tone === 'glass') {
    return (
      <Glass radius={radius} tone="light" style={[styles.box, { width: size, height: size }, style]} pointerEvents="none">
        {emblem}
      </Glass>
    );
  }
  return (
    <View
      style={[styles.box, styles.pod, { width: size, height: size, borderRadius: radius }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {emblem}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  pod: { backgroundColor: colors.pod, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
});
