/**
 * One to-do row: icon · title · place + due (colour + word) · big ✓.
 * Tap the row (or "…") to open a small row of extra actions: Tomorrow
 * (snooze) and, for the farmer's own tasks, Delete. Every target ≥ 44 dp.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import PressableScale from '../glass/PressableScale';
import { Check, Trash } from '../glass/Icons';
import { ActionIcon } from '../insights/Visuals';
import type { ActionType } from '../../lib/db';
import { doneLabel, dueLabel, groupFor, repeatLabel, TaskIcon, TaskItem } from '../../lib/tasks';
import { colors, makeStyles, useTheme } from '../../lib/theme';

export const TASK_COLOR = {
  overdue: '#D70015',
  today: '#D86A00',
  week: '#248A3D',
  later: '#8E8E93',
  water: '#0A84FF',
};

const ACTION_TYPES = new Set(['sprayed', 'pruned', 'fertilised', 'removed_leaves', 'watered', 'rained', 'none']);

/** Glyph for any task icon: the action icons, plus a few of our own. */
export function TaskGlyph({ icon, size = 22, color = '#000' }: { icon: TaskIcon; size?: number; color?: string }) {
  if (ACTION_TYPES.has(icon)) return <ActionIcon type={icon as ActionType} size={size} color={color} />;
  const s = { fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {icon === 'scan' && <Path {...s} d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 12h8" />}
      {icon === 'officer' && <Path {...s} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5c.8-3.6 3.9-6 7.5-6s6.7 2.4 7.5 6" />}
      {icon === 'eye' && (
        <>
          <Path {...s} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <Circle {...s} cx={12} cy={12} r={3} />
        </>
      )}
      {icon === 'task' && <Path {...s} d="M8 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5H16M9 3.5h6v3H9zM8.5 13.5l2.5 2.5 4.5-5" />}
    </Svg>
  );
}

export function Clock({ size = 20, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function dueColor(item: TaskItem, now: number): string {
  if (item.doneAt != null) return TASK_COLOR.week;
  return TASK_COLOR[groupFor(item.dueAt, now)];
}

interface Props {
  item: TaskItem;
  subject: string;
  now: number;
  /** Compact = no extra actions (summary card). */
  compact?: boolean;
  onPress?: () => void;
  onComplete?: (item: TaskItem) => void;
  onSnooze?: (item: TaskItem) => void;
  onDelete?: (item: TaskItem) => void;
}

export default function TaskRow({ item, subject, now, compact, onPress, onComplete, onSnooze, onDelete }: Props) {
  const styles = useStyles();
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const done = item.doneAt != null;
  const color = item.kind === 'water' && !done ? TASK_COLOR.water : dueColor(item, now);
  const due = done ? doneLabel(item.doneAt!, now) : dueLabel(item.dueAt, now);
  const repeat = repeatLabel(item.repeatDays);
  const urgentColor = done ? c.labelTertiary : TASK_COLOR[groupFor(item.dueAt, now)];

  // A repeating task stays in the list with a new due date — clear the check.
  useEffect(() => {
    setChecked(false);
    setOpen(false);
  }, [item.dueAt]);

  function complete() {
    if (checked || !onComplete) return;
    setChecked(true);
    // Let the check pop before the row leaves.
    setTimeout(() => onComplete(item), 420);
  }

  return (
    <Animated.View layout={LinearTransition.springify().damping(24)} style={styles.wrap}>
      <PressableScale
        pressedScale={0.98}
        onPress={onPress ?? (() => !compact && !done && setOpen((o) => !o))}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${subject}, ${due}`}
      >
        <View style={[styles.icon, { backgroundColor: done ? c.fill : color + '22' }]}>
          <TaskGlyph icon={item.icon} size={24} color={done ? c.labelTertiary : color} />
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.subject} numberOfLines={1}>{subject}</Text>
            <View style={[styles.dot, { backgroundColor: urgentColor }]} />
            <Text style={[styles.due, { color: urgentColor }]} numberOfLines={1}>{due}</Text>
            {repeat && !done && <Text style={styles.subject} numberOfLines={1}>· {repeat}</Text>}
          </View>
        </View>
        {!compact && !done && (
          <PressableScale onPress={() => setOpen((o) => !o)} style={styles.more} accessibilityRole="button" accessibilityLabel="More">
            <Text style={styles.moreText}>•••</Text>
          </PressableScale>
        )}
        {done ? (
          <View style={[styles.check, styles.checkOn]}>
            <Check size={22} color="#FFFFFF" />
          </View>
        ) : onComplete ? (
          <PressableScale
            onPress={complete}
            style={[styles.check, checked && styles.checkOn]}
            accessibilityRole="button"
            accessibilityLabel={`Done: ${item.title}`}
          >
            {checked ? (
              <Animated.View entering={ZoomIn.springify().damping(11)}>
                <Check size={24} color="#FFFFFF" />
              </Animated.View>
            ) : (
              <Check size={22} color={c.checkBorder} />
            )}
          </PressableScale>
        ) : null}
      </PressableScale>

      {open && !compact && (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.drawer}>
          {item.why ? <Text style={styles.why}>{item.why}</Text> : null}
          <View style={styles.drawerButtons}>
            {onSnooze && (
              <PressableScale onPress={() => onSnooze(item)} style={styles.drawerBtn} accessibilityRole="button" accessibilityLabel="Move to tomorrow">
                <Clock size={20} color={c.label} />
                <Text style={styles.drawerText}>Tomorrow</Text>
              </PressableScale>
            )}
            {item.kind === 'custom' && onDelete && (
              <PressableScale onPress={() => onDelete(item)} style={styles.drawerBtn} accessibilityRole="button" accessibilityLabel="Delete task">
                <Trash size={20} color={TASK_COLOR.overdue} />
                <Text style={[styles.drawerText, { color: TASK_COLOR.overdue }]}>Delete</Text>
              </PressableScale>
            )}
          </View>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { backgroundColor: c.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingLeft: 12, paddingRight: 10, paddingVertical: 8 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 17, fontWeight: '600', color: c.label },
  titleDone: { color: c.labelTertiary, textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  subject: { fontSize: 14, color: c.labelSecondary },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  due: { fontSize: 14, fontWeight: '700' },
  more: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '800', letterSpacing: 1, color: c.labelTertiary },
  check: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
    borderColor: c.checkBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  drawer: { paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  why: { fontSize: 15, lineHeight: 21, color: c.labelSecondary },
  drawerButtons: { flexDirection: 'row', gap: 8 },
  drawerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 16, borderRadius: 14, backgroundColor: c.fill },
  drawerText: { fontSize: 16, fontWeight: '600', color: c.label },
}));
