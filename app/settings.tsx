/**
 * Settings — your community (nearest region from the hub's /heatmap, or the
 * demo villages), the demo farm switch, and field blocks.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from '../components/glass/PressableScale';
import { Close, Globe, Leaf, Locate } from '../components/glass/Icons';
import { DISEASE_COLOR, DISEASE_LABEL, HeatmapRegion } from '../components/map/MapParts';
import { COMMUNITY_RADIUS_KM, distanceKm, fetchRegions, nearestCommunity } from '../lib/community';
import { DEMO_CENTER, DEMO_PLACE } from '../lib/demoScenario';
import { getQuickLocation } from '../lib/location';
import { FIELD_BLOCKS, useShambaStore } from '../lib/store';
import { colors, makeStyles, useTheme } from '../lib/theme';

type Point = { lat: number; lng: number };

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const styles = useStyles();
  const demo = useShambaStore((s) => s.demoMode);
  const setDemo = useShambaStore((s) => s.setDemoMode);
  const lastKnown = useShambaStore((s) => s.lastKnownLocation);
  const activeBlock = useShambaStore((s) => s.activeBlock);

  const [gps, setGps] = useState<Point | null>(lastKnown);
  const [regions, setRegions] = useState<HeatmapRegion[] | null>(null); // null = loading
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (demo || gps) return;
    getQuickLocation()
      .then((loc) => loc && setGps({ lat: loc.coords.latitude, lng: loc.coords.longitude }))
      .catch(() => {});
  }, [demo]);

  useEffect(() => {
    const controller = new AbortController();
    setRegions(null);
    fetchRegions(demo, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setOffline(!data);
      setRegions(data?.regions ?? []);
    });
    return () => controller.abort();
  }, [demo]);

  const me = demo ? DEMO_CENTER : gps;
  const match = me && regions ? nearestCommunity(me, regions) : null;
  const others =
    me && regions && match
      ? regions
          .filter((r) => r !== match.region)
          .map((r) => ({ r, d: distanceKm(me, r) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
      : [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Settings</Text>
        <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close settings">
          <View style={styles.close}>
            <Close size={18} color={c.label} />
          </View>
        </PressableScale>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {/* ── Community ─────────────────────────────────────────────── */}
        <Text style={styles.section}>Your community</Text>
        <View style={styles.card}>
          {regions === null ? (
            <View style={styles.centerRow}>
              <ActivityIndicator color={c.label} />
              <Text style={styles.muted}>Finding nearby farmers…</Text>
            </View>
          ) : !me ? (
            <Text style={styles.muted}>Turn on location to find your community.</Text>
          ) : !match ? (
            <Text style={styles.muted}>
              {offline
                ? 'Community data comes from the co-op hub. Connect to the hub’s Wi-Fi to see it.'
                : 'No community data yet. It appears once farmers near you start scanning.'}
            </Text>
          ) : (
            <CommunityCard region={match.region} distance={match.distanceKm} member={match.member} />
          )}
        </View>

        {others.length > 0 && (
          <>
            <Text style={styles.section}>Nearby communities</Text>
            <View style={styles.card}>
              {others.map(({ r, d }, i) => (
                <View key={`${r.lat},${r.lng}`} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <View style={[styles.dot, { backgroundColor: DISEASE_COLOR[r.dominant] ?? DISEASE_COLOR.unknown }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{r.name ?? 'Unnamed area'}</Text>
                    <Text style={styles.rowSub}>
                      {DISEASE_LABEL[r.dominant] ?? 'Unknown'} · {r.total} scans
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>{formatKm(d)}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        <Text style={styles.footnote}>
          Only anonymous scan results are shared, with your location rounded to about 10 km. Photos never leave your phone.
        </Text>

        {/* ── Location ──────────────────────────────────────────────── */}
        <Text style={styles.section}>Location</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={[styles.iconTile, { backgroundColor: demo ? colors.primary : c.fill }]}>
              {demo ? <Leaf size={20} color="#FFFFFF" /> : <Locate size={18} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Demo farm</Text>
              <Text style={styles.rowSub}>{demo ? DEMO_PLACE.replace('Demo farm · ', '') : gps ? 'Using your GPS' : 'GPS not available'}</Text>
            </View>
            <Switch
              value={demo}
              onValueChange={setDemo}
              trackColor={{ true: colors.primary, false: c.fill }}
              accessibilityLabel="Demo farm"
            />
          </View>
        </View>
        <Text style={styles.footnote}>Demo data is for showing the app. It is never saved to your scan history.</Text>

        {/* ── Field blocks ──────────────────────────────────────────── */}
        <Text style={styles.section}>Field blocks</Text>
        <View style={styles.card}>
          <View style={styles.blocks}>
            {FIELD_BLOCKS.map((b) => (
              <View key={b} style={[styles.block, b === activeBlock && styles.blockOn]}>
                <Text style={[styles.blockText, b === activeBlock && styles.blockTextOn]}>{b}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.muted}>Choose the block at the top of the Scan screen. Every issue you log is saved with it.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function CommunityCard({ region, distance, member }: { region: HeatmapRegion; distance: number; member: boolean }) {
  const styles = useStyles();
  const color = DISEASE_COLOR[region.dominant] ?? DISEASE_COLOR.unknown;
  const healthy = region.counts.healthy ?? 0;
  const healthyPct = region.total ? Math.round((healthy / region.total) * 100) : 0;
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.row}>
        <View style={[styles.iconTile, { backgroundColor: color }]}>
          <Globe size={20} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.communityName}>{region.name ?? 'Your area'}</Text>
          <Text style={styles.rowSub}>
            {member ? `You're part of this community · ${formatKm(distance)}` : `Closest community · ${formatKm(distance)} away`}
          </Text>
        </View>
      </View>
      <View style={styles.stats}>
        <Stat value={String(region.total)} label="scans" />
        <Stat value={`${healthyPct}%`} label="healthy" />
        <Stat value={DISEASE_LABEL[region.dominant] ?? 'Unknown'} label="most common" color={color} />
      </View>
      {!member && (
        <Text style={styles.muted}>
          No community within {COMMUNITY_RADIUS_KM} km yet. Your scans will start one when you're near the hub.
        </Text>
      )}
    </View>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatKm(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.groundGrouped },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.7, color: c.label },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill },
  content: { paddingHorizontal: 16, gap: 8 },
  section: { fontSize: 20, fontWeight: '700', color: c.label, marginTop: 16, marginBottom: 2, paddingHorizontal: 4 },
  card: { padding: 16, borderRadius: 26, backgroundColor: c.card, gap: 12 },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  rowDivider: { borderTopWidth: 1, borderTopColor: c.separator, paddingTop: 12 },
  rowTitle: { fontSize: 17, fontWeight: '600', color: c.label },
  rowSub: { fontSize: 15, color: c.labelSecondary, marginTop: 2 },
  rowValue: { fontSize: 16, fontWeight: '600', color: c.labelSecondary },
  dot: { width: 14, height: 14, borderRadius: 7 },
  iconTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  communityName: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3, color: c.label },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 16, backgroundColor: c.fill, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: c.label },
  statLabel: { fontSize: 13, color: c.labelSecondary, marginTop: 2 },
  muted: { fontSize: 15, lineHeight: 21, color: c.labelSecondary },
  footnote: { fontSize: 13, lineHeight: 18, color: c.labelSecondary, paddingHorizontal: 8 },
  blocks: { flexDirection: 'row', gap: 8 },
  block: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill },
  blockOn: { backgroundColor: colors.primary },
  blockText: { fontSize: 18, fontWeight: '700', color: c.label },
  blockTextOn: { color: '#FFFFFF' },
}));
