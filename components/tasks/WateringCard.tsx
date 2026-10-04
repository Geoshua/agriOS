/**
 * Watering card for a block or a tagged tree: how often (−/+), when it was
 * last watered (rain counts), when it's next due, the last 14 days as drops,
 * and two big buttons — "Watered" and "It rained" — with Undo.
 *
 * A tree follows its block's plan until the farmer changes its own interval.
 * The interval is her plan, not a soil-moisture reading (CLAUDE.md: honest).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import PressableScale from '../glass/PressableScale';
import { Check, ChevronDown } from '../glass/Icons';
import { ActionIcon } from '../insights/Visuals';
import {
  ActionRecord,
  deleteAction,
  deleteWateringPlan,
  getAllActions,
  getWateringPlans,
  logAction,
  setWateringPlan,
  WateringPlanRecord,
} from '../../lib/db';
import {
  agoWord,
  clampEveryDays,
  dueWord,
  MAX_WATER_EVERY_DAYS,
  MIN_WATER_EVERY_DAYS,
  planFor,
  startOfDay,
  WaterSource,
  wateringActionsFor,
  wateringStatus,
} from '../../lib/watering';
import { useShambaStore } from '../../lib/store';
import { colors, makeStyles, useTheme } from '../../lib/theme';
import { TASK_COLOR } from './TaskRow';

const DAY = 86_400_000;
const WATER = '#0A84FF';

export type WateringSubject = { kind: 'block'; block: string } | { kind: 'plant'; id: number; block: string | null };

interface Props {
  subject: WateringSubject;
  /** Optional heading override (default "Watering"). */
  title?: string;
  /** Start folded: status + log buttons only; tap the header for history and the −/+ plan. */
  compact?: boolean;
}

