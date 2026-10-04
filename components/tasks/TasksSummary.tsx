/**
 * Compact "To do" card for the top of the Plants tab: counts (colour + word),
 * which blocks need water, the next 3 items, and "See all" → /tasks.
 * No props; reloads when data changes.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Href, router } from 'expo-router';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import PressableScale from '../glass/PressableScale';
import { Check } from '../glass/Icons';
import { ActionIcon } from '../insights/Visuals';
import TaskRow, { TASK_COLOR } from './TaskRow';
import { subjectLabel, useTasks } from './useTasks';
import { colors, makeStyles, onColor, useTheme } from '../../lib/theme';

const openTasks = () => router.push('/tasks' as Href);

export default function TasksSummary() {
  const styles = useStyles();
  const { c } = useTheme();
  const { data } = useTasks();

  if (!data) return <View style={[styles.card, { minHeight: 120 }]} />;

  const { counts, open } = data.list;
  const thirsty = data.watering.filter((w) => w.subject.kind === 'block' && w.status.dueToday).map((w) => (w.subject.kind === 'block' ? w.subject.block : ''));
  const next = open.slice(0, 3);

  return (
    <Animated.View layout={LinearTransition.springify().damping(24)} style={styles.card}>
      <PressableScale pressedScale={0.98} onPress={openTasks} style={styles.head} accessibilityRole="button" accessibilityLabel="Open to do list">
        <Text style={styles.title}>To Do</Text>
        <Text style={styles.seeAll}>See all ›</Text>
      </PressableScale>

      <View style={styles.chips}>
        {counts.overdue > 0 && <Pill color={TASK_COLOR.overdue} text={`${counts.overdue} overdue`} />}
        <Pill color={counts.today ? TASK_COLOR.today : TASK_COLOR.week} text={`${counts.today} today`} />
        {thirsty.length > 0 && (
          <View style={[styles.pill, { backgroundColor: TASK_COLOR.water }]}>
            <ActionIcon type="watered" size={14} color={onColor(TASK_COLOR.water)} />
            <Text style={[styles.pillText, { color: onColor(TASK_COLOR.water) }]}>Water {thirsty.length > 2 ? `${thirsty.length} blocks` : thirsty.map((b) => `Block ${b}`).join(', ')}</Text>
          </View>
        )}
      </View>

      {next.length ? (
        <View style={styles.list}>
          {next.map((item, i) => (
            <Animated.View key={item.key} entering={FadeIn.duration(220)} layout={LinearTransition.springify().damping(24)}>
              {i > 0 && <View style={styles.sep} />}
              <TaskRow item={item} subject={subjectLabel(item, data.plants)} now={data.now} compact onPress={openTasks} />
            </Animated.View>
          ))}
        </View>
      ) : (
        <View style={styles.allDone}>
          <View style={styles.doneDisc}>
            <Check size={18} color={colors.onPrimary} />
          </View>
          <Text style={[styles.allDoneText, { color: c.labelSecondary }]}>All done for now</Text>
        </View>
      )}
    </Animated.View>
  );
}

function Pill({ color, text }: { color: string; text: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.pill, { backgroundColor: color }]}>
      <Text style={[styles.pillText, { color: onColor(color) }]}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { paddingTop: 6, paddingBottom: 10, borderRadius: 26, backgroundColor: c.card, gap: 8, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 16 },
  title: { fontSize: 20, fontWeight: '700', color: c.label },
  seeAll: { fontSize: 16, fontWeight: '700', color: colors.emeraldBright },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14 },
  pillText: { fontSize: 14, fontWeight: '800' },
  list: {},
  sep: { height: 1, marginLeft: 68, backgroundColor: c.separator },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16 },
  doneDisc: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  allDoneText: { fontSize: 16, fontWeight: '600' },
}));
