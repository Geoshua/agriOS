import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, ActivityIndicator } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { getAllIssues, IssueRecord } from '../../lib/db';
import { useShambaStore } from '../../lib/store';
import { fetchSoilData, getSoilAdvisory, SoilProfile } from '../../lib/soil';
import { LOCAL_SERVER_URL } from '../../lib/config';

// ── My-field view constants ────────────────────────────────────────────────────
const SEVERITY_RADIUS: Record<string, number> = {
  high: 30, medium: 20, low: 12, none: 8, unknown: 15,
};

const SEVERITY_COLOR: Record<string, string> = {
  high: '#E53E3E', medium: '#DD6B20', low: '#D69E2E', none: '#38A169', unknown: '#718096',
};

const PH_STATUS_COLOR: Record<string, string> = {
  low: '#DD6B20', optimal: '#38A169', high: '#3B82F6',
};

// ── Community view constants ───────────────────────────────────────────────────
const DISEASE_COLOR: Record<string, string> = {
  coffee_leaf_rust: '#DD6B20',
  coffee_leaf_miner: '#D69E2E',
  coffee_phoma: '#E53E3E',
  coffee_brown_eye: '#9B2C2C',
  healthy: '#38A169',
  unknown: '#718096',
};

const DISEASE_LABEL: Record<string, string> = {
  coffee_leaf_rust: 'Rust',
  coffee_leaf_miner: 'Leaf Miner',
  coffee_phoma: 'Phoma',
  coffee_brown_eye: 'Brown Eye',
  healthy: 'Healthy',
  unknown: 'Unknown',
};

