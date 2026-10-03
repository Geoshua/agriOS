import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, Region, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { getAllIssues, IssueRecord } from '../../lib/db';
import { fetchSoilData, getSoilAdvisory, SoilProfile } from '../../lib/soil';
import { useShambaStore } from '../../lib/store';
import { colors, heat, makeStyles, severityPin, spring, useTheme } from '../../lib/theme';
import { useTween, withAlpha } from '../../lib/useTween';
import { SIDE, useChromeInsets } from '../../lib/layout';
import ScreenTransition from '../../components/glass/ScreenTransition';
import Glass from '../../components/glass/Glass';
import GlassSegmented from '../../components/glass/GlassSegmented';
import PressableScale from '../../components/glass/PressableScale';
import { Heat, Locate, MapPin } from '../../components/glass/Icons';
import { BlockLabel, HealthLegend, PinsLegend, Pin, Popover, POPOVER_WIDTH, SoilCard } from '../../components/map/MapParts';

type Layer = 'pins' | 'health';

const ZONE_RADIUS: Record<string, number> = { high: 30, medium: 22, low: 16, none: 12, unknown: 16 };
const HEAT_RADIUS: Record<string, number> = { high: 48, medium: 40, low: 32, none: 42, unknown: 28 };
const SEVERITY_RANK: Record<string, number> = { high: 4, medium: 3, low: 2, unknown: 1, none: 0 };