export default function WateringCard({ subject, title = 'Watering', compact = false }: Props) {
  const styles = useStyles();
  const { c } = useTheme();
  const dataVersion = useShambaStore((s) => s.dataVersion);
  const bumpData = useShambaStore((s) => s.bumpData);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [plans, setPlans] = useState<WateringPlanRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Interval being edited (optimistic; saved after a short pause). */
  const [draft, setDraft] = useState<number | null>(null);
  const [logged, setLogged] = useState<{ id: number; type: WaterSource } | null>(null);
  const [expanded, setExpanded] = useState(!compact);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subjectKey = subject.kind === 'block' ? `b${subject.block}` : `p${subject.id}:${subject.block}`;

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAllActions(), getWateringPlans()])
      .then(([a, p]) => {
        if (cancelled) return;
        setActions(a);
        setPlans(p);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataVersion, subjectKey]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const now = Date.now();
  const plan = planFor(subject, plans);
  const every = draft ?? plan.everyDays;
  const relevant = wateringActionsFor(subject, actions);
  const status = wateringStatus({ everyDays: every, actions: relevant, now });
  const stateColor = status.neverLogged ? TASK_COLOR.later : status.overdueDays > 0 ? TASK_COLOR.overdue : status.dueToday ? TASK_COLOR.today : TASK_COLOR.week;
  const isTree = subject.kind === 'plant';
  const Header = (compact ? PressableScale : View) as React.ComponentType<any>;

  function changeEvery(delta: number) {
    const next = clampEveryDays(every + delta);
    if (next === every) return;
    setDraft(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (subject.kind === 'block') await setWateringPlan('block', subject.block, next);
      else await setWateringPlan('plant', String(subject.id), next);
      setDraft(null);
      bumpData();
    }, 600);
  }

  async function resetToBlockPlan() {
    if (subject.kind !== 'plant') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await deleteWateringPlan('plant', String(subject.id));
    setDraft(null);
    bumpData();
  }

  async function log(type: WaterSource) {
    const id = await logAction({
      type,
      plantId: subject.kind === 'plant' ? subject.id : null,
      block: subject.block,
      issueId: null,
      diseaseId: null,
      timestamp: Date.now(),
      source: 'user',
      synced: false,
    });
    bumpData();
    setLogged({ id, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setLogged(null), 5000);
  }

  async function undo() {
    if (!logged) return;
    await deleteAction(logged.id);
    bumpData();
    setLogged(null);
  }

  // Last 14 days, oldest → newest.
  const today = startOfDay(now);
  const strip = Array.from({ length: 14 }, (_, i) => {
    const day = today - (13 - i) * DAY;
    const hits = relevant.filter((a) => startOfDay(Math.min(a.timestamp, now)) === startOfDay(day));
    return hits.some((a) => a.type === 'watered') ? 'watered' : hits.length ? 'rained' : null;
  });

  const lastLine = status.neverLogged
    ? 'No watering logged yet'
    : status.lastSource === 'rained'
      ? `Rained ${agoWord(status.daysSinceLast)}`
      : `Watered ${agoWord(status.daysSinceLast)}`;

  return (
    <Animated.View layout={LinearTransition.springify().damping(24)} style={styles.card}>
      {/* Header: drop + title + status pill (colour + icon + word) */}
      <Header
        {...(compact
          ? { pressedScale: 0.98, onPress: () => setExpanded((e) => !e), accessibilityRole: 'button' as const, accessibilityState: { expanded } }
          : {})}
        style={styles.header}
      >
        <View style={styles.dropBadge}>
          <ActionIcon type="watered" size={24} color={WATER} />
        </View>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {loaded && (
          <Animated.View key={dueWord(status)} entering={FadeIn.duration(200)} style={[styles.pill, { backgroundColor: stateColor }]}>
            {status.dueToday ? <Alert /> : <Check size={14} color="#FFFFFF" />}
            <Text style={styles.pillText}>{dueWord(status)}</Text>
          </Animated.View>
        )}
        {compact && (
          <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
            <ChevronDown size={14} color={c.labelTertiary} />
          </View>
        )}
      </Header>

      {/* Last watered + history strip */}
      <View style={styles.lastRow}>
        {status.lastSource && <ActionIcon type={status.lastSource} size={20} color={c.labelSecondary} />}
        <Text style={styles.lastText}>{lastLine}</Text>
      </View>
      {expanded && (
      <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.more}>
      <View style={styles.strip} accessibilityLabel={`${status.timesLast30Days} times in the last 30 days`}>
        {strip.map((s, i) => (
          <View key={i} style={[styles.stripCell, s === 'watered' && { backgroundColor: WATER }, s === 'rained' && { backgroundColor: WATER + '66' }, i === 13 && styles.stripToday]}>
            {s && <ActionIcon type={s} size={12} color="#FFFFFF" />}
          </View>
        ))}
      </View>
      <View style={styles.stripLegend}>
        <Text style={styles.small}>2 weeks ago</Text>
        <Text style={styles.small}>
          {status.timesLast30Days}× in 30 days{status.averageIntervalDays != null ? ` · about every ${Math.round(status.averageIntervalDays)} days` : ''}
        </Text>
        <Text style={styles.small}>Today</Text>
      </View>

      {/* Interval stepper */}
      <View style={styles.stepRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepLabel}>Water every</Text>
          <Text style={styles.small}>
            {isTree ? (plan.from === 'own' || draft != null ? 'This tree only' : `Same as Block ${subject.block ?? '–'}`) : plan.from === 'default' && draft == null ? 'Usual plan — change it to fit your farm' : 'Your plan · rain counts'}
          </Text>
        </View>
        <PressableScale
          onPress={() => changeEvery(-1)}
          disabled={every <= MIN_WATER_EVERY_DAYS}
          style={styles.stepBtn}
          accessibilityRole="button"
          accessibilityLabel="Water more often"
        >
          <Text style={styles.stepBtnText}>−</Text>
        </PressableScale>
        <View style={styles.stepValue}>
          <Animated.Text key={every} entering={ZoomIn.duration(160)} style={styles.stepNumber}>{every}</Animated.Text>
          <Text style={styles.small}>{every === 1 ? 'day' : 'days'}</Text>
        </View>
        <PressableScale
          onPress={() => changeEvery(1)}
          disabled={every >= MAX_WATER_EVERY_DAYS}
          style={styles.stepBtn}
          accessibilityRole="button"
          accessibilityLabel="Water less often"
        >
          <Text style={styles.stepBtnText}>+</Text>
        </PressableScale>
      </View>
      {isTree && plan.from === 'own' && draft == null && (
        <PressableScale onPress={resetToBlockPlan} style={styles.linkBtn} accessibilityRole="button">
          <Text style={styles.linkText}>Use the block's plan</Text>
        </PressableScale>
      )}
      </Animated.View>
      )}

      {/* Log buttons */}
      <View style={styles.buttons}>
        <PressableScale onPress={() => log('watered')} style={[styles.bigBtn, { backgroundColor: WATER }]} accessibilityRole="button" accessibilityLabel="Watered">
          <ActionIcon type="watered" size={24} color="#FFFFFF" />
          <Text style={styles.bigBtnText}>Watered</Text>
        </PressableScale>
        <PressableScale onPress={() => log('rained')} style={[styles.bigBtn, styles.rainBtn]} accessibilityRole="button" accessibilityLabel="It rained">
          <ActionIcon type="rained" size={24} color={c.label} />
          <Text style={[styles.bigBtnText, { color: c.label }]}>It rained</Text>
        </PressableScale>
      </View>

      {logged && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={styles.toast}>
          <Animated.View entering={ZoomIn.springify().damping(12)}>
            <Check size={18} color={colors.primary} />
          </Animated.View>
          <Text style={styles.toastText}>Saved: {logged.type === 'rained' ? 'It rained' : 'Watered'}</Text>
          <PressableScale onPress={undo} style={styles.undo} accessibilityRole="button" accessibilityLabel="Undo">
            <Text style={styles.undoText}>Undo</Text>
          </PressableScale>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function Alert() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round">
      <Path d="M12 5v9M12 19h.01" />
    </Svg>
  );
}

const useStyles = makeStyles((c) => ({
  card: { padding: 16, borderRadius: 26, backgroundColor: c.card, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  more: { gap: 12 },
  dropBadge: { width: 40, height: 40, borderRadius: 13, backgroundColor: WATER + '22', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 19, fontWeight: '700', color: c.label },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  pillText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lastText: { fontSize: 17, fontWeight: '600', color: c.label },
  strip: { flexDirection: 'row', gap: 4 },
  stripCell: { flex: 1, aspectRatio: 1, maxHeight: 24, borderRadius: 6, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  stripToday: { borderWidth: 2, borderColor: c.labelTertiary },
  stripLegend: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: -6 },
  small: { fontSize: 13, color: c.labelTertiary },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepLabel: { fontSize: 16, fontWeight: '600', color: c.label },
  stepBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 26, fontWeight: '600', color: c.label, marginTop: -2 },
  stepValue: { minWidth: 48, alignItems: 'center' },
  stepNumber: { fontSize: 24, fontWeight: '800', color: c.label, fontVariant: ['tabular-nums'] },
  linkBtn: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  buttons: { flexDirection: 'row', gap: 10 },
  bigBtn: { flex: 1, minHeight: 56, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  rainBtn: { backgroundColor: c.fill },
  bigBtnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, borderRadius: 14, backgroundColor: c.fill },
  toastText: { flex: 1, fontSize: 15, fontWeight: '600', color: c.label },
  undo: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  undoText: { fontSize: 15, fontWeight: '700', color: colors.primary },
}));