interface HeatmapRegion {
  lat: number;
  lng: number;
  dominant: string;
  total: number;
  counts: Record<string, number>;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MapScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selected, setSelected] = useState<IssueRecord | null>(null);
  const [soilProfile, setSoilProfile] = useState<SoilProfile | null>(null);
  const [soilExpanded, setSoilExpanded] = useState(true);
  const storeIssues = useShambaStore(s => s.issues);

  // Community view
  const [mapView, setMapView] = useState<'mine' | 'community'>('mine');
  const [heatmapRegions, setHeatmapRegions] = useState<HeatmapRegion[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapMeta, setHeatmapMeta] = useState<{ total: number; villages: number } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<HeatmapRegion | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation(loc);
        fetchSoilData(loc.coords.latitude, loc.coords.longitude).then(profile => {
          if (profile) setSoilProfile(profile);
        });
      }
      const dbIssues = await getAllIssues();
      setIssues(dbIssues);
    })();
  }, []);

  // Fetch heatmap whenever the user switches to the community view
  useEffect(() => {
    if (mapView !== 'community') return;
    setHeatmapLoading(true);
    setHeatmapRegions([]);
    setHeatmapMeta(null);
    const base = LOCAL_SERVER_URL || 'http://localhost:7384';
    const controller = new AbortController();
    fetch(`${base}/heatmap`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        setHeatmapRegions(data.regions ?? []);
        setHeatmapMeta({ total: data.total ?? 0, villages: data.villages ?? 0 });
      })
      .catch(() => {})
      .finally(() => setHeatmapLoading(false));
    return () => controller.abort();
  }, [mapView]);

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
        latitudeDelta: mapView === 'community' ? 0.5 : 0.003,
        longitudeDelta: mapView === 'community' ? 0.5 : 0.003,
      }
    : undefined;

  const soilAdvisory = soilProfile ? getSoilAdvisory(soilProfile) : null;

  function switchView(view: 'mine' | 'community') {
    setMapView(view);
    setSelected(null);
    setSelectedRegion(null);
  }

  return (
    <View style={styles.container}>
      {/* Header with segmented view toggle */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Field Map</Text>
          <Text style={styles.subtitle}>{validIssues.length} issue{validIssues.length !== 1 ? 's' : ''} logged</Text>
        </View>
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.toggleBtn, mapView === 'mine' && styles.toggleBtnActive]}
            onPress={() => switchView('mine')}
            accessibilityRole="button"
            accessibilityLabel="My field view"
          >
            <Text style={[styles.toggleText, mapView === 'mine' && styles.toggleTextActive]}>My Field</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mapView === 'community' && styles.toggleBtnActive]}
            onPress={() => switchView('community')}
            accessibilityRole="button"
            accessibilityLabel="Community disease map"
          >
            <Text style={[styles.toggleText, mapView === 'community' && styles.toggleTextActive]}>Community</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Soil card — only in my-field view */}
      {mapView === 'mine' && soilProfile && soilAdvisory && (
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

      {/* Community stats banner */}
      {mapView === 'community' && (
        <View style={styles.communityBanner}>
          {heatmapLoading ? (
            <ActivityIndicator size="small" color="#2D6A4F" />
          ) : heatmapMeta ? (
            <Text style={styles.communityBannerText}>
              {heatmapMeta.total} scan{heatmapMeta.total !== 1 ? 's' : ''} from {heatmapMeta.villages} village{heatmapMeta.villages !== 1 ? 's' : ''} · GPS anonymised to ~10km
            </Text>
          ) : (
            <Text style={styles.communityBannerText}>No regional data yet — scans will appear here once shared</Text>
          )}
        </View>
      )}

      {region ? (
        <MapView
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton
        >
          {/* My-field markers */}
          {mapView === 'mine' && validIssues.map((issue) => (
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

          {/* Community heatmap regions */}
          {mapView === 'community' && heatmapRegions.map((r, i) => {
            const color = DISEASE_COLOR[r.dominant] ?? '#718096';
            return (
              <React.Fragment key={`region-${i}`}>
                <Circle
                  center={{ latitude: r.lat, longitude: r.lng }}
                  radius={6000}
                  fillColor={color + '28'}
                  strokeColor={color + '80'}
                  strokeWidth={1.5}
                />
                <Marker
                  coordinate={{ latitude: r.lat, longitude: r.lng }}
                  onPress={() => setSelectedRegion(r)}
                  pinColor={color}
                />
              </React.Fragment>
            );
          })}
        </MapView>
      ) : (
        <View style={styles.noLocation}>
          <Ionicons name="location-outline" size={48} color="#D1D5DB" />
          <Text style={styles.noLocationText}>Waiting for location…</Text>
        </View>
      )}

      {/* Legend */}
      {mapView === 'mine' ? (
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
      ) : (
        <View style={styles.legend}>
          {Object.entries(DISEASE_LABEL).map(([id, label]) => (
            <View key={id} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: DISEASE_COLOR[id] }]} />
              <Text style={styles.legendLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* My-field issue popup */}
      {selected && mapView === 'mine' && (
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

      {/* Community region popup */}
      {selectedRegion && mapView === 'community' && (
        <View style={styles.popup}>
          <TouchableOpacity onPress={() => setSelectedRegion(null)} style={styles.popupClose}>
            <Ionicons name="close" size={18} color="#6B7280" />
          </TouchableOpacity>
          <Text style={styles.popupName}>{DISEASE_LABEL[selectedRegion.dominant] ?? 'Unknown'}</Text>
          <Text style={styles.popupDate}>
            {selectedRegion.total} scan{selectedRegion.total !== 1 ? 's' : ''} · Regional data (anonymised)
          </Text>
          {Object.entries(selectedRegion.counts).length > 1 && (
            <Text style={styles.popupSub}>
              {Object.entries(selectedRegion.counts)
                .sort((a, b) => b[1] - a[1])
                .map(([id, n]) => `${DISEASE_LABEL[id] ?? id} ×${n}`)
                .join('  ·  ')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },

  // Header
  header: {
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 12,
  },
  headerTop: { gap: 2 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6B7280' },

  // Segmented toggle
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 2,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  toggleText: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  toggleTextActive: { fontSize: 14, fontWeight: '600', color: '#111827' },

  // Soil card
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

  // Community banner
  communityBanner: {
    backgroundColor: '#F0FDF4',
    borderBottomWidth: 1,
    borderBottomColor: '#BBF7D0',
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
    minHeight: 36,
    justifyContent: 'center',
  },
  communityBannerText: { fontSize: 12, color: '#166534', textAlign: 'center' },

  // Map
  map: { flex: 1 },
  noLocation: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  noLocationText: { fontSize: 16, color: '#9CA3AF' },

  // Legend
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11, color: '#374151' },

  // Popups
  popup: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  popupClose: { position: 'absolute', top: 12, right: 12 },
  popupName: { fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 4, paddingRight: 24 },
  popupDate: { fontSize: 13, color: '#6B7280' },
  popupSub: { fontSize: 12, color: '#9CA3AF', marginTop: 6, lineHeight: 18 },
});
