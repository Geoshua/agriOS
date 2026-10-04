/**
 * "What did you do?" — one tap on a big icon logs an action against a tree
 * (or block). These logs are what lets the app check its own advice later
 * ("worked 3 of 4 times on your farm"). Shows a confirmation with Undo.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import PressableScale from '../glass/PressableScale';
import { Check } from '../glass/Icons';
import { ACTION_LABEL, ActionIcon } from './Visuals';
import { ActionType, deleteAction, getIssue, logAction } from '../../lib/db';
import { useShambaStore } from '../../lib/store';
import { colors, makeStyles, useTheme } from '../../lib/theme';

const ALL_TYPES: ActionType[] = ['sprayed', 'pruned', 'fertilised', 'removed_leaves', 'watered', 'none'];
/** For unclear or healthy results: no treatments (CLAUDE.md rule 5 — don't nudge spraying). */
export const CARE_TYPES: ActionType[] = ['pruned', 'watered', 'none'];

interface Props {
  plantId: number | null;
  block: string | null;
  issueId?: number | null;
  diseaseId?: string | null;
  title?: string;
  /** Which buttons to offer (default: all). */
  types?: ActionType[];
}

export default function ActionLogger({ plantId, block, issueId = null, diseaseId = null, title = 'What did you do?', types = ALL_TYPES }: Props) {
  const styles = useStyles();
  const { c } = useTheme();
  const bumpData = useShambaStore((s) => s.bumpData);
  const [logged, setLogged] = useState<{ id: number; type: ActionType } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function log(type: ActionType) {
    // Linked to a scan: use that scan's tree/block/disease as they are *now* (it may have been tagged since).
    const issue = issueId != null ? await getIssue(issueId) : null;
    const id = await logAction({
      type,
      plantId: issue?.plantId ?? plantId,
      block: issue?.block ?? block,
      issueId,
      diseaseId: issue?.diseaseId ?? diseaseId,
      timestamp: Date.now(),
      source: 'user',
      synced: false,
    });
    bumpData();
    setLogged({ id, type });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLogged(null), 5000);
  }

  async function undo() {
    if (!logged) return;
    await deleteAction(logged.id);
    bumpData();
    setLogged(null);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.grid}>
        {types.map((t) => (
          <PressableScale key={t} onPress={() => log(t)} style={[styles.button, logged?.type === t && styles.buttonOn]} accessibilityRole="button" accessibilityLabel={ACTION_LABEL[t]}>
            <ActionIcon type={t} size={26} color={logged?.type === t ? '#FFFFFF' : c.label} />
            <Text style={[styles.label, logged?.type === t && { color: '#FFFFFF' }]} numberOfLines={2}>
              {ACTION_LABEL[t]}
            </Text>
          </PressableScale>
        ))}
      </View>
      {logged && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={styles.toast}>
          <Animated.View entering={ZoomIn.springify().damping(12)}>
            <Check size={18} color={colors.primary} />
          </Animated.View>
          <Text style={styles.toastText}>Saved: {ACTION_LABEL[logged.type]}</Text>
          <PressableScale onPress={undo} style={styles.undo} accessibilityRole="button" accessibilityLabel="Undo">
            <Text style={styles.undoText}>Undo</Text>
          </PressableScale>
        </Animated.View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: 10 },
  title: { fontSize: 17, fontWeight: '700', color: c.label },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    width: '31.5%',
    minHeight: 76,
    borderRadius: 18,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  buttonOn: { backgroundColor: colors.primary },
  label: { fontSize: 13, fontWeight: '600', color: c.label, textAlign: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, borderRadius: 14, backgroundColor: c.card },
  toastText: { flex: 1, fontSize: 15, fontWeight: '600', color: c.label },
  undo: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  undoText: { fontSize: 15, fontWeight: '700', color: c.accentText },
}));
