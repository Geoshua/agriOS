/**
 * "Test a photo": pick an image from the phone's gallery and run the same
 * classifier as the live scan on it. A reliable way to check the model on
 * known photos (field pictures, held-out dataset images) without fighting
 * camera framing, light or focus. Shown in full-camera mode, left of the shutter.
 */

import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import PressableScale from '../glass/PressableScale';
import Glass from '../glass/Glass';
import { colors } from '../../lib/theme';
import { MINI_SIZE, SIDE, useChromeInsets } from '../../lib/layout';

// Builds made before expo-image-picker was added lack the native module;
// importing it eagerly crashed the whole Scan screen. Load lazily, hide if absent.
const PICKER_AVAILABLE = !!requireOptionalNativeModule('ExponentImagePicker');

export default function GalleryButton({ onPicked }: { onPicked: (uri: string) => Promise<void> }) {
  const { miniBottom } = useChromeInsets();
  const [busy, setBusy] = useState(false);

  if (!PICKER_AVAILABLE) return null;

  async function pick() {
    const ImagePicker = await import('expo-image-picker');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    setBusy(true);
    try {
      await onPicked(res.assets[0].uri);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.wrap, { bottom: miniBottom + MINI_SIZE + 31 }]} pointerEvents="box-none">
      <PressableScale onPress={pick} disabled={busy} accessibilityRole="button" accessibilityLabel="Test a photo from the gallery">
        <Glass radius={28} tone="light" style={styles.button}>
          {busy ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={colors.cream} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Rect x={3} y={4} width={18} height={16} rx={3} />
              <Circle cx={9} cy={10} r={1.8} />
              <Path d="m21 16-5-5-9 9" />
            </Svg>
          )}
        </Glass>
      </PressableScale>
      <Text style={styles.label}>Photo</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: SIDE + 12, alignItems: 'center', gap: 4 },
  button: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.cream, fontSize: 13, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
});
