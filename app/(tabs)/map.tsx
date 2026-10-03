import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { getAllIssues, IssueRecord } from '../../lib/db';
import { useShambaStore } from '../../lib/store';
import { fetchSoilData, getSoilAdvisory, SoilProfile } from '../../lib/soil';

const SEVERITY_RADIUS: Record<string, number> = {
  high: 30,
  medium: 20,
  low: 12,
  none: 8,
  unknown: 15,
};

const SEVERITY_COLOR: Record<string, string> = {
  high: '#E53E3E',
  medium: '#DD6B20',
  low: '#D69E2E',
  none: '#38A169',
  unknown: '#718096',
};

const PH_STATUS_COLOR: Record<string, string> = {
  low: '#DD6B20',
  optimal: '#38A169',
  high: '#3B82F6',
};

export default function MapScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selected, setSelected] = useState<IssueRecord | null>(null);
  const [soilProfile, setSoilProfile] = useState<SoilProfile | null>(null);
  const [soilExpanded, setSoilExpanded] = useState(true);
  const storeIssues = useShambaStore(s => s.issues);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation(loc);
        // Fetch soil data in background once we have coordinates
        fetchSoilData(loc.coords.latitude, loc.coords.longitude).then(profile => {
          if (profile) setSoilProfile(profile);
        });
      }
      const dbIssues = await getAllIssues();
      setIssues(dbIssues);
    })();
  }, []);

  // Merge store issues (logged this session) with db issues
  const allIssues = React.useMemo(() => {
    const dbIds = new Set(issues.map(i => i.id));
    const sessionNew = storeIssues.filter(i => i.id > 0 && !dbIds.has(i.id));
    return [...sessionNew, ...issues];
  }, [issues, storeIssues]);

  const validIssues = allIssues.filter(i => i.lat !== 0 && i.lng !== 0);

  const region = location
    ? {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.003,
        longitudeDelta: 0.003,
      }
    : undefined;

  const soilAdvisory = soilProfile ? getSoilAdvisory(soilProfile) : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Field Map</Text>
        <Text style={styles.subtitle}>{validIssues.length} issue{validIssues.length !== 1 ? 's' : ''} logged</Text>
      </View>

      {/* Soil conditions card */}
      {soilProfile && soilAdvisory && (
        <Pressable style={styles.soilCard} onPress={() => setSoilExpanded(e => !e)}>
          <View style={styles.soilCardHeader}>
            <View style={styles.soilTitleRow}>
              <Ionicons name="layers-outline" size={15} color="#2D6A4F" />
              <Text style={styles.soilTitle}>Field Soil Conditions</Text>
              <View style={[styles.phBadge, { backgroundColor: PH_STATUS_COLOR[soilAdvisory.phStatus] + '20' }]}>
                <Text style={[styles.phBadgeText, { color: PH_STATUS_COLOR[soilAdvisory.phStatus] }]}>
                  pH {soilProfile.ph.toFixed(1)}
                </Text>
              </View>
            </View>
            <Ionicons name={soilExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#9CA3AF" />
          </View>
          {soilExpanded && (
            <View style={styles.soilBody}>
              <Text style={styles.soilAdvice}>{soilAdvisory.phAdvice}</Text>
              {soilAdvisory.phStatus !== 'optimal' && (
                <Text style={styles.soilAdviceSub}>{soilAdvisory.generalAdvice}</Text>
              )}
              <Text style={styles.soilSource}>Source: SoilGrids (ISRIC) · 0–5 cm depth</Text>
            </View>
          )}
        </Pressable>
      )}

      {region ? (
        <MapView
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton
        >
          {validIssues.map((issue) => (
            <React.Fragment key={issue.id}>
              <Circle
                center={{ latitude: issue.lat, longitude: issue.lng }}
                radius={SEVERITY_RADIUS[issue.severity] ?? 15}
                fillColor={SEVERITY_COLOR[issue.severity] + '30'}
                strokeColor={SEVERITY_COLOR[issue.severity] + '80'}
                strokeWidth={1}
              />
              <Marker
                coordinate={{ latitude: issue.lat, longitude: issue.lng }}
                onPress={() => setSelected(issue)}
                pinColor={SEVERITY_COLOR[issue.severity]}
              />
            </React.Fragment>
          ))}
        </MapView>
      ) : (
        <View style={styles.noLocation}>
          <Ionicons name="location-outline" size={48} color="#D1D5DB" />
          <Text style={styles.noLocationText}>Waiting for location…</Text>
        </View>
      )}

      {/* Legend */}
      <View style={styles.legend}>
        {[
          { label: 'Urgent', color: '#E53E3E' },
          { label: 'Watch', color: '#DD6B20' },
          { label: 'Monitor', color: '#D69E2E' },
          { label: 'Healthy', color: '#38A169' },
        ].map(({ label, color }) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Selected issue popup */}
      {selected && (
        <View style={styles.popup}>
          <TouchableOpacity onPress={() => setSelected(null)} style={styles.popupClose}>
            <Ionicons name="close" size={18} color="#6B7280" />
          </TouchableOpacity>
          <Text style={styles.popupName}>{selected.diseaseName}</Text>
          <Text style={styles.popupDate}>
            {new Date(selected.timestamp).toLocaleDateString()} · {Math.round(selected.confidence * 100)}% confidence
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },
  header: { paddingTop: 60, paddingBottom: 12, paddingHorizontal: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  soilCard: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  soilCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  soilTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  soilTitle: { fontSize: 13, fontWeight: '600', color: '#374151' },
  phBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  phBadgeText: { fontSize: 12, fontWeight: '700' },
  soilBody: { marginTop: 8, gap: 4 },
  soilAdvice: { fontSize: 13, color: '#374151', lineHeight: 18 },
  soilAdviceSub: { fontSize: 12, color: '#6B7280', lineHeight: 18 },
  soilSource: { fontSize: 10, color: '#9CA3AF', marginTop: 4 },
  map: { flex: 1 },
  noLocation: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  noLocationText: { fontSize: 16, color: '#9CA3AF' },
  legend: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 12, color: '#374151' },
  popup: { position: 'absolute', bottom: 80, left: 20, right: 20, backgroundColor: '#fff', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, elevation: 6 },
  popupClose: { position: 'absolute', top: 12, right: 12 },
  popupName: { fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 4, paddingRight: 24 },
  popupDate: { fontSize: 13, color: '#6B7280' },
});
