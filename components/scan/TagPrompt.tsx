/**
 * Shown right after a scan is logged: "Tag to a tree?" with the nearest
 * tagged tree first. Optional — ignoring it (or Skip) leaves the scan in its
 * block. Dismisses itself after a while; confirms briefly once tagged.
 */

import React, { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutUp, ZoomIn } from 'react-native-reanimated';
import Glass from '../glass/Glass';
import PressableScale from '../glass/PressableScale';
import { Check } from '../glass/Icons';
import TagPicker from '../insights/TagPicker';
import { useShambaStore } from '../../lib/store';
import { colors, makeStyles, sentenceCase, useTheme } from '../../lib/theme';
import { SIDE, useChromeInsets } from '../../lib/layout';

const AUTO_DISMISS_MS = 12_000;

export default function TagPrompt() {
  const styles = useStyles();
  const { g } = useTheme();
  const { top } = useChromeInsets();
  const pending = useShambaStore((s) => s.pendingTag);
  const setPending = useShambaStore((s) => s.setPendingTag);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tagged = pending?.taggedAs;
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!pending) return;
    timer.current = setTimeout(() => setPending(null), tagged ? 1800 : AUTO_DISMISS_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pending?.issueId, tagged]);

  if (!pending) return null;

  return (
    <Animated.View
      key={pending.issueId}
      entering={SlideInUp.springify().damping(20).stiffness(220)}
      exiting={SlideOutUp.duration(220)}
      style={[styles.wrap, { top: top + 60 }]}
    >
      <Glass radius={24} style={styles.card}>
        {tagged ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.doneRow}>
            <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.doneDot}>
              <Check size={16} color="#FFFFFF" />
            </Animated.View>
            <Text style={[styles.title, { color: g.text }]}>Added to {tagged}</Text>
          </Animated.View>
        ) : (
          <Animated.View exiting={FadeOut.duration(120)} style={{ gap: 10 }}>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: g.text }]}>Tag to a tree?</Text>
                <Text style={[styles.sub, { color: g.textSecondary }]} numberOfLines={1}>
                  {sentenceCase(pending.diseaseName)} saved in Block {pending.block ?? '–'}
                </Text>
              </View>
              <PressableScale onPress={() => setPending(null)} style={styles.skip} accessibilityRole="button" accessibilityLabel="Skip tagging">
                <Text style={[styles.skipText, { color: g.text }]}>Skip</Text>
              </PressableScale>
            </View>
            <TagPicker issueId={pending.issueId} block={pending.block} lat={pending.lat} lng={pending.lng} onGlass onTagged={() => {}} />
          </Animated.View>
        )}
      </Glass>
    </Animated.View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { position: 'absolute', left: SIDE, right: SIDE, zIndex: 50 },
  card: { padding: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  sub: { fontSize: 13 },
  skip: { minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  skipText: { fontSize: 15, fontWeight: '600' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  doneDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
}));
