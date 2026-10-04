/**
 * Pick the tree a scan belongs to: nearest tagged tree first (GPS hint —
 * the farmer confirms), the block's other trees, or a new numbered tag.
 * Used right after logging (TagPrompt) and later from scan history.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import PressableScale from '../glass/PressableScale';
import { suggestTrees, tagScan, tagScanAsNewTree, TreeSuggestion, plantLabel } from '../../lib/plants';
import { colors, makeStyles, useTheme } from '../../lib/theme';
import { useShambaStore } from '../../lib/store';

interface Props {
  issueId: number;
  block: string | null;
  lat: number;
  lng: number;
  /** Currently tagged tree, if any (shown as selected). */
  currentPlantId?: number | null;
  onTagged: (label: string, plantId: number) => void;
  /** Visual tone: on glass over the camera, or on a card. */
  onGlass?: boolean;
}

export default function TagPicker({ issueId, block, lat, lng, currentPlantId, onTagged, onGlass }: Props) {
  const styles = useStyles();
  const { g, c } = useTheme();
  const [trees, setTrees] = useState<TreeSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);

  const dataVersion = useShambaStore((s) => s.dataVersion);
  useEffect(() => {
    suggestTrees(block, lat, lng).then(setTrees).catch(() => setTrees([]));
  }, [block, lat, lng, dataVersion]);

  async function pick(t: TreeSuggestion) {
    if (busy) return;
    setBusy(true);
    try {
      await tagScan(issueId, t.plant);
      onTagged(plantLabel(t.plant), t.plant.id);
    } finally {
      setBusy(false);
    }
  }

  async function newTree() {
    if (busy) return;
    setBusy(true);
    try {
      const plant = await tagScanAsNewTree(issueId, block, lat, lng);
      onTagged(plantLabel(plant), plant.id);
    } finally {
      setBusy(false);
    }
  }

  const text = onGlass ? g.text : c.label;
  const sub = onGlass ? g.textSecondary : c.labelSecondary;

  if (!trees) return <ActivityIndicator color={sub} style={{ marginVertical: 12 }} />;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      <PressableScale onPress={newTree} disabled={busy} style={[styles.chip, styles.newChip]} accessibilityRole="button" accessibilityLabel="Tag as a new tree">
        <Text style={styles.newPlus}>+</Text>
        <Text style={styles.newText}>New tag</Text>
      </PressableScale>
      {trees.map((t, i) => {
        const selected = t.plant.id === currentPlantId;
        return (
          <Animated.View key={t.plant.id} entering={FadeIn.duration(200).delay(i * 40)} layout={LinearTransition}>
            <PressableScale
              onPress={() => pick(t)}
              disabled={busy || selected}
              style={[styles.chip, onGlass ? styles.chipGlass : styles.chipCard, t.near && styles.chipNear, selected && styles.chipSelected]}
              accessibilityRole="button"
              accessibilityLabel={`${plantLabel(t.plant)}${t.near ? ', nearest' : ''}`}
            >
              <Text style={[styles.chipTitle, { color: selected ? colors.onPrimary : text }]}>{plantLabel(t.plant)}</Text>
              <Text style={[styles.chipSub, { color: selected ? 'rgba(14,12,8,0.72)' : sub }]}>
                {selected ? 'tagged' : t.near ? 'nearest' : t.distanceM != null ? `${Math.round(t.distanceM)} m` : `Block ${t.plant.block ?? '–'}`}
              </Text>
            </PressableScale>
          </Animated.View>
        );
      })}
      {trees.length === 0 && (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: sub }]}>No tagged trees in this block yet.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  row: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: { minHeight: 48, minWidth: 64, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  chipGlass: { backgroundColor: 'rgba(242,234,216,0.12)' },
  chipCard: { backgroundColor: c.fill },
  chipNear: { borderWidth: 2, borderColor: colors.emeraldBright },
  chipSelected: { backgroundColor: colors.primary },
  chipTitle: { fontSize: 15, fontWeight: '700' },
  chipSub: { fontSize: 12, fontWeight: '500' },
  newChip: { flexDirection: 'row', gap: 4, backgroundColor: colors.primary },
  newPlus: { color: colors.onPrimary, fontSize: 20, fontWeight: '700', marginTop: -2 },
  newText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  empty: { justifyContent: 'center', paddingHorizontal: 6 },
  emptyText: { fontSize: 13 },
}));
