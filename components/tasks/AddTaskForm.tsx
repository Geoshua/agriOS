/**
 * Inline "Add task" form: quick-pick jobs (icon + one word) or typed title,
 * where (farm / block / tree chips), when (Today / Tomorrow / Next week) and
 * repeat (None / Every week / Every 2 weeks). Saves offline to SQLite.
 */

import React, { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import PressableScale from '../glass/PressableScale';
import type { PlantRecord } from '../../lib/db';
import { plantLabel } from '../../lib/plants';
import { startOfDay } from '../../lib/watering';
import { iconForTitle } from '../../lib/tasks';
import { FIELD_BLOCKS } from '../../lib/store';
import { colors, makeStyles, useTheme } from '../../lib/theme';
import { TaskGlyph } from './TaskRow';
import { createTask } from './useTasks';

const QUICK = ['Weed', 'Spray', 'Prune', 'Feed', 'Water', 'Pick cherries', 'Check trees'];
const DUE = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'Next week', days: 7 },
];
const REPEAT = [
  { label: 'Once', days: null },
  { label: 'Every week', days: 7 },
  { label: 'Every 2 weeks', days: 14 },
];

type Where = { plantId: number | null; block: string | null; label: string };

export default function AddTaskForm({ plants, onDone }: { plants: PlantRecord[]; onDone: () => void }) {
  const styles = useStyles();
  const { c } = useTheme();
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState<Where>({ plantId: null, block: null, label: 'Farm' });
  const [due, setDue] = useState(0);
  const [repeat, setRepeat] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const places: Where[] = [
    { plantId: null, block: null, label: 'Farm' },
    ...FIELD_BLOCKS.map((b) => ({ plantId: null, block: b, label: `Block ${b}` })),
    ...plants.filter((p) => p.tag != null).map((p) => ({ plantId: p.id, block: p.block, label: plantLabel(p) })),
  ];
  const canSave = title.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const d = new Date(startOfDay(Date.now()));
    d.setDate(d.getDate() + due);
    await createTask({ title: title.trim(), plantId: where.plantId, block: where.block, dueAt: d.getTime(), repeatDays: repeat });
    setSaving(false);
    onDone();
  }

  return (
    <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(160)} layout={LinearTransition.springify().damping(24)} style={styles.card}>
      <Text style={styles.label}>What?</Text>
      <View style={styles.wrapRow}>
        {QUICK.map((q) => (
          <Chip key={q} on={title === q} onPress={() => setTitle(q)}>
            <TaskGlyph icon={iconForTitle(q)} size={18} color={title === q ? colors.onPrimary : c.label} />
            <Text style={[styles.chipText, title === q && styles.chipTextOn]}>{q}</Text>
          </Chip>
        ))}
      </View>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Or type a job…"
        placeholderTextColor={c.labelTertiary}
        style={styles.input}
        maxLength={60}
        returnKeyType="done"
      />

      <Text style={styles.label}>Where?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
        {places.map((p) => {
          const on = p.plantId === where.plantId && p.block === where.block;
          return (
            <Chip key={p.label} on={on} onPress={() => setWhere(p)}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.label}</Text>
            </Chip>
          );
        })}
      </ScrollView>

      <Text style={styles.label}>When?</Text>
      <View style={styles.wrapRow}>
        {DUE.map((d) => (
          <Chip key={d.label} on={due === d.days} onPress={() => setDue(d.days)}>
            <Text style={[styles.chipText, due === d.days && styles.chipTextOn]}>{d.label}</Text>
          </Chip>
        ))}
      </View>

      <Text style={styles.label}>Repeat?</Text>
      <View style={styles.wrapRow}>
        {REPEAT.map((r) => (
          <Chip key={r.label} on={repeat === r.days} onPress={() => setRepeat(r.days)}>
            <Text style={[styles.chipText, repeat === r.days && styles.chipTextOn]}>{r.label}</Text>
          </Chip>
        ))}
      </View>

      <View style={styles.actions}>
        <PressableScale onPress={onDone} style={[styles.btn, styles.cancel]} accessibilityRole="button">
          <Text style={[styles.btnText, { color: c.label }]}>Cancel</Text>
        </PressableScale>
        <PressableScale onPress={save} disabled={!canSave} style={[styles.btn, styles.save]} accessibilityRole="button" accessibilityLabel="Save task">
          <Text style={styles.btnText}>Save</Text>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

function Chip({ on, onPress, children }: { on: boolean; onPress: () => void; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <PressableScale onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      {children}
    </PressableScale>
  );
}

const useStyles = makeStyles((c) => ({
  card: { padding: 16, borderRadius: 26, backgroundColor: c.card, gap: 10 },
  label: { fontSize: 15, fontWeight: '700', color: c.labelSecondary, marginTop: 2 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scrollRow: { gap: 8, paddingRight: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: c.fill },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 16, fontWeight: '600', color: c.label },
  chipTextOn: { color: colors.onPrimary },
  input: { minHeight: 48, borderRadius: 24, paddingHorizontal: 16, fontSize: 17, color: c.label, backgroundColor: c.cardRaised, borderWidth: 1, borderColor: c.separator },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: { flex: 1, minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: c.fill },
  save: { backgroundColor: colors.primary },
  btnText: { fontSize: 17, fontWeight: '700', color: colors.onPrimary },
}));
