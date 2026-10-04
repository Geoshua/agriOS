/**
 * Live detection pill (tab bar bottom accessory):
 *   [status disc]  Coffee leaf rust
 *                  92% · act within 3 days          [● pin → log to map]
 *
 * AR mode: sits above the full tab bar. Camera mode: glides down beside the
 * minimized tab bar and switches to its compact copy. Details mode: slides
 * away under the sheet. Content cross-slides when the detected disease changes;
 * the emerald pin disc morphs into a check once the issue is logged.
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
  /** Result came from the mock (no model on this device) — label it, never log it.
   *  A 'no_leaf' result is shown as a prompt and is never loggable either. */
  demo?: boolean;
}

const enter = FadeInDown.springify().damping(20).stiffness(260).withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] });
const exit = FadeOutUp.duration(140);

export default function DetectionAccessory({ mode, disease, confidence, logState, onOpen, onLog, demo = false }: Props) {
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

  // "no_leaf" is a prompt, not a diagnosis: show it like the searching state,
  // with no percentage, no details sheet and no log-to-map pin.
  const noLeaf = disease?.id === 'no_leaf';
  const diagnosis = noLeaf ? null : disease;
  const kind = diagnosis ? severityGlyph(diagnosis.severity) : null;
  const tint = diagnosis ? severityOnDark[diagnosis.severity] ?? severityOnDark.unknown : severityOnDark.unknown;
  const canLog = !!diagnosis && !demo;
  const pct = Math.round(confidence * 100);
  // "other_disease": a real leaf problem agriOS can't name — point to the officer.
  const tiny = diagnosis?.id === 'other_disease' ? 'ask officer' : severityTiny[diagnosis?.severity];

  const title = noLeaf
    ? 'No leaf found'
    : diagnosis
      ? compact
        ? shortName(diagnosis.name)
        : sentenceCase(diagnosis.name)
      : compact ? 'Find a leaf' : 'Point at a coffee leaf';
  const subtitle = noLeaf
    ? compact ? 'Point at one leaf' : 'Point at one leaf, close up'
    : diagnosis
      ? demo
        ? compact ? 'Demo · no model' : 'Demo only · no disease model on this device'
        : `${pct}% · ${compact ? tiny : severityShort[diagnosis.severity]}`
      : compact ? 'Scanning…' : 'Hold steady — scanning automatically';

  return (
    <Glass radius={ACCESSORY_HEIGHT / 2} tone="light" style={[styles.bar, barStyle]} pointerEvents={hidden ? 'none' : 'auto'}>
      <PressableScale
        pressedScale={0.97}
        onPress={onOpen}
        disabled={!diagnosis}
        style={styles.main}
        accessibilityRole="button"
        accessibilityLabel={
          noLeaf
            ? 'No leaf found. Point the camera at one leaf'
            : diagnosis ? `${diagnosis.name}, ${pct} percent. Show details` : 'Looking for a leaf'
        }
      >
        <Animated.View key={`${disease?.id ?? 'none'}-${compact}`} entering={enter} exiting={exit} style={styles.content}>
          {kind ? (
            <StatusDisc size={compact ? 32 : 36} color={tint} kind={kind} />
          ) : (
            <View style={styles.searching}>
              <Leaf size={20} color={g.accent} />
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
              {logState === 'idle' && <MapPin color={colors.onEmerald} hole={colors.emerald} />}
              {logState === 'saving' && <ActivityIndicator color={colors.onEmerald} />}
              {logState === 'saved' && <Check color={colors.onEmerald} />}
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.emeraldTint,
  },
  texts: { flex: 1, minWidth: 0 },
  title: { color: g.text, fontSize: 17, fontWeight: '700', lineHeight: 20 },
  subtitle: { color: g.textSecondary, fontSize: 14, lineHeight: 18 },
  pin: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.emerald },
  pinSaved: { borderRadius: 24, backgroundColor: colors.emeraldBright },
}));
