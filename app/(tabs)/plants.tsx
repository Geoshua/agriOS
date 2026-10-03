import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAllPlants, getIssuesByPlant, renamePatient, PlantRecord, IssueRecord } from '../../lib/db';
import { useShambaStore } from '../../lib/store';

const SEVERITY_COLOR: Record<string, string> = {
  high: '#E53E3E',
  medium: '#DD6B20',
  low: '#D69E2E',
  none: '#38A169',
  unknown: '#718096',
};

type Trend = 'improving' | 'worsening' | 'stable' | 'new';

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0, unknown: -1 };

function getTrend(scans: IssueRecord[]): Trend {
  if (scans.length < 2) return 'new';
  const latest = SEVERITY_RANK[scans[scans.length - 1].severity] ?? -1;
  const prev = SEVERITY_RANK[scans[scans.length - 2].severity] ?? -1;
  if (latest < prev) return 'improving';
  if (latest > prev) return 'worsening';
  return 'stable';
}

const TREND_ICON: Record<Trend, { name: string; color: string; label: string }> = {
  improving:  { name: 'trending-up',   color: '#38A169', label: 'Improving' },
  worsening:  { name: 'trending-down', color: '#E53E3E', label: 'Worsening' },
  stable:     { name: 'remove',        color: '#D69E2E', label: 'Stable' },
  new:        { name: 'leaf',          color: '#2D6A4F', label: 'New plant' },
};

interface PlantWithScans {
  plant: PlantRecord;
  scans: IssueRecord[];
  trend: Trend;
}

