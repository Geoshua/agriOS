/**
 * Live detection pill (tab bar bottom accessory):
 *   [status disc]  Coffee leaf rust
 *                  92% · act within 3 days          [pin → log to map]
 *
 * AR mode: sits above the full tab bar. Camera mode: glides down beside the
 * minimized tab bar and switches to its compact copy. Details mode: slides
 * away under the sheet. Content cross-slides when the detected disease changes;
 * the pin morphs into a check once the issue is logged.
 */

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import Glass from '../glass/Glass';
import PressableScale from '../glass/PressableScale';
import { Check, Leaf, MapPin, StatusDisc } from '../glass/Icons';
import { colors, makeStyles, sentenceCase, useTheme, severityGlyph, severityOnDark, severityShort, severityTiny, spring, timing } from '../../lib/theme';
import type { ScanMode } from '../../lib/store';
import type { LogState } from '../../lib/useLogIssue';
import { ACCESSORY_HEIGHT, MINI_SIZE, SIDE, useChromeInsets } from '../../lib/layout';

interface Props {
  mode: ScanMode;
  disease: any | null;
  confidence: number;
  logState: LogState;
  onOpen: () => void;
  onLog: () => void;
}

const enter = FadeInDown.springify().damping(20).stiffness(260).withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] });
const exit = FadeOutUp.duration(140);

export default function DetectionAccessory({ mode, disease, confidence, logState, onOpen, onLog }: Props) {
  const { accessoryBottom, miniBottom, tabBottom } = useChromeInsets();
  const { g } = useTheme();
  const styles = useStyles();
  const compact = mode === 'camera';
  const hidden = mode === 'details';

  const c = useSharedValue(compact ? 1 : 0);
  const h = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    c.value = withSpring(compact ? 1 : 0, spring.gentle);
  }, [compact]);
  useEffect(() => {
    h.value = hidden ? withTiming(1, timing.base) : withSpring(0, spring.gentle);
  }, [hidden]);

  const barStyle = useAnimatedStyle(() => ({
    left: interpolate(c.value, [0, 1], [SIDE, SIDE + MINI_SIZE + 10]),
    bottom: interpolate(c.value, [0, 1], [accessoryBottom, miniBottom]),
    opacity: 1 - h.value,
    transform: [{ translateY: h.value * (accessoryBottom + ACCESSORY_HEIGHT + tabBottom) }],
  }), [accessoryBottom, miniBottom, tabBottom]);

  const kind = disease ? severityGlyph(disease.severity) : null;
  const tint = disease ? severityOnDark[disease.severity] ?? severityOnDark.unknown : severityOnDark.unknown;
  const canLog = !!disease;
  const pct = Math.round(confidence * 100);

  const title = disease
    ? compact
      ? shortName(disease.name)
      : sentenceCase(disease.name)
    : compact ? 'Find a leaf' : 'Point at a coffee leaf';
  const subtitle = disease
    ? `${pct}% · ${compact ? severityTiny[disease.severity] : severityShort[disease.severity]}`
    : compact ? 'Scanning…' : 'Hold steady — scanning automatically';

  return (
    <Glass radius={29} style={[styles.bar, barStyle]} pointerEvents={hidden ? 'none' : 'auto'}>
      <PressableScale
        pressedScale={0.97}
        onPress={onOpen}
        disabled={!disease}
        style={styles.main}
        accessibilityRole="button"
        accessibilityLabel={disease ? `${disease.name}, ${pct} percent. Show details` : 'Looking for a leaf'}
      >
        <Animated.View key={`${disease?.id ?? 'none'}-${compact}`} entering={enter} exiting={exit} style={styles.content}>
          {kind ? (
            <StatusDisc size={compact ? 32 : 34} color={tint} kind={kind} />
          ) : (
            <View style={styles.searching}>
              <Leaf size={20} color={g.textSecondary} />
            </View>
          )}
          <View style={styles.texts}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          </View>
        </Animated.View>
      </PressableScale>

      {canLog && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)}>
          <PressableScale
            onPress={() => onLog()}
            disabled={logState !== 'idle'}
            style={styles.pin}
            accessibilityRole="button"
            accessibilityLabel={logState === 'saved' ? 'Logged to map' : 'Log to map'}
          >
            {logState === 'saved' && (
              <Animated.View entering={ZoomIn.springify().damping(16).stiffness(260)} style={[StyleSheet.absoluteFill, styles.pinSaved]} />
            )}
            <Animated.View key={logState} entering={ZoomIn.springify().damping(14).stiffness(300)} exiting={ZoomOut.duration(120)}>
              {logState === 'idle' && <MapPin color={g.pin} hole={g.pinHole} />}
              {logState === 'saving' && <ActivityIndicator color={g.text} />}
              {logState === 'saved' && <Check color={colors.white} />}
            </Animated.View>
          </PressableScale>
        </Animated.View>
      )}
    </Glass>
  );
}

/** "Coffee Leaf Rust" → "Leaf rust" for the compact pill. */
function shortName(name: string) {
  return sentenceCase(name.replace(/^coffee\s+/i, ''));
}

const useStyles = makeStyles((c, g) => ({
  bar: {
    position: 'absolute',
    right: SIDE,
    height: ACCESSORY_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 6,
  },
  main: { flex: 1, height: ACCESSORY_HEIGHT, justifyContent: 'center' },
  content: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searching: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: g.searching,
  },
  texts: { flex: 1, minWidth: 0 },
  title: { color: g.text, fontSize: 17, fontWeight: '600', lineHeight: 20 },
  subtitle: { color: g.textSecondary, fontSize: 14, lineHeight: 18 },
  pin: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  pinSaved: { borderRadius: 23, backgroundColor: '#30D158' },
}));
