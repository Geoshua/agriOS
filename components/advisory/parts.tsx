/** Building blocks shared by the medium and full advisory sheet. */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import Svg, { RadialGradient, Defs, Rect, Stop } from 'react-native-svg';
import PressableScale from '../glass/PressableScale';
import { Check, MapPin, Pause, Play, StatusDisc } from '../glass/Icons';
import { colors, makeStyles, severityAction, severityChip, severityGlyph, spring, timing, useTheme } from '../../lib/theme';
import type { LogState } from '../../lib/useLogIssue';
import { playAdvisory, scriptFor, stopAll } from '../../lib/voice';
import { useShambaStore } from '../../lib/store';

// ── Severity chip ─────────────────────────────────────────────────────────────

export function SeverityChip({ severity }: { severity: string }) {
  const styles = useStyles();
  const c = severityChip[severity] ?? severityChip.unknown;
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <StatusDisc size={18} color={c.bg} kind={severityGlyph(severity)} inverted />
      <Text style={[styles.chipText, { color: c.fg }]}>{severityAction[severity] ?? ''}</Text>
    </View>
  );
}

// ── Voice advice bar ──────────────────────────────────────────────────────────

const BARS = [8, 16, 6, 22, 12, 4, 18, 10, 24, 14, 6, 20, 12, 4, 16, 10, 22, 12, 6, 16, 6, 10, 18, 8];
const WORDS_PER_SECOND = 2.3;

function estimateSeconds(text: string) {
  return Math.max(4, Math.round(text.split(/\s+/).length / WORDS_PER_SECOND));
}

export interface Voice {
  playing: boolean;
  elapsed: number;
  total: number;
  progress: SharedValue<number>;
  toggle: () => void;
}

/**
 * Voice playback for one disease, shared by every VoiceBar in the sheet.
 * Voice-pack clips report their exact length; device speech has no progress
 * events, so its length is estimated from the spoken script's word count.
 */
export function useVoice(disease: any | null, active: boolean): Voice {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const progress = useSharedValue(0);
  const voiceLanguage = useShambaStore((s) => s.voiceLanguage);
  const [total, setTotal] = useState(() => (disease ? estimateSeconds(scriptFor(voiceLanguage, disease.id)) : 0));
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const runId = useRef(0);

  function stopTicker() {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  }

  function finish() {
    stopTicker();
    setPlaying(false);
    setElapsed(0);
    cancelAnimation(progress);
    progress.value = withTiming(0, timing.slow);
  }

  async function play() {
    if (!disease) return;
    const id = ++runId.current;
    setPlaying(true);
    setElapsed(0);
    progress.value = 0;
    stopTicker();
    const info = await playAdvisory(disease.id, { onDone: () => runId.current === id && finish() });
    if (runId.current !== id) return;
    const seconds = Math.round(info.durationSec ?? estimateSeconds(scriptFor(info.language, disease.id)));
    setTotal(seconds);
    progress.value = withTiming(1, { duration: seconds * 1000, easing: Easing.linear });
    tick.current = setInterval(() => setElapsed((e) => Math.min(seconds, e + 1)), 1000);
  }

  function stop() {
    runId.current++;
    stopAll();
    finish();
  }

  useEffect(() => {
    if (active && disease) play();
    else stop();
  }, [active, disease?.id, voiceLanguage]);

  useEffect(() => () => {
    runId.current++;
    stopTicker();
    stopAll();
  }, []);

  return { playing, elapsed, total, progress, toggle: () => (playing ? stop() : play()) };
}

/** Emerald play/pause disc + waveform that fills as the advice is spoken. */
export function VoiceBar({ voice, height = 56 }: { voice: Voice; height?: number }) {
  const styles = useStyles();
  const { playing, elapsed, total, progress, toggle } = voice;
  const { c } = useTheme();
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View style={[styles.voice, { height, borderRadius: height / 2 }]}>
      <PressableScale
        onPress={toggle}
        style={[styles.voiceButton, { width: height - 8, height: height - 8, borderRadius: (height - 8) / 2 }]}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice advice' : 'Play voice advice'}
      >
        <Animated.View key={playing ? 'pause' : 'play'} entering={ZoomIn.springify().damping(14).stiffness(320)} exiting={ZoomOut.duration(100)}>
          {playing ? <Pause color={c.voiceIcon} /> : <Play color={c.voiceIcon} />}
        </Animated.View>
      </PressableScale>
      <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Waveform color={c.waveIdle} />
        <Animated.View style={[styles.waveFill, fillStyle]}>
          <Waveform color={c.waveActive} />
        </Animated.View>
      </View>
      <Text style={styles.voiceTime}>{formatTime(playing ? elapsed : total)}</Text>
    </View>
  );
}

function Waveform({ color }: { color: string }) {
  const styles = useStyles();
  return (
    <View style={styles.waveRow}>
      {BARS.map((h, i) => (
        <View key={i} style={[styles.waveBar, { height: h, backgroundColor: color }]} />
      ))}
    </View>
  );
}

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Log to map ────────────────────────────────────────────────────────────────

let btnSeq = 0;