export default function PlantsScreen() {
  const [data, setData] = useState<PlantWithScans[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const storePlants = useShambaStore(s => s.plants);
  const setStorePlants = useShambaStore(s => s.setPlants);

  const load = useCallback(async () => {
    const plants = await getAllPlants();
    setStorePlants(plants);
    const loaded: PlantWithScans[] = await Promise.all(
      plants.map(async plant => {
        const scans = await getIssuesByPlant(plant.id);
        return { plant, scans, trend: getTrend(scans) };
      })
    );
    setData(loaded);
  }, []);

  useEffect(() => { load(); }, [load, storePlants.length]);

  async function handleRename(plantId: number) {
    const trimmed = renameText.trim();
    if (!trimmed) return;
    await renamePatient(plantId, trimmed);
    setRenamingId(null);
    setRenameText('');
    load();
  }

  function renderScan(scan: IssueRecord, idx: number, total: number) {
    const isLast = idx === total - 1;
    const date = new Date(scan.timestamp);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const color = SEVERITY_COLOR[scan.severity] ?? '#718096';

    return (
      <View key={scan.id} style={styles.timelineRow}>
        <View style={styles.timelineLeft}>
          <View style={[styles.timelineDot, { backgroundColor: color }]} />
          {!isLast && <View style={styles.timelineLine} />}
        </View>
        <View style={styles.timelineContent}>
          <View style={styles.timelineHeader}>
            <Text style={styles.timelineDisease}>{scan.diseaseName}</Text>
            <Text style={styles.timelineConf}>{Math.round(scan.confidence * 100)}%</Text>
          </View>
          <Text style={styles.timelineDate}>{dateStr} · {timeStr}</Text>
          {scan.notes ? (
            <Text style={styles.timelineNote} numberOfLines={2}>{scan.notes}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  function renderPlant({ item }: { item: PlantWithScans }) {
    const { plant, scans, trend } = item;
    const isExpanded = expandedId === plant.id;
    const isRenaming = renamingId === plant.id;
    const lastScan = scans[scans.length - 1];
    const trendInfo = TREND_ICON[trend];

    return (
      <View style={styles.card}>
        {/* Plant header */}
        <Pressable style={styles.cardHeader} onPress={() => setExpandedId(isExpanded ? null : plant.id)}>
          <View style={styles.cardLeft}>
            <View style={styles.plantIconWrap}>
              <Ionicons name="leaf" size={20} color="#2D6A4F" />
            </View>
            <View style={styles.plantMeta}>
              {isRenaming ? (
                <View style={styles.renameRow}>
                  <TextInput
                    style={styles.renameInput}
                    value={renameText}
                    onChangeText={setRenameText}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => handleRename(plant.id)}
                  />
                  <Pressable onPress={() => handleRename(plant.id)} style={styles.renameConfirm}>
                    <Ionicons name="checkmark" size={18} color="#2D6A4F" />
                  </Pressable>
                  <Pressable onPress={() => setRenamingId(null)} style={styles.renameConfirm}>
                    <Ionicons name="close" size={18} color="#9CA3AF" />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onLongPress={() => { setRenamingId(plant.id); setRenameText(plant.name); }}
                  delayLongPress={600}
                >
                  <Text style={styles.plantName}>{plant.name}</Text>
                </Pressable>
              )}
              <Text style={styles.plantScanCount}>
                {scans.length} scan{scans.length !== 1 ? 's' : ''}
                {lastScan ? ` · last ${new Date(lastScan.timestamp).toLocaleDateString()}` : ''}
              </Text>
            </View>
          </View>

          <View style={styles.cardRight}>
            {/* Trend indicator */}
            <View style={styles.trendBadge}>
              <Ionicons name={trendInfo.name as any} size={14} color={trendInfo.color} />
              <Text style={[styles.trendLabel, { color: trendInfo.color }]}>{trendInfo.label}</Text>
            </View>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color="#9CA3AF"
            />
          </View>
        </Pressable>

        {/* Last disease pill */}
        {lastScan && !isExpanded && (
          <View style={styles.lastDiseasePill}>
            <View style={[styles.diseaseDot, { backgroundColor: SEVERITY_COLOR[lastScan.severity] }]} />
            <Text style={styles.lastDiseaseText}>{lastScan.diseaseName}</Text>
          </View>
        )}

        {/* Expanded scan history timeline */}
        {isExpanded && (
          <View style={styles.timeline}>
            {scans.length === 0 ? (
              <Text style={styles.noScans}>No scans yet</Text>
            ) : (
              scans.map((s, i) => renderScan(s, i, scans.length))
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Plants</Text>
        <Text style={styles.subtitle}>
          {data.length} tracked · Long-press a name to rename
        </Text>
      </View>

      {data.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="leaf-outline" size={56} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No plants tracked yet</Text>
          <Text style={styles.emptyBody}>
            Scan a leaf and tap "Log this issue to map" — agriOS will automatically group scans from the same plant together.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => String(item.plant.id)}
          renderItem={renderPlant}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },
  header: { paddingTop: 60, paddingBottom: 12, paddingHorizontal: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E7EB' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  plantIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0FDF4', justifyContent: 'center', alignItems: 'center' },
  plantMeta: { flex: 1 },
  plantName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  plantScanCount: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trendLabel: { fontSize: 12, fontWeight: '600' },
  lastDiseasePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  diseaseDot: { width: 8, height: 8, borderRadius: 4 },
  lastDiseaseText: { fontSize: 13, color: '#374151' },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  renameInput: { flex: 1, borderBottomWidth: 1, borderColor: '#2D6A4F', fontSize: 16, color: '#111827', paddingVertical: 2 },
  renameConfirm: { padding: 4 },
  timeline: { paddingHorizontal: 14, paddingBottom: 14 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineLeft: { alignItems: 'center', width: 16 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  timelineLine: { flex: 1, width: 2, backgroundColor: '#E5E7EB', marginVertical: 4 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timelineDisease: { fontSize: 14, fontWeight: '600', color: '#111827' },
  timelineConf: { fontSize: 12, color: '#9CA3AF' },
  timelineDate: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  timelineNote: { fontSize: 13, color: '#6B7280', marginTop: 4, fontStyle: 'italic' },
  noScans: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', paddingVertical: 12 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', textAlign: 'center' },
  emptyBody: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 22 },
});
