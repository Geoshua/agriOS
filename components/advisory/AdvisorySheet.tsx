/**
 * Advisory sheet with two detents, per the Glass designs:
 *
 *   medium — inset Liquid Glass half sheet, concentric with the display corners;
 *            the camera keeps running above it.
 *   full   — opaque full-height sheet ("Advice") that holds focus and stays
 *            readable in sun; the camera recedes behind it.
 *
 * A single shared value `pos` drives everything (0 closed · 1 medium · 2 full):
 * sheet geometry, material, which content is visible, and — via `onPosition` —
 * how far the camera recedes. Drag the grabber/header to move between detents.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  FadeInDown,
  interpolate,
  interpolateColor,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from '../glass/PressableScale';
import { Backdrop } from '../glass/Glass';
import { ChevronUp, Close, Share as ShareIcon, TrendDown } from '../glass/Icons';
import SpeechInput from '../SpeechInput';
import { Checklist, LogButton, NumberedList, SeverityChip, toSteps, useVoice, VoiceBar } from './parts';
import { makeStyles, sentenceCase, spring, useTheme } from '../../lib/theme';
import { withAlpha } from '../../lib/useTween';
import type { LogState } from '../../lib/useLogIssue';
import { useShambaStore } from '../../lib/store';

export type Detent = 'closed' | 'medium' | 'full';
const DETENT_POS: Record<Detent, number> = { closed: 0, medium: 1, full: 2 };

interface Props {
  disease: any | null;
  confidence: number;
  /** Log-to-map state, shared with the detection pill so an issue is only logged once. */
  logState: LogState;
  /** Plant the last log was grouped with, if any. */
  plantName?: string | null;
  onLog: (notes?: string) => void;
  detent: Detent;
  onDetentChange: (d: Detent) => void;
  /** Shared sheet position so the screen behind can react (0 closed · 1 medium · 2 full). */
  pos: SharedValue<number>;
}

const INSET = 8;
const RADIUS = 47;

