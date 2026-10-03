import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTodayIssues, IssueRecord } from '../../lib/db';
import { useShambaStore } from '../../lib/store';

const SEVERITY_COLOR: Record<string, string> = {
  high: '#E53E3E',
  medium: '#DD6B20',
  low: '#D69E2E',
  none: '#38A169',
  unknown: '#718096',
};

export default function ReportScreen() {
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const storeIssues = useShambaStore(s => s.issues);

  const load = useCallback(async () => {
    const dbIssues = await getTodayIssues();
    setIssues(dbIssues);
  }, []);

  useEffect(() => { load(); }, [storeIssues, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Count by disease
  const counts = issues.reduce<Record<string, { count: number; name: string; severity: string }>>((acc, issue) => {
    if (!acc[issue.diseaseId]) {
      acc[issue.diseaseId] = { count: 0, name: issue.diseaseName, severity: issue.severity };
    }
    acc[issue.diseaseId].count++;
    return acc;
  }, {});

  const topIssues = Object.entries(counts).sort((a, b) => b[1].count - a[1].count);
  const urgentCount = issues.filter(i => i.severity === 'high').length;
  const healthyCount = issues.filter(i => i.severity === 'none').length;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2D6A4F" />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Today's Report</Text>
        <Text style={styles.date}>{today}</Text>
      </View>

      {/* Summary cards */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { borderLeftColor: '#2D6A4F' }]}>
          <Text style={styles.summaryNumber}>{issues.length}</Text>
          <Text style={styles.summaryLabel}>Total scans{'\n'}logged</Text>
        </View>
        <View style={[styles.summaryCard, { borderLeftColor: '#E53E3E' }]}>
          <Text style={[styles.summaryNumber, { color: '#E53E3E' }]}>{urgentCount}</Text>
          <Text style={styles.summaryLabel}>Urgent{'\n'}issues</Text>
        </View>
        <View style={[styles.summaryCard, { borderLeftColor: '#38A169' }]}>
          <Text style={[styles.summaryNumber, { color: '#38A169' }]}>{healthyCount}</Text>
          <Text style={styles.summaryLabel}>Healthy{'\n'}scans</Text>
        </View>
      </View>

      {/* Issues by type */}
      {topIssues.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Issues found today</Text>
          {topIssues.map(([id, data]) => (
            <View key={id} style={styles.issueRow}>
              <View style={[styles.issueDot, { backgroundColor: SEVERITY_COLOR[data.severity] }]} />
              <Text style={styles.issueName}>{data.name}</Text>
              <View style={[styles.issueCount, { backgroundColor: SEVERITY_COLOR[data.severity] + '20' }]}>
                <Text style={[styles.issueCountText, { color: SEVERITY_COLOR[data.severity] }]}>
                  ×{data.count}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Timeline */}
      {issues.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          {issues.slice(0, 20).map((issue) => (
            <View key={issue.id} style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: SEVERITY_COLOR[issue.severity] }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineName}>{issue.diseaseName}</Text>
                <Text style={styles.timelineTime}>
                  {new Date(issue.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {issue.lat !== 0 ? ' · GPS logged' : ''}
                </Text>
              </View>
              <Text style={styles.timelineConf}>{Math.round(issue.confidence * 100)}%</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="leaf-outline" size={64} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No scans today</Text>
          <Text style={styles.emptyBody}>Head out to the field and scan your crops. Issues you log will appear here.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },
  content: { paddingBottom: 40 },
  header: { paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  date: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  summaryRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  summaryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderLeftWidth: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  summaryNumber: { fontSize: 28, fontWeight: '700', color: '#111827' },
  summaryLabel: { fontSize: 12, color: '#6B7280', marginTop: 4, lineHeight: 16 },
  section: { marginTop: 20, paddingHorizontal: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  issueRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, gap: 12 },
  issueDot: { width: 10, height: 10, borderRadius: 5 },
  issueName: { flex: 1, fontSize: 15, color: '#111827', fontWeight: '500' },
  issueCount: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  issueCountText: { fontSize: 13, fontWeight: '700' },
  timelineItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 12 },
  timelineDot: { width: 8, height: 8, borderRadius: 4 },
  timelineContent: { flex: 1 },
  timelineName: { fontSize: 14, color: '#374151', fontWeight: '500' },
  timelineTime: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  timelineConf: { fontSize: 12, color: '#9CA3AF' },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: '#374151' },
  emptyBody: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22 },
});
