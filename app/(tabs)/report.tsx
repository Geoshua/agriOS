import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { getTodayIssues, IssueRecord } from '../../lib/db';
import { useShambaStore } from '../../lib/store';
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
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  // Bumped on every focus so sections replay their entrance.
  const [visit, setVisit] = useState(0);

  const load = useCallback(async () => {
    try {
      setIssues(await getTodayIssues());
    } catch {}
    setUpdatedAt(new Date());
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [storeIssues, load]);

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

        {empty ? (
          <Animated.View entering={enter(2)} style={styles.empty}>
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
              <Animated.View entering={enter(2)} layout={layoutTransition} style={styles.section}>
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

            <Animated.View entering={enter(3)} layout={layoutTransition} style={styles.section}>
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

  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 150 },
}));