export default function AdvisorySheet({ disease: liveDisease, confidence: liveConfidence, logState, plantName, onLog: log, detent, onDetentChange, pos }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activeBlock = useShambaStore((s) => s.activeBlock);
  const { c, g, scheme } = useTheme();
  const styles = useStyles();
  // Sheet ground fades from clear (glass detent) to opaque (full detent).
  const groundClear = withAlpha(c.groundGrouped, 0);
  const groundSolid = withAlpha(c.groundGrouped, 1);

  // Keep showing the last disease while the sheet animates closed.
  const last = useRef<{ disease: any; confidence: number } | null>(null);
  if (liveDisease && detent !== 'closed') last.current = { disease: liveDisease, confidence: liveConfidence };
  const disease = last.current?.disease ?? null;
  const confidence = last.current?.confidence ?? 0;

  const voice = useVoice(disease, detent !== 'closed');

  // Farmer's own observation, saved with the logged issue. Cleared per detection.
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (detent === 'closed') setNotes('');
  }, [detent, disease?.id]);

  // Full content is mounted only while expanded so its sections stagger in each time.
  const [fullMounted, setFullMounted] = useState(detent === 'full');
  useEffect(() => {
    if (detent === 'full') setFullMounted(true);
    else {
      const t = setTimeout(() => setFullMounted(false), 350);
      return () => clearTimeout(t);
    }
  }, [detent]);

  const mediumTop = Math.round(height * 0.5);
  const fullTop = insets.top + 7;
  const closedOffset = height - mediumTop + 40;
  const expandRange = mediumTop - fullTop;

  // Detent changes from a drag are already springing with the finger's velocity.
  const settledByGesture = useRef<Detent | null>(null);
  useEffect(() => {
    if (settledByGesture.current === detent) {
      settledByGesture.current = null;
      return;
    }
    pos.value = withSpring(DETENT_POS[detent], detent === 'closed' ? { ...spring.gentle, overshootClamping: true } : spring.gentle);
  }, [detent]);

  function commitDrag(target: Detent) {
    if (target !== detent) settledByGesture.current = target;
    onDetentChange(target);
  }

  // ── Drag between detents ────────────────────────────────────────────────────
  const startPos = useSharedValue(0);
  // Each GestureDetector needs its own gesture object — one per drag zone.
  const makeDrag = () => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onBegin(() => {
      startPos.value = pos.value;
    })
    .onUpdate((e) => {
      const p = startPos.value;
      const delta = p > 1 || (p === 1 && e.translationY < 0) ? -e.translationY / expandRange : -e.translationY / closedOffset;
      let next = p + delta;
      if (next > 2) next = 2 + (next - 2) * 0.15; // rubber-band past full
      pos.value = Math.max(0, next);
    })
    .onEnd((e) => {
      const projected = pos.value - (e.velocityY / 1000) * 0.35;
      const target: Detent = projected > 1.5 ? 'full' : projected > 0.55 ? 'medium' : 'closed';
      pos.value = withSpring(DETENT_POS[target], { ...spring.gentle, velocity: -e.velocityY / (target === 'full' ? expandRange : closedOffset) });
      runOnJS(commitDrag)(target);
    });
  const mediumDrag = makeDrag();
  const fullDrag = makeDrag();

  // ── Animated geometry & material ────────────────────────────────────────────
  const sheetStyle = useAnimatedStyle(() => {
    const p = pos.value;
    const e = interpolate(p, [1, 2], [0, 1], Extrapolation.CLAMP); // expansion 0→1
    const inset = INSET * (1 - e);
    return {
      top: interpolate(e, [0, 1], [mediumTop, fullTop]),
      left: inset,
      right: inset,
      bottom: inset,
      borderBottomLeftRadius: RADIUS * (1 - e),
      borderBottomRightRadius: RADIUS * (1 - e),
      // Transparent at medium (the glass layer provides blur + tint), opaque paper at full.
      backgroundColor: interpolateColor(e, [0, 0.5], [groundClear, groundSolid]),
      transform: [{ translateY: interpolate(p, [0, 1], [closedOffset, 0], Extrapolation.CLAMP) }],
    };
  }, [mediumTop, fullTop, closedOffset, groundClear, groundSolid]);

  const glassStyle = useAnimatedStyle(() => ({ opacity: interpolate(pos.value, [1, 1.7], [1, 0], Extrapolation.CLAMP) }));
  const mediumStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pos.value, [1, 1.35], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(pos.value, [1, 1.5], [0, -16], Extrapolation.CLAMP) }],
  }));
  const fullStyle = useAnimatedStyle(() => ({ opacity: interpolate(pos.value, [1.45, 1.9], [0, 1], Extrapolation.CLAMP) }));

  if (!disease) return null;

  const immediate = toSteps(disease.immediateAction);
  const treatment = toSteps(disease.treatment);
  const pct = Math.round(confidence * 100);

  function share() {
    Share.share({
      message: `${disease.name}${disease.scientificName ? ` (${disease.scientificName})` : ''} — ${pct}% match, Block ${activeBlock}.\n\n${disease.description}\n\nDo this now: ${disease.immediateAction}`,
    });
  }

  return (
    <Animated.View
      style={[styles.sheet, sheetStyle]}
      pointerEvents={detent === 'closed' ? 'none' : 'auto'}
      accessibilityViewIsModal={detent !== 'closed'}
    >
      {/* Glass material for the medium detent; fades as the sheet turns opaque. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.clip, glassStyle]} pointerEvents="none">
        <Backdrop intensity={30} tint={scheme} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.sheetGlass }]} />
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="sheetHi" cx="25%" cy="0%" rx="120%" ry="50%" fx="25%" fy="0%">
              <Stop offset="0" stopColor="#fff" stopOpacity={0.75} />
              <Stop offset="0.55" stopColor="#fff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheetHi)" />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.rim]} />
      </Animated.View>

      {/* ── Medium detent ── */}
      <Animated.View style={[styles.medium, mediumStyle]} pointerEvents={detent === 'medium' ? 'box-none' : 'none'}>
        <GestureDetector gesture={mediumDrag}>
          <View style={styles.dragZone}>
            <View style={styles.grabber} />
            <View style={styles.mediumHeader}>
              <SeverityChip severity={disease.severity} />
              <PressableScale onPress={() => onDetentChange('closed')} style={styles.closeButton} accessibilityLabel="Close and go back to scanner">
                <Close size={18} color={c.label} />
              </PressableScale>
            </View>
            <View style={styles.titleBlock}>
              <Text style={styles.titleMedium} numberOfLines={1}>{sentenceCase(disease.name)}</Text>
              <Text style={styles.subtitle}>
                {disease.scientificName ? <Text style={styles.italic}>{disease.scientificName}</Text> : null}
                {disease.scientificName ? ' · ' : ''}
                {pct}% match
              </Text>
            </View>
          </View>
        </GestureDetector>

        <VoiceBar voice={voice} />

        {immediate.length > 0 && (
          <View style={styles.doNow}>
            <Text style={styles.doNowTitle}>Do This Now</Text>
            {immediate.slice(0, 2).map((step, i) => (
              <View key={i} style={styles.doNowRow}>
                <Text style={[styles.doNowNumber, { color: c.label }]}>{i + 1}</Text>
                <Text style={styles.doNowText} numberOfLines={2}>{step}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.mediumActions}>
          <LogButton state={logState} onPress={() => log(notes)} block={activeBlock} plantName={plantName} style={{ flex: 1 }} />
          <PressableScale onPress={() => onDetentChange('full')} style={styles.moreButton} accessibilityLabel="More advice">
            <Text style={styles.moreText}>More</Text>
            <ChevronUp color={c.label} />
          </PressableScale>
        </View>
      </Animated.View>

      {/* ── Full detent ── */}
      <Animated.View style={[StyleSheet.absoluteFill, fullStyle]} pointerEvents={detent === 'full' ? 'box-none' : 'none'}>
        <GestureDetector gesture={fullDrag}>
          <View style={styles.fullHeader}>
            <PressableScale onPress={() => onDetentChange('medium')} style={styles.headerButton} accessibilityLabel="Close">
              <Close size={16} color={c.labelStrong} />
            </PressableScale>
            <Text style={styles.headerTitle}>Advice</Text>
            <PressableScale onPress={share} style={styles.headerButton} accessibilityLabel="Send to extension officer">
              <ShareIcon color={c.labelStrong} />
            </PressableScale>
          </View>
        </GestureDetector>

        {fullMounted && (
          <ScrollView
            contentContainerStyle={[styles.fullContent, { paddingBottom: 140 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Animated.View entering={FadeInDown.duration(320).delay(40)} style={styles.fullTitleBlock}>
              <SeverityChip severity={disease.severity} />
              <Text style={styles.titleFull}>{sentenceCase(disease.name)}</Text>
              <Text style={[styles.subtitle, { fontSize: 17 }]}>
                {disease.scientificName ? <Text style={styles.italic}>{disease.scientificName}</Text> : null}
                {disease.scientificName ? ' · ' : ''}
                {pct}% match
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(320).delay(90)}>
              <VoiceBar voice={voice} height={60} />
            </Animated.View>

            {immediate.length > 0 && (
              <Animated.View entering={FadeInDown.duration(320).delay(140)} style={styles.section}>
                <Text style={styles.sectionTitle}>Do This Now</Text>
                <Checklist steps={immediate} />
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.duration(320).delay(190)} style={styles.section}>
              <Text style={styles.sectionTitle}>What It Is</Text>
              <Text style={styles.card}>{disease.description}</Text>
            </Animated.View>

            {treatment.length > 0 && (
              <Animated.View entering={FadeInDown.duration(320).delay(240)} style={styles.section}>
                <Text style={styles.sectionTitle}>Treatment</Text>
                <NumberedList steps={treatment} />
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.duration(320).delay(340)} style={styles.section}>
              <Text style={styles.sectionTitle}>Your Observations</Text>
              <View style={styles.notesCard}>
                <Text style={styles.notesHint}>Describe what you see — in any language. Saved with the pin.</Text>
                <SpeechInput onTranscript={setNotes} placeholder="Hold the mic or type…" />
              </View>
            </Animated.View>

            {disease.yieldImpact ? (
              <Animated.View entering={FadeInDown.duration(320).delay(290)} style={styles.impact}>
                <View style={styles.impactIcon}>
                  <TrendDown />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.impactTitle}>Yield Impact</Text>
                  <Text style={styles.impactText}>{disease.yieldImpact}</Text>
                </View>
              </Animated.View>
            ) : null}
          </ScrollView>
        )}

        {/* Scroll-edge fade + pinned action */}
        <View style={styles.fade} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="sheetFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.groundGrouped} stopOpacity={0} />
                <Stop offset="0.45" stopColor={c.groundGrouped} stopOpacity={0.92} />
                <Stop offset="1" stopColor={c.groundGrouped} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheetFade)" />
          </Svg>
        </View>
        <LogButton
          state={logState}
          onPress={() => log(notes)}
          block={activeBlock}
          plantName={plantName}
          height={58}
          style={[styles.pinnedLog, { bottom: Math.max(insets.bottom, 16) + 10 }]}
        />
      </Animated.View>
    </Animated.View>
  );
}

const useStyles = makeStyles((c, g) => ({
  sheet: {
    position: 'absolute',
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  clip: { borderRadius: RADIUS, overflow: 'hidden' },
  rim: {
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: g.rim,
    borderTopWidth: 1,
    borderTopColor: g.rimTop,
  },

  medium: { flex: 1, paddingHorizontal: 18, paddingBottom: 16, gap: 14 },
  dragZone: { gap: 14 },
  grabber: { alignSelf: 'center', marginTop: 8, width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(60,60,67,0.3)' },
  mediumHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: -6 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fillStrong },
  titleBlock: { gap: 2 },
  titleMedium: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, color: c.label },
  subtitle: { fontSize: 16, color: c.labelSecondary },
  italic: { fontStyle: 'italic' },
  doNow: { gap: 6 },
  doNowTitle: { fontSize: 17, fontWeight: '700', color: c.label },
  doNowRow: { flexDirection: 'row', gap: 8 },
  doNowNumber: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  doNowText: { flex: 1, fontSize: 16, lineHeight: 22, color: c.label },
  mediumActions: { marginTop: 'auto', flexDirection: 'row', gap: 10 },
  moreButton: {
    height: 54,
    paddingHorizontal: 18,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.fill,
  },
  moreText: { fontSize: 17, fontWeight: '600', color: c.label },

  fullHeader: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill },
  headerTitle: { fontSize: 17, fontWeight: '600', color: c.label },
  fullContent: { paddingHorizontal: 16, paddingTop: 4, gap: 18 },
  fullTitleBlock: { gap: 8, paddingHorizontal: 4 },
  titleFull: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6, lineHeight: 36, color: c.label },
  section: { gap: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '700', paddingHorizontal: 4, color: c.label },
  card: { padding: 16, borderRadius: 26, backgroundColor: c.card, fontSize: 17, lineHeight: 25, color: c.labelStrong, overflow: 'hidden' },
  notesCard: { padding: 16, gap: 10, borderRadius: 26, backgroundColor: c.card },
  notesHint: { fontSize: 15, lineHeight: 21, color: c.labelSecondary },
  impact: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 16, borderRadius: 26, backgroundColor: c.card },
  impactIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#C93400', alignItems: 'center', justifyContent: 'center' },
  impactTitle: { fontSize: 17, fontWeight: '600', color: c.label },
  impactText: { fontSize: 16, lineHeight: 23, color: c.labelSecondary },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  pinnedLog: { position: 'absolute', left: 20, right: 20 },
}));
