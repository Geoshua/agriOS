/**
 * To Do — everything the farmer might do next, in one place:
 *   Watering per block (log it, change how often) →
 *   Overdue / Today / This week / Later (her own tasks + watering due +
 *   "Do this next" advice from scans) → Done (last 7 days).
 * Ticking a task only records what she says she did (human in the loop).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import ScreenTransition from '../components/glass/ScreenTransition';
import Glass from '../components/glass/Glass';
import PressableScale from '../components/glass/PressableScale';
import { Check, ChevronLeft } from '../components/glass/Icons';
import TaskRow from '../components/tasks/TaskRow';
import WateringCard from '../components/tasks/WateringCard';
import AddTaskForm from '../components/tasks/AddTaskForm';
import { completeItem, deleteItem, snoozeItem, subjectLabel, Undo, useTasks } from '../components/tasks/useTasks';
import { dueLabel, type TaskItem } from '../lib/tasks';
import ReadAloudButton from '../components/ReadAloudButton';
import { colors, makeStyles, useTheme } from '../lib/theme';
import { useChromeInsets } from '../lib/layout';

const layout = LinearTransition.springify().damping(24).stiffness(240);
const enter = (i: number) => FadeInDown.duration(360).delay(60 + Math.min(i, 8) * 60);

const GROUP_COLOR: Record<string, string> = {
  overdue: '#D70015',
  today: '#D86A00',
  week: '#248A3D',
  later: '#8E8E93',
  done: '#8E8E93',
};

export default function TasksScreen() {
  const styles = useStyles();
  const { c } = useTheme();
  const { top, tabBottom } = useChromeInsets();
  const { data, loading } = useTasks();
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo: Undo } | null>(null);
  const [showAllWater, setShowAllWater] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function showToast(text: string, undo: Undo) {
    setToast({ text, undo });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  }

  const label = (item: TaskItem) => (data ? subjectLabel(item, data.plants) : '');
  const onComplete = async (item: TaskItem) => showToast(`Done: ${item.title}`, await completeItem(item));
  const onSnooze = async (item: TaskItem) => showToast(`Tomorrow: ${item.title}`, await snoozeItem(item));
  const onDelete = async (item: TaskItem) => showToast(`Deleted: ${item.title}`, await deleteItem(item));

  const blocks = data?.watering.filter((w) => w.subject.kind === 'block') ?? [];
  const trees = data?.watering.filter((w) => w.subject.kind === 'plant') ?? [];
  // Blocks needing water first; the rest folded behind "Show all".
  const dueBlocks = blocks.filter((w) => w.status.dueToday);
  const shownWater = showAllWater || dueBlocks.length === 0 ? [...blocks, ...trees] : [...dueBlocks, ...trees.filter((t) => t.status.dueToday)];
  const hiddenWater = blocks.length + trees.length - shownWater.length;
  const openCount = data ? data.list.open.length : 0;

  /** Spoken summary: what needs water, then the first few jobs. */
  function tasksPageText(): string {
    if (!data) return 'Your to do list is loading.';
    const water = blocks.filter((w) => w.status.dueToday).map((w) => w.label);
    const waterLine = water.length ? `Needs water now: ${water.join(', ')}.` : 'No block needs water today.';
    const open = data.list.open;
    if (open.length === 0) return `To do. ${waterLine} Nothing else to do right now.`;
    const first = open.slice(0, 4).map((t, i) => `${i + 1}. ${t.title}, ${label(t)}, ${dueLabel(t.dueAt, data.now).toLowerCase()}.`).join(' ');
    return `To do. ${waterLine} You have ${open.length} ${open.length === 1 ? 'job' : 'jobs'}. ${first} Tap the circle when a job is done.`;
  }

  return (
    <ScreenTransition background={c.groundGrouped}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: top + 56, paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={enter(0)} style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">To Do</Text>
          {data && (
            <Text style={styles.subtitle}>
              {openCount === 0 ? 'All done' : `${openCount} to do`}
              {data.list.counts.overdue ? ` · ${data.list.counts.overdue} overdue` : ''}
            </Text>
          )}
        </Animated.View>

        {loading && !data ? (
          <ActivityIndicator color={c.labelSecondary} style={{ marginTop: 60 }} />
        ) : data ? (
          <>
            {/* Watering */}
            <Animated.View entering={enter(1)} layout={layout} style={styles.section}>
              <Text style={styles.sectionTitle}>Watering</Text>
              {shownWater.map((w, i) => (
                <Animated.View key={w.subject.kind === 'block' ? `b${w.subject.block}` : `p${w.subject.id}`} entering={enter(2 + i)} layout={layout}>
                  <WateringCard subject={w.subject} title={w.label} compact />
                </Animated.View>
              ))}
              {hiddenWater > 0 && (
                <PressableScale onPress={() => setShowAllWater(true)} style={styles.linkBtn} accessibilityRole="button">
                  <Text style={styles.linkText}>Show all {blocks.length + trees.length} places</Text>
                </PressableScale>
              )}
            </Animated.View>

            {/* Add task */}
            <Animated.View entering={enter(3)} layout={layout} style={styles.section}>
              {adding ? (
                <AddTaskForm plants={data.plants} onDone={() => setAdding(false)} />
              ) : (
                <PressableScale onPress={() => setAdding(true)} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="Add task">
                  <Text style={styles.addPlus}>+</Text>
                  <Text style={styles.addText}>Add task</Text>
                </PressableScale>
              )}
            </Animated.View>

            {/* Groups */}
            {data.list.groups.map((g, gi) => (
              <Animated.View key={g.key} entering={enter(4 + gi)} layout={layout} style={styles.section}>
                <View style={styles.groupHead}>
                  <View style={[styles.groupDot, { backgroundColor: GROUP_COLOR[g.key] }]} />
                  <Text style={styles.sectionTitle}>{g.title}</Text>
                  <Text style={styles.groupCount}>{g.items.length}</Text>
                </View>
                <View style={styles.list}>
                  {g.items.map((item, i) => (
                    <Animated.View key={item.key} entering={FadeIn.duration(240)} exiting={FadeOut.duration(200)} layout={layout}>
                      {i > 0 && <View style={styles.sep} />}
                      <TaskRow
                        item={item}
                        subject={label(item)}
                        now={data.now}
                        onComplete={g.key === 'done' ? undefined : onComplete}
                        onSnooze={onSnooze}
                        onDelete={onDelete}
                      />
                    </Animated.View>
                  ))}
                </View>
              </Animated.View>
            ))}

            {openCount === 0 && (
              <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.empty}>
                <View style={styles.emptyCheck}>
                  <Check size={34} color="#FFFFFF" />
                </View>
                <Text style={styles.emptyText}>Nothing to do right now</Text>
              </Animated.View>
            )}

            <Text style={styles.note}>
              Advice comes from your scans and simple farming rules. Watering times are your own plan — rain counts as watering.
            </Text>
          </>
        ) : (
          <Text style={styles.note}>Could not load tasks.</Text>
        )}
      </ScrollView>

      <View style={[styles.backRow, { top }]} pointerEvents="box-none">
        <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Glass radius={22} style={styles.back}>
            <ChevronLeft color={c.label} />
            <Text style={styles.backText}>Back</Text>
          </Glass>
        </PressableScale>
        <ReadAloudButton text={() => tasksPageText()} size={44} />
      </View>

      {toast && (
        <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(160)} style={[styles.toastWrap, { bottom: tabBottom + 8 }]} pointerEvents="box-none">
          <Glass radius={20} style={styles.toast}>
            <Animated.View entering={ZoomIn.springify().damping(12)}>
              <Check size={20} color={colors.primary} />
            </Animated.View>
            <Text style={styles.toastText} numberOfLines={1}>{toast.text}</Text>
            <PressableScale
              onPress={async () => {
                const t = toast;
                setToast(null);
                await t.undo();
              }}
              style={styles.undo}
              accessibilityRole="button"
              accessibilityLabel="Undo"
            >
              <Text style={styles.undoText}>Undo</Text>
            </PressableScale>
          </Glass>
        </Animated.View>
      )}
    </ScreenTransition>
  );
}