// OpenStreetMap tiles replace the platform base map. Google's tiles need an
// authorised API key, which Expo Go doesn't provide for this app (the map
// showed the Google logo but no tiles). OSM has no dark style, so tiles stay
// light in dark mode. Usage policy: https://operations.osmfoundation.org/policies/tiles/
const OPEN_TILES = true;
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Muted Google styles, used if OPEN_TILES is turned off (e.g. with a real Maps key).
const MUTED_STYLE = [
  { elementType: 'geometry', stylers: [{ saturation: -60 }, { lightness: 15 }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2420' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8f9a92' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#141a16' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3530' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1a22' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#1f2a22' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

export default function MapScreen() {
  const { width, height } = useWindowDimensions();
  const { top, accessoryBottom } = useChromeInsets();
  const mapRef = useRef<MapView>(null);
  const { c, scheme } = useTheme();
  const styles = useStyles();
  const storeIssues = useShambaStore((s) => s.issues);

  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locating, setLocating] = useState(true);
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [layer, setLayer] = useState<Layer>('pins');
  const [selected, setSelected] = useState<{ issue: IssueRecord; x: number; y: number } | null>(null);
  const [tracking, setTracking] = useState(true);
  const [soil, setSoil] = useState<SoilProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        // Last known position is instant; a fresh fix can take a long time indoors.
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (last && !cancelled) setLocation(last);
        const fresh = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
        ]);
        if (fresh && !cancelled) setLocation(fresh);
      }
      if (!cancelled) setLocating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Soil conditions for the field, fetched once we know where we are.
  const hasLocation = !!location;
  useEffect(() => {
    if (!location || soil) return;
    fetchSoilData(location.coords.latitude, location.coords.longitude)
      .then((profile) => profile && setSoil(profile))
      .catch(() => {});
  }, [hasLocation]);
  const soilAdvisory = soil ? getSoilAdvisory(soil) : null;

  useFocusEffect(
    useCallback(() => {
      getAllIssues().then(setIssues).catch(() => {});
    }, []),
  );
  useEffect(() => {
    getAllIssues().then(setIssues).catch(() => {});
  }, [storeIssues]);

  // Let custom marker views animate in, then stop re-snapshotting them (Android perf).
  useEffect(() => {
    setTracking(true);
    const t = setTimeout(() => setTracking(false), 900);
    return () => clearTimeout(t);
  }, [issues.length, layer, selected?.issue.id]);

  const mapped = useMemo(() => issues.filter((i) => i.lat !== 0 && i.lng !== 0), [issues]);
  const urgent = mapped.filter((i) => i.severity === 'high').length;

  const blocks = useMemo(() => {
    const groups: Record<string, IssueRecord[]> = {};
    mapped.forEach((i) => i.block && (groups[i.block] ??= []).push(i));
    return Object.entries(groups).map(([block, list]) => ({
      block,
      lat: list.reduce((s, i) => s + i.lat, 0) / list.length,
      lng: list.reduce((s, i) => s + i.lng, 0) / list.length,
      worst: list.reduce((w, i) => ((SEVERITY_RANK[i.severity] ?? 0) > (SEVERITY_RANK[w] ?? 0) ? i.severity : w), 'none'),
    }));
  }, [mapped]);

  const region: Region | null = location
    ? { latitude: location.coords.latitude, longitude: location.coords.longitude, latitudeDelta: 0.003, longitudeDelta: 0.003 }
    : mapped.length
      ? { latitude: mapped[0].lat, longitude: mapped[0].lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }
      : null;

  // Overlays can't be animated natively, so their opacity is tweened through props.
  const pinsAlpha = useTween(layer === 'pins' ? 1 : 0, 260);
  const heatAlpha = useTween(layer === 'health' ? 1 : 0, 320);

  // Legend height follows the active layer.
  const legendH = useSharedValue(54);
  useEffect(() => {
    legendH.value = withSpring(layer === 'pins' ? 54 : 62, spring.snappy);
  }, [layer]);
  const legendStyle = useAnimatedStyle(() => ({ height: legendH.value, borderRadius: legendH.value / 2 }));

  async function selectIssue(issue: IssueRecord) {
    const point = await mapRef.current?.pointForCoordinate({ latitude: issue.lat, longitude: issue.lng });
    if (point) setSelected({ issue, x: point.x, y: point.y });
  }

  function recenter() {
    if (!location) return;
    mapRef.current?.animateToRegion(
      { latitude: location.coords.latitude, longitude: location.coords.longitude, latitudeDelta: 0.003, longitudeDelta: 0.003 },
      450,
    );
  }

  const popLeft = selected ? Math.max(16, Math.min(width - POPOVER_WIDTH - 16, selected.x - POPOVER_WIDTH / 2)) : 0;
  const subtitle = mapped.length
    ? `${mapped.length} pin${mapped.length === 1 ? '' : 's'}${urgent ? ` · ${urgent} urgent` : ''}`
    : 'No issues logged yet';

  return (
    <ScreenTransition
      background={c.groundMap}
      // CONTENT LAYER: the map stays out of the animated layer (blank on Android otherwise).
      backdrop={region ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          customMapStyle={OPEN_TILES ? undefined : scheme === 'dark' ? DARK_STYLE : MUTED_STYLE}
          mapType={OPEN_TILES && Platform.OS === 'android' ? 'none' : Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
          userInterfaceStyle={scheme}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          onPanDrag={() => selected && setSelected(null)}
          onPress={() => setSelected(null)}
        >
          {OPEN_TILES && <UrlTile urlTemplate={OSM_TILE_URL} maximumZ={19} zIndex={-1} shouldReplaceMapContent />}

          {/* Health heat map: stacked soft discs approximate a gradient per scan. */}
          {heatAlpha > 0.01 &&
            mapped.map((issue) =>
              [1, 0.62, 0.3].map((k, ring) => (
                <Circle
                  key={`h${issue.id}-${ring}`}
                  center={{ latitude: issue.lat, longitude: issue.lng }}
                  radius={(HEAT_RADIUS[issue.severity] ?? 30) * k}
                  fillColor={withAlpha(heat[issue.severity] ?? heat.unknown, [0.16, 0.2, 0.26][ring] * heatAlpha)}
                  strokeWidth={0}
                />
              )),
            )}

          {/* Pin zones */}
          {pinsAlpha > 0.01 &&
            mapped.map((issue) => (
              <Circle
                key={`z${issue.id}`}
                center={{ latitude: issue.lat, longitude: issue.lng }}
                radius={ZONE_RADIUS[issue.severity] ?? 16}
                fillColor={withAlpha(severityPin[issue.severity] ?? severityPin.unknown, 0.14 * pinsAlpha)}
                strokeColor={withAlpha(severityPin[issue.severity] ?? severityPin.unknown, 0.5 * pinsAlpha)}
                strokeWidth={1.5}
              />
            ))}

          {mapped.map((issue, i) => (
            <Marker
              key={`p${issue.id}`}
              coordinate={{ latitude: issue.lat, longitude: issue.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={tracking}
              onPress={(e) => {
                e.stopPropagation();
                selectIssue(issue);
              }}
              accessibilityLabel={`${issue.diseaseName}, ${issue.severity}`}
            >
              <Pin severity={issue.severity} selected={selected?.issue.id === issue.id} index={i} />
            </Marker>
          ))}

          {layer === 'health' &&
            blocks.map((b) => (
              <Marker key={`b${b.block}`} coordinate={{ latitude: b.lat, longitude: b.lng }} anchor={{ x: 0.5, y: 1.6 }} tracksViewChanges={tracking}>
                <BlockLabel block={b.block} worst={b.worst} />
              </Marker>
            ))}
        </MapView>
      ) : (
        <View style={styles.waiting}>
          {locating ? <ActivityIndicator color={c.labelSecondary} /> : <MapPin size={40} color={c.checkBorder} hole={c.groundMap} />}
          <Text style={styles.waitingText}>{locating ? 'Finding your location…' : 'Turn on location to see your field'}</Text>
        </View>
      )}
    >

      {/* Top scroll-edge effect under the title */}
      <View style={[styles.topFade, { height: top + 150 }]} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="mapFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c.groundMap} stopOpacity={0.97} />
              <Stop offset="0.6" stopColor={c.groundMap} stopOpacity={0.88} />
              <Stop offset="1" stopColor={c.groundMap} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#mapFade)" />
        </Svg>
      </View>

      {/* CONTROL LAYER */}
      <View style={[styles.header, { top: top - 2 }]} pointerEvents="box-none">
        <View style={styles.titleRow} pointerEvents="box-none">
          <View>
            <Text style={styles.title} accessibilityRole="header">Field Map</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          <PressableScale onPress={recenter} disabled={!location} accessibilityRole="button" accessibilityLabel="Center on my location">
            <Glass radius={24} style={styles.locate}>
              <Locate />
            </Glass>
          </PressableScale>
        </View>

        <GlassSegmented
          items={[
            { key: 'pins', label: 'Pins', icon: (col) => <MapPin size={16} color={col} hole={c.card} /> },
            { key: 'health', label: 'Health', icon: (col) => <Heat color={col} /> },
          ]}
          selectedIndex={layer === 'pins' ? 0 : 1}
          onSelect={(i) => {
            setSelected(null);
            setLayer(i === 0 ? 'pins' : 'health');
          }}
          direction="row"
          layout="inline"
         
          palette={{
            active: c.label,
            idle: c.labelSecondary,
            lens: scheme === 'dark' ? 'rgba(255,255,255,0.2)' : '#FFFFFF',
            lensEdge: scheme === 'dark' ? 'rgba(255,255,255,0.35)' : '#FFFFFF',
          }}
          radius={22}
          padding={3}
          itemStyle={styles.layerItem}
          style={styles.layerSwitch}
          accessibilityLabel="Map layer"
        />

        {soil && soilAdvisory && <SoilCard profile={soil} advisory={soilAdvisory} />}
      </View>

      {region && mapped.length === 0 && (
        <Animated.View entering={FadeIn.duration(300).delay(200)} exiting={FadeOut.duration(150)} style={[styles.hint, { bottom: accessoryBottom + 70 }]} pointerEvents="none">
          <Glass radius={22} style={styles.hintGlass}>
            <MapPin size={18} color={colors.primary} hole={c.card} />
            <Text style={styles.hintText}>Tap the pin on a scan result to log it here.</Text>
          </Glass>
        </Animated.View>
      )}

      {selected && layer === 'pins' && (
        <Popover
          issue={selected.issue}
          left={popLeft}
          bottom={height - selected.y + 32}
          arrowX={Math.max(18, Math.min(POPOVER_WIDTH - 36, selected.x - popLeft - 9))}
        />
      )}

      {OPEN_TILES && region && (
        <Text style={[styles.attribution, { bottom: accessoryBottom + 62 }]} pointerEvents="none">
          © OpenStreetMap contributors
        </Text>
      )}

      {/* Tab bar accessory: legend for the active layer */}
      <Glass radius={27} style={[styles.legend, { bottom: accessoryBottom }, legendStyle]}>
        {layer === 'pins' ? <PinsLegend key="pins" issues={mapped} /> : <HealthLegend key="health" />}
      </Glass>
    </ScreenTransition>
  );
}

const useStyles = makeStyles((c) => ({
  waiting: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12 },
  waitingText: { fontSize: 16, color: c.labelSecondary },
  topFade: { position: 'absolute', left: 0, right: 0, top: 0 },
  header: { position: 'absolute', left: SIDE, right: SIDE, gap: 12 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.7, lineHeight: 40, color: c.label },
  subtitle: { fontSize: 16, fontWeight: '500', color: c.labelSecondary },
  locate: { width: 48, height: 48, marginTop: 4, alignItems: 'center', justifyContent: 'center' },
  layerSwitch: { alignSelf: 'flex-start', height: 44 },
  layerItem: { height: 38, paddingHorizontal: 16 },
  legend: { position: 'absolute', left: SIDE, right: SIDE },
  attribution: { position: 'absolute', right: SIDE + 6, fontSize: 10, color: c.labelTertiary },
  hint: { position: 'absolute', left: SIDE, right: SIDE, alignItems: 'center' },
  hintGlass: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
  hintText: { fontSize: 15, fontWeight: '500', color: c.labelStrong, flexShrink: 1 },
}));
