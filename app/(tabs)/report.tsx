import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Href, router, useFocusEffect } from 'expo-router';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { ActionType, getAllActions, getAllIssues, getAllPlants, getTodayIssues, IssueRecord, PlantRecord } from '../../lib/db';
import { computeInsight, Insight } from '../../lib/insights';
import { localOutcomeStats } from '../../lib/outcomes';
import { plantLabel } from '../../lib/plants';
import { FIELD_BLOCKS, useShambaStore } from '../../lib/store';
import { ACTION_LABEL, HealthRing, LEVEL_COLOR, LEVEL_WORD } from '../../components/insights/Visuals';
import { colors, makeStyles, sentenceCase, severityBadge, severityPin, useTheme } from '../../lib/theme';
import { useTween } from '../../lib/useTween';
import { useChromeInsets } from '../../lib/layout';
import ScreenTransition from '../../components/glass/ScreenTransition';
import PressableScale from '../../components/glass/PressableScale';
import { Leaf, Locate, ScanFrame, Sun } from '../../components/glass/Icons';

const layoutTransition = LinearTransition.springify().damping(24).stiffness(220);
const enter = (i: number) => FadeInDown.duration(360).delay(60 + i * 60);

export default function ReportScreen() {
  const { top, tabClearance } = useChromeInsets();
  const { c, scheme } = useTheme();
  const styles = useStyles();
  const storeIssues = useShambaStore((s) => s.issues);
  const dataVersion = useShambaStore((s) => s.dataVersion);
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [farm, setFarm] = useState<FarmInsights | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  // Bumped on every focus so sections replay their entrance.
  const [visit, setVisit] = useState(0);

  const load = useCallback(async () => {
    try {
      setIssues(await getTodayIssues());
    } catch {}
    try {
      setFarm(await loadFarmInsights());
    } catch {}
    setUpdatedAt(new Date());
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [storeIssues, dataVersion, load]);

  useFocusEffect(
    useCallback(() => {
      load();
      setVisit((v) => v + 1);
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const counts = issues.reduce<Record<string, { count: number; name: string; severity: string }>>((acc, issue) => {
    acc[issue.diseaseId] ??= { count: 0, name: issue.diseaseName, severity: issue.severity };
    acc[issue.diseaseId].count++;
    return acc;
  }, {});
  const found = Object.entries(counts)
    .filter(([id]) => id !== 'healthy')
    .sort((a, b) => b[1].count - a[1].count);
  const urgentCount = issues.filter((i) => i.severity === 'high').length;
  const healthyCount = issues.filter((i) => i.severity === 'none').length;
  const empty = loaded && issues.length === 0;

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const updated = updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <ScreenTransition background={c.groundGrouped}>
      <ScrollView
        key={visit}
        contentContainerStyle={[styles.content, { paddingTop: top - 4, paddingBottom: tabClearance + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.labelTertiary} />}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeIn.duration(300)} style={styles.updated}>
          <Sun />
          <Text style={styles.updatedText}>{empty ? `Pull to refresh · updated ${updated}` : `Updated ${updated}`}</Text>
        </Animated.View>

        <Animated.View entering={enter(0)} style={styles.header}>
          <Text style={styles.date}>{today}</Text>
          <Text style={styles.title} accessibilityRole="header">Today</Text>
        </Animated.View>

        <Animated.View entering={enter(1)} style={styles.tiles}>
          <StatTile value={issues.length} label="Scans" accent={colors.primary} color={c.label} muted={empty} />
          <StatTile value={urgentCount} label="Urgent" accent="#D70015" color={c.statUrgent} muted={empty} />
          <StatTile value={healthyCount} label="Healthy" accent="#248A3D" color={c.statHealthy} muted={empty} />
        </Animated.View>

        {farm && <FarmInsightsSection farm={farm} startIndex={2} />}

        {empty ? (
          <Animated.View entering={enter(6)} style={styles.empty}>
            <View style={styles.emptyArt}>
              <Leaf size={56} color={c.checkBorder} />
            </View>
            <Text style={styles.emptyTitle}>No scans today.</Text>
            <Text style={styles.emptyBody}>Head out to the field.</Text>
            <PressableScale onPress={() => router.navigate('/scan')} style={styles.emptyButton} accessibilityRole="button">
              <ScanFrame size={20} color={colors.white} />
              <Text style={styles.emptyButtonText}>Start scanning</Text>
            </PressableScale>
          </Animated.View>
        ) : (
          <>
            {found.length > 0 && (
              <Animated.View entering={enter(6)} layout={layoutTransition} style={styles.section}>
                <Text style={styles.sectionTitle}>Found Today</Text>
                <View style={styles.group}>
                  {found.map(([id, data], i) => {
                    const badge = severityBadge[scheme][data.severity] ?? severityBadge[scheme].unknown;
                    return (
                      <Animated.View key={id} layout={layoutTransition} entering={FadeIn.duration(240)}>
                        {i > 0 && <View style={[styles.separator, { marginLeft: 40 }]} />}
                        <View style={styles.foundRow}>
                          <View style={[styles.dot12, { backgroundColor: severityPin[data.severity] ?? severityPin.unknown }, data.severity === 'low' && styles.dotEdge]} />
                          <Text style={styles.foundName} numberOfLines={1}>
                            {id === 'unknown' ? 'Unknown — with officer' : sentenceCase(data.name)}
                          </Text>
                          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                            <Text style={[styles.badgeText, { color: badge.fg }]}>{data.count}</Text>
                          </View>
                        </View>
                      </Animated.View>
                    );
                  })}
                </View>
              </Animated.View>
            )}

            <Animated.View entering={enter(7)} layout={layoutTransition} style={styles.section}>
              <Text style={styles.sectionTitle}>Timeline</Text>
              <View style={styles.group}>
                {issues.slice(0, 30).map((issue, i) => (
                  <Animated.View key={issue.id} layout={layoutTransition} entering={FadeIn.duration(240)}>
                    {i > 0 && <View style={[styles.separator, { marginLeft: 98 }]} />}
                    <View style={styles.timelineRow}>
                      <Text style={styles.time}>
                        {new Date(issue.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </Text>
                      <View style={[styles.dot10, { backgroundColor: severityPin[issue.severity] ?? severityPin.unknown }]} />
                      <View style={styles.timelineText}>
                        <Text style={styles.timelineName} numberOfLines={1}>{sentenceCase(issue.diseaseName)}</Text>
                        <Text style={styles.timelineMeta}>{issue.block ? `Block ${issue.block}` : 'No block'}</Text>
                      </View>
                      {issue.lat !== 0 ? (
                        <View style={styles.gps}>
                          <Locate size={12} color={c.gps} />
                          <Text style={styles.gpsText}>GPS</Text>
                        </View>
                      ) : (
                        <Text style={styles.noFix}>No fix</Text>
                      )}
                    </View>
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          </>
        )}
      </ScrollView>

      {/* Scroll-edge fade under the floating tab bar */}
      <View style={styles.bottomFade} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="reportFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.groundGrouped} stopOpacity={0} />
              <Stop offset="0.55" stopColor={c.groundGrouped} stopOpacity={0.85} />
              <Stop offset="1" stopColor={c.groundGrouped} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#reportFade)" />
        </Svg>
      </View>
    </ScreenTransition>
  );
}

// ── Farm insights ─────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const STALE_DAYS = 14;
const URGENCY_COLOR = { now: '#D70015', soon: '#D86A00', routine: '#248A3D' } as const;

interface FarmInsights {
  /** Block with the lowest health score (only blocks that have scans). */
  worstBlock: { block: string; insight: Insight } | null;
  /** Diseases coming back, with the blocks they came back in. */
  recurring: { diseaseId: string; name: string; blocks: string[]; count: number }[];
  /** e.g. "Sprayed for leaf rust: 3 of 4 better". */
  worked: { key: string; type: ActionType; diseaseName: string; success: number; total: number }[];
  /** Tagged trees with no scan in STALE_DAYS+ days (or never scanned). */
  unchecked: { plant: PlantRecord; days: number | null }[];
}

/** Whole-farm view, offline. Includes seeded demo history (it represents the demo farm). */
async function loadFarmInsights(): Promise<FarmInsights> {
  const [allScans, allActions, plants] = await Promise.all([getAllIssues(), getAllActions(), getAllPlants()]);
  const chrono = [...allScans].sort((a, b) => a.timestamp - b.timestamp);
  const now = Date.now();
  const localStats = localOutcomeStats(chrono, allActions);

  const blocks = FIELD_BLOCKS.map((block) => {
    const scans = chrono.filter((s) => s.block === block);
    return {
      block: block as string,
      insight: computeInsight({ kind: 'block', scans, actions: allActions.filter((a) => a.block === block), blockScans: scans, localStats, now }),
    };
  });
  const scored = blocks.filter((b) => b.insight.health.score != null);
  const worstBlock = scored.length ? scored.reduce((w, b) => ((b.insight.health.score ?? 0) < (w.insight.health.score ?? 0) ? b : w)) : null;

  // Recurrence is judged per block, so one disease on two different trees isn't "coming back".
  const rec = new Map<string, { name: string; blocks: string[]; count: number }>();
  for (const b of blocks) {
    for (const r of b.insight.recurring) {
      const e = rec.get(r.diseaseId) ?? { name: r.name, blocks: [], count: 0 };
      e.blocks.push(b.block);
      e.count += r.count;
      rec.set(r.diseaseId, e);
    }
  }
  const recurring = [...rec.entries()].map(([diseaseId, e]) => ({ diseaseId, ...e })).sort((a, b) => b.count - a.count);

  const names = new Map(chrono.map((s) => [s.diseaseId, s.diseaseName]));
  const worked: FarmInsights['worked'] = [];
  for (const [diseaseId, byAction] of Object.entries(localStats)) {
    for (const [type, stat] of Object.entries(byAction ?? {})) {
      if (!stat || stat.total === 0) continue;
      worked.push({ key: `${diseaseId}:${type}`, type: type as ActionType, diseaseName: names.get(diseaseId) ?? diseaseId, success: stat.success, total: stat.total });
    }
  }
  worked.sort((a, b) => b.total - a.total || b.success / b.total - a.success / a.total);

  const lastScan = new Map<number, number>();
  for (const s of chrono) if (s.plantId != null) lastScan.set(s.plantId, s.timestamp);
  const unchecked = plants
    .map((plant) => {
      const t = lastScan.get(plant.id);
      return { plant, days: t == null ? null : Math.floor((now - t) / DAY) };
    })
    .filter((u) => u.days == null || u.days >= STALE_DAYS)
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity));

  return { worstBlock, recurring, worked: worked.slice(0, 4), unchecked };
}

function FarmInsightsSection({ farm, startIndex }: { farm: FarmInsights; startIndex: number }) {
  const styles = useStyles();
  const { c } = useTheme();
  const { worstBlock, recurring, worked, unchecked } = farm;
  if (!worstBlock && !recurring.length && !worked.length && !unchecked.length) return null;
  const top = worstBlock?.insight.suggestions[0];
  const allGood = worstBlock?.insight.health.level === 'good';

  return (
    <Animated.View entering={enter(startIndex)} layout={layoutTransition} style={styles.section}>
      <Text style={styles.sectionTitle}>Farm Insights</Text>

      {worstBlock && (
        <Animated.View entering={enter(startIndex + 1)} layout={layoutTransition}>
          <PressableScale
            onPress={() => router.push(`/block/${worstBlock.block}` as Href)}
            pressedScale={0.97}
            style={[styles.group, styles.insightCard]}
            accessibilityRole="button"
            accessibilityLabel={`Block ${worstBlock.block}, ${LEVEL_WORD[worstBlock.insight.health.level]}${allGood ? '' : ', needs most attention'}`}
          >
            <HealthRing health={worstBlock.insight.health} size={52} />
            <View style={styles.insightText}>
              <Text style={styles.insightKicker}>{allGood ? 'All blocks look healthy · lowest:' : 'Needs most attention'}</Text>
              <Text style={styles.insightTitle}>
                Block {worstBlock.block} · <Text style={{ color: LEVEL_COLOR[worstBlock.insight.health.level] }}>{LEVEL_WORD[worstBlock.insight.health.level]}</Text>
              </Text>
              {top && (
                <Text style={[styles.insightBody, { color: URGENCY_COLOR[top.urgency] }]} numberOfLines={2}>
                  {top.title}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.labelTertiary} />
          </PressableScale>
        </Animated.View>
      )}

      {recurring.length > 0 && (
        <Animated.View entering={enter(startIndex + 2)} layout={layoutTransition} style={styles.group}>
          <View style={styles.cardHeader}>
            <Ionicons name="repeat" size={20} color="#D86A00" />
            <Text style={styles.cardHeaderText}>Coming back</Text>
          </View>
          {recurring.slice(0, 4).map((r) => (
            <View key={r.diseaseId}>
              <View style={[styles.separator, { marginLeft: 16 }]} />
              <View style={styles.listRow}>
                <View style={[styles.dot10, { backgroundColor: '#D86A00' }]} />
                <Text style={styles.listName} numberOfLines={1}>{sentenceCase(r.name)}</Text>
                <Text style={styles.listMeta}>Block {r.blocks.join(', ')}</Text>
              </View>
            </View>
          ))}
        </Animated.View>
      )}

      {worked.length > 0 && (
        <Animated.View entering={enter(startIndex + 3)} layout={layoutTransition} style={styles.group}>
          <View style={styles.cardHeader}>
            <Ionicons name="checkmark-circle" size={20} color="#248A3D" />
            <Text style={styles.cardHeaderText}>What worked on your farm</Text>
          </View>
          {worked.map((w) => (
            <View key={w.key}>
              <View style={[styles.separator, { marginLeft: 16 }]} />
              <View style={styles.listRow}>
                <Text style={styles.listName} numberOfLines={2}>
                  {ACTION_LABEL[w.type]} for {w.diseaseName.toLowerCase()}
                </Text>
                <Text style={[styles.listStrong, { color: w.success * 2 >= w.total ? c.statHealthy : c.labelSecondary }]}>
                  {w.success} of {w.total} better
                </Text>
              </View>
            </View>
          ))}
          <Text style={styles.footnote}>From the next scan after each treatment. Few cases, so a guide, not a promise.</Text>
        </Animated.View>
      )}

      {unchecked.length > 0 && (
        <Animated.View entering={enter(startIndex + 4)} layout={layoutTransition} style={styles.group}>
          <View style={styles.cardHeader}>
            <Ionicons name="time-outline" size={20} color={c.labelSecondary} />
            <Text style={styles.cardHeaderText}>
              {unchecked.length} {unchecked.length === 1 ? 'tree' : 'trees'} not checked for {STALE_DAYS}+ days
            </Text>
          </View>
          {unchecked.slice(0, 6).map((u) => (
            <View key={u.plant.id}>
              <View style={[styles.separator, { marginLeft: 16 }]} />
              <PressableScale
                onPress={() => router.push(`/plant/${u.plant.id}` as Href)}
                pressedScale={0.98}
                style={styles.listRow}
                accessibilityRole="button"
                accessibilityLabel={`${plantLabel(u.plant)}, ${u.days == null ? 'never checked' : `last checked ${u.days} days ago`}`}
              >
                <Leaf size={18} color={colors.primary} />
                <Text style={styles.listName} numberOfLines={1}>
                  {plantLabel(u.plant)}
                  {u.plant.block ? <Text style={styles.listMeta}>{`  Block ${u.plant.block}`}</Text> : null}
                </Text>
                <Text style={styles.listMeta}>{u.days == null ? 'Never' : `${u.days} days`}</Text>
                <Ionicons name="chevron-forward" size={16} color={c.labelTertiary} />
              </PressableScale>
            </View>
          ))}
          {unchecked.length > 6 && <Text style={styles.footnote}>+{unchecked.length - 6} more on the Plants tab</Text>}
        </Animated.View>
      )}
    </Animated.View>
  );
}

function StatTile({ value, label, accent, color, muted }: { value: number; label: string; accent: string; color: string; muted: boolean }) {
  // Counts roll up from zero on each visit and tick when they change.
  const styles = useStyles();
  const { c } = useTheme();
  const shown = Math.round(useTween(value, 700, 0));
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${value} ${label}`}>
      <View style={[styles.tileAccent, { backgroundColor: accent }]} />
      <Text style={[styles.tileValue, { color: muted ? c.labelTertiary : color }]}>{shown}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  content: { paddingHorizontal: 16, gap: 22 },
  updated: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  updatedText: { fontSize: 13, color: c.labelTertiary },
  header: { gap: 2, paddingHorizontal: 4 },
  date: { fontSize: 16, fontWeight: '600', color: c.labelSecondary },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.7, lineHeight: 40, color: c.label },

  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, gap: 2, paddingVertical: 14, paddingLeft: 18, paddingRight: 14, borderRadius: 26, backgroundColor: c.card, overflow: 'hidden' },
  tileAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  tileValue: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: 14, color: c.labelSecondary },

  section: { gap: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '700', paddingHorizontal: 4, color: c.label },
  group: { borderRadius: 26, backgroundColor: c.card, overflow: 'hidden' },
  separator: { height: 1, backgroundColor: c.separator },

  foundRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  dot12: { width: 12, height: 12, borderRadius: 6 },
  dotEdge: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.25)' },
  foundName: { flex: 1, fontSize: 17, color: c.label },
  badge: { minWidth: 30, height: 28, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 15, fontWeight: '700' },

  timelineRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  time: { width: 48, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], color: c.label },
  dot10: { width: 10, height: 10, borderRadius: 5 },
  timelineText: { flex: 1 },
  timelineName: { fontSize: 17, color: c.label },
  timelineMeta: { fontSize: 13, color: c.labelTertiary },
  gps: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gpsText: { fontSize: 13, fontWeight: '600', color: c.gps },
  noFix: { fontSize: 13, fontWeight: '600', color: c.labelTertiary },

  empty: { marginTop: 28, alignItems: 'center', gap: 6 },
  emptyArt: { width: 120, height: 120, borderRadius: 60, backgroundColor: c.emptyArt, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: c.label },
  emptyBody: { fontSize: 16, lineHeight: 24, color: c.labelSecondary },
  emptyButton: {
    marginTop: 14,
    height: 52,
    paddingHorizontal: 24,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
  },
  emptyButtonText: { color: colors.white, fontSize: 16, fontWeight: '600' },

  insightCard: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  insightText: { flex: 1, gap: 2 },
  insightKicker: { fontSize: 13, fontWeight: '600', color: c.labelTertiary },
  insightTitle: { fontSize: 18, fontWeight: '700', color: c.label },
  insightBody: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  cardHeader: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  cardHeaderText: { flex: 1, fontSize: 17, fontWeight: '700', color: c.label },
  listRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  listName: { flex: 1, fontSize: 16, color: c.label },
  listMeta: { fontSize: 14, color: c.labelTertiary },
  listStrong: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 13, lineHeight: 18, color: c.labelTertiary, paddingHorizontal: 16, paddingBottom: 14, paddingTop: 2 },

  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 150 },
}));