const useStyles = makeStyles((c) => ({
  content: { paddingHorizontal: 16, gap: 22 },
  header: { gap: 2, paddingHorizontal: 4 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6, color: c.label },
  subtitle: { fontSize: 16, color: c.labelSecondary },
  section: { gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: '700', paddingHorizontal: 4, color: c.label },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 4 },
  groupDot: { width: 10, height: 10, borderRadius: 5 },
  groupCount: { fontSize: 17, fontWeight: '600', color: c.labelTertiary },
  list: { borderRadius: 22, backgroundColor: c.card, overflow: 'hidden' },
  sep: { height: 1, marginLeft: 68, backgroundColor: c.separator },
  linkBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  linkText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
  },
  addPlus: { fontSize: 26, fontWeight: '600', color: '#FFFFFF', marginTop: -3 },
  addText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  emptyCheck: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 17, fontWeight: '600', color: c.labelSecondary },
  note: { fontSize: 13, lineHeight: 18, color: c.labelTertiary, paddingHorizontal: 4, fontStyle: 'italic' },
  backRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 44, paddingLeft: 8, paddingRight: 14 },
  backText: { fontSize: 17, fontWeight: '600', color: c.label },
  toastWrap: { position: 'absolute', left: 16, right: 16 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, minHeight: 56 },
  toastText: { flex: 1, fontSize: 16, fontWeight: '600', color: c.label },
  undo: { minHeight: 48, paddingHorizontal: 18, justifyContent: 'center' },
  undoText: { fontSize: 16, fontWeight: '700', color: colors.primary },
}));