/** The primary emerald pill. Morphs idle → saving → saved. */
export function LogButton({
  state,
  onPress,
  block,
  plantName,
  height = 54,
  style,
}: {
  state: LogState;
  onPress: () => void;
  block: string;
  /** Plant the log was grouped with — shown instead of the block once saved. */
  plantName?: string | null;
  height?: number;
  style?: any;
}) {
  const styles = useStyles();
  const [id] = useState(() => `logbtn${btnSeq++}`);
  const saved = useSharedValue(state === 'saved' ? 1 : 0);
  useEffect(() => {
    saved.value = withSpring(state === 'saved' ? 1 : 0, spring.gentle);
  }, [state]);
  const tintStyle = useAnimatedStyle(() => ({ opacity: saved.value }));

  return (
    <PressableScale
      onPress={onPress}
      disabled={state !== 'idle'}
      pressedScale={0.96}
      style={[styles.logButton, { height, borderRadius: height / 2 }, style]}
      accessibilityRole="button"
      accessibilityLabel={state === 'saved' ? `Logged to ${plantName ?? `Block ${block}`}` : 'Log to map'}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: height / 2, overflow: 'hidden' }]} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.emeraldBright }, tintStyle]} />
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id={id} cx="25%" cy="0%" rx="130%" ry="90%" fx="25%" fy="0%">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.22} />
              <Stop offset="0.55" stopColor="#fff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.logRim, { borderRadius: height / 2 }]} />
      </View>
      <Animated.View key={state} entering={FadeIn.duration(180)} style={styles.logContent}>
        {state === 'idle' && <MapPin size={20} color={colors.onPrimary} hole={colors.primary} />}
        {state === 'saving' && <ActivityIndicator color={colors.onPrimary} size="small" />}
        {state === 'saved' && (
          <Animated.View entering={ZoomIn.springify().damping(12).stiffness(300)}>
            <Check size={20} color={colors.onPrimary} />
          </Animated.View>
        )}
        <Text style={styles.logText}>
          {state === 'idle' ? 'Log to map' : state === 'saving' ? 'Saving…' : `Added to ${plantName ?? `Block ${block}`}`}
        </Text>
      </Animated.View>
    </PressableScale>
  );
}

// ── Step lists ────────────────────────────────────────────────────────────────

/** Split advice prose into short steps: "Do A. Do B." → ["Do A.", "Do B."] */
export function toSteps(text?: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\.\s+/)
    .map((t) => t.trim().replace(/\.$/, ''))
    .filter(Boolean)
    .map((t) => `${t}.`);
}

/** Tappable checklist rows ("Do This Now" in the full sheet). */
export function Checklist({ steps }: { steps: string[] }) {
  const styles = useStyles();
  const [done, setDone] = useState<boolean[]>(() => steps.map(() => false));
  useEffect(() => setDone(steps.map(() => false)), [steps.join('|')]);

  return (
    <View style={styles.group}>
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 && <View style={[styles.separator, { marginLeft: 56 }]} />}
          <PressableScale
            pressedScale={0.98}
            onPress={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))}
            style={styles.row}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done[i] }}
          >
            <CheckCircle checked={!!done[i]} />
            <Text style={[styles.rowText, done[i] && styles.rowTextDone]}>{step}</Text>
          </PressableScale>
        </React.Fragment>
      ))}
    </View>
  );
}

function CheckCircle({ checked }: { checked: boolean }) {
  const styles = useStyles();
  const p = useSharedValue(checked ? 1 : 0);
  useEffect(() => {
    p.value = withSpring(checked ? 1 : 0, spring.pop);
  }, [checked]);
  const fill = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.5 + 0.5 * p.value }] }));
  return (
    <View style={styles.checkCircle}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.checkFill, fill]}>
        <Check size={16} color={colors.onPrimary} />
      </Animated.View>
    </View>
  );
}

export function NumberedList({ steps }: { steps: string[] }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 && <View style={[styles.separator, { marginLeft: 58 }]} />}
          <View style={styles.row}>
            <View style={styles.numberBadge}>
              <Text style={styles.numberText}>{i + 1}</Text>
            </View>
            <Text style={styles.rowText}>{step}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  chip: {
    alignSelf: 'flex-start',
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 17,
  },
  chipText: { fontSize: 15, fontWeight: '700' },

  voice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 4, paddingRight: 18, backgroundColor: c.cardRaised },
  voiceButton: { backgroundColor: c.voiceButton, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, height: 26, justifyContent: 'center' },
  waveFill: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden', justifyContent: 'center' },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 26 },
  waveBar: { width: 4, borderRadius: 2 },
  voiceTime: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], color: c.label },

  logButton: { alignItems: 'center', justifyContent: 'center', shadowColor: colors.emerald, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  logRim: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.4)' },
  logContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logText: { color: colors.onPrimary, fontSize: 17, fontWeight: '700' },

  group: { borderRadius: 26, backgroundColor: c.card, overflow: 'hidden' },
  separator: { height: 1, backgroundColor: c.separator },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 15, paddingHorizontal: 16 },
  rowText: { flex: 1, fontSize: 17, lineHeight: 24, color: c.label },
  rowTextDone: { color: c.labelTertiary, textDecorationLine: 'line-through' },
  checkCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: c.checkBorder, marginTop: -1 },
  checkFill: { margin: -2, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  numberBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.numberBadge, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  numberText: { fontSize: 15, fontWeight: '800', color: c.accentText },
}));
