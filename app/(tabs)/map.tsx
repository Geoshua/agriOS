import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { getAllIssues, IssueRecord } from '../../lib/db';
import { fetchSoilData, getSoilAdvisory, SoilProfile } from '../../lib/soil';
import { useShambaStore } from '../../lib/store';
import { colors, heat, makeStyles, severityPin, spring, timing, useTheme } from '../../lib/theme';
import { withAlpha } from '../../lib/useTween';
import { SIDE, useChromeInsets } from '../../lib/layout';
import { DEMO_FARM, DEMO_MODE, LOCAL_SERVER_URL } from '../../lib/config';
import ScreenTransition from '../../components/glass/ScreenTransition';
import Glass from '../../components/glass/Glass';
import GlassSegmented from '../../components/glass/GlassSegmented';
import PressableScale from '../../components/glass/PressableScale';
import { Globe, Heat, Locate, MapPin } from '../../components/glass/Icons';
import {
  BlockLabel,
  CommunityLegend,
  DISEASE_COLOR,
  HealthLegend,
  HeatmapRegion,
  PinsLegend,
  Pin,
  Popover,
  POPOVER_WIDTH,
  RegionBadge,
  RegionCard,
  SoilCard,
} from '../../components/map/MapParts';
import TileMap, { MapCircle, MapContext, MapMarker, TileMapHandle } from '../../components/map/TileMap';

type Layer = 'pins' | 'health' | 'community';
const LAYERS: Layer[] = ['pins', 'health', 'community'];

const ZONE_RADIUS: Record<string, number> = { high: 30, medium: 22, low: 16, none: 12, unknown: 16 };
const HEAT_RADIUS: Record<string, number> = { high: 48, medium: 40, low: 32, none: 42, unknown: 28 };
const HEAT_RINGS: [number, number][] = [[1, 0.16], [0.62, 0.2], [0.3, 0.26]]; // [radius factor, alpha]
const SEVERITY_RANK: Record<string, number> = { high: 4, medium: 3, low: 2, unknown: 1, none: 0 };
const MAP_ZOOM = 17;
const COMMUNITY_ZOOM = 10.5;
const REGION_RADIUS_M = 6000;
const HEATMAP_TIMEOUT_MS = 8000;

export default function MapScreen() {
  const { width, height } = useWindowDimensions();
  const { top, accessoryBottom } = useChromeInsets();
  const mapRef = useRef<TileMapHandle>(null);
  const { c, scheme } = useTheme();
  const styles = useStyles();
  const storeIssues = useShambaStore((s) => s.issues);

  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locating, setLocating] = useState(true);
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [layer, setLayer] = useState<Layer>('pins');
  const [selected, setSelected] = useState<{ issue: IssueRecord; x: number; y: number } | null>(null);
  const [soil, setSoil] = useState<SoilProfile | null>(null);

  // Community view: regional aggregates from the hub's /heatmap (GPS anonymised to ~10 km).
  const [regions, setRegions] = useState<HeatmapRegion[]>([]);
  const [regionsMeta, setRegionsMeta] = useState<{ total: number; villages: number } | null>(null);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<HeatmapRegion | null>(null);

  useEffect(() => {
    if (DEMO_MODE) {
      // Demo: the farmer is standing on the Kiambu demo farm.
      setLocation({
        timestamp: Date.now(),
        mocked: true,
        coords: { latitude: DEMO_FARM.lat, longitude: DEMO_FARM.lng, altitude: null, accuracy: 5, altitudeAccuracy: null, heading: null, speed: null },
      });
      setLocating(false);
      return;
    }
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

  // If GPS arrives after the map opened on logged scans, glide to the farmer.
  useEffect(() => {
    if (location) mapRef.current?.recenter({ lat: location.coords.latitude, lng: location.coords.longitude });
  }, [hasLocation]);

  useEffect(() => {
    if (layer !== 'community') return;
    setRegionsLoading(true);
    const base = LOCAL_SERVER_URL || 'http://localhost:7384';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEATMAP_TIMEOUT_MS);
    fetch(`${base}/heatmap`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        setRegions(data.regions ?? []);
        setRegionsMeta({ total: data.total ?? 0, villages: data.villages ?? 0 });
      })
      .catch(() => {
        setRegions([]);
        setRegionsMeta(null);
      })
      .finally(() => {
        clearTimeout(timer);
        setRegionsLoading(false);
      });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [layer]);

  useFocusEffect(
    useCallback(() => {
      getAllIssues().then(setIssues).catch(() => {});
    }, []),
  );
  useEffect(() => {
    getAllIssues().then(setIssues).catch(() => {});
  }, [storeIssues]);

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

  // Centre on the farmer, or on their logged scans without GPS. Fixed once the map mounts.
  const center = location
    ? { lat: location.coords.latitude, lng: location.coords.longitude }
    : mapped.length
      ? { lat: mapped[0].lat, lng: mapped[0].lng }
      : null;

  // Pins ↔ health cross-fade.
  const pinsOn = useSharedValue(1);
  useEffect(() => {
    pinsOn.value = withTiming(layer === 'pins' ? 1 : 0, timing.slow);
  }, [layer]);
  const communityOn = useSharedValue(0);
  useEffect(() => {
    communityOn.value = withTiming(layer === 'community' ? 1 : 0, timing.slow);
  }, [layer]);
  const zonesStyle = useAnimatedStyle(() => ({ opacity: pinsOn.value }));
  const heatStyle = useAnimatedStyle(() => ({ opacity: (1 - pinsOn.value) * (1 - communityOn.value) }));
  const fieldStyle = useAnimatedStyle(() => ({ opacity: 1 - communityOn.value }));
  const regionsStyle = useAnimatedStyle(() => ({ opacity: communityOn.value }));

  // Legend height follows the active layer.
  const legendH = useSharedValue(54);
  useEffect(() => {
    legendH.value = withSpring(layer === 'pins' ? 54 : layer === 'health' ? 62 : 66, spring.snappy);
  }, [layer]);
  const legendStyle = useAnimatedStyle(() => ({ height: legendH.value, borderRadius: legendH.value / 2 }));

  function selectIssue(issue: IssueRecord) {
    const point = mapRef.current?.toScreen(issue.lat, issue.lng);
    if (point) setSelected({ issue, x: point.x, y: point.y });
  }

  function recenter() {
    if (!location) return;
    setSelected(null);
    setSelectedRegion(null);
    mapRef.current?.recenter(
      { lat: location.coords.latitude, lng: location.coords.longitude },
      layer === 'community' ? COMMUNITY_ZOOM : MAP_ZOOM,
    );
  }

  function selectLayer(next: Layer) {
    setSelected(null);
    setSelectedRegion(null);
    const focus = location ? { lat: location.coords.latitude, lng: location.coords.longitude } : center;
    // Zoom out to region scale for the community view, back to the field otherwise.
    if (focus && (next === 'community') !== (layer === 'community')) {
      mapRef.current?.recenter(focus, next === 'community' ? COMMUNITY_ZOOM : MAP_ZOOM);
    }
    setLayer(next);
  }

  const popLeft = selected ? Math.max(16, Math.min(width - POPOVER_WIDTH - 16, selected.x - POPOVER_WIDTH / 2)) : 0;
  const subtitle =
    layer === 'community'
      ? regionsLoading
        ? 'Loading regional data…'
        : regionsMeta && regionsMeta.total > 0
          ? `${regionsMeta.total} scan${regionsMeta.total === 1 ? '' : 's'} · ${regionsMeta.villages} village${regionsMeta.villages === 1 ? '' : 's'} · GPS ~10 km`
          : 'No regional data yet'
      : mapped.length
        ? `${mapped.length} pin${mapped.length === 1 ? '' : 's'}${urgent ? ` · ${urgent} urgent` : ''}`
        : 'No issues logged yet';

  const renderOverlays = (ctx: MapContext) => (
    <>
      {/* Health heat map: stacked soft discs approximate a gradient per scan. */}
      <Animated.View style={[StyleSheet.absoluteFill, heatStyle]} pointerEvents="none">
        {mapped.map((issue) =>
          HEAT_RINGS.map(([k, alpha], ring) => (
            <MapCircle
              key={`h${issue.id}-${ring}`}
              ctx={ctx}
              lat={issue.lat}
              lng={issue.lng}
              radiusM={(HEAT_RADIUS[issue.severity] ?? 30) * k}
              fill={withAlpha(heat[issue.severity] ?? heat.unknown, alpha)}
            />
          )),
        )}
      </Animated.View>

      {/* Pin zones */}
      <Animated.View style={[StyleSheet.absoluteFill, zonesStyle, fieldStyle]} pointerEvents="none">
        {mapped.map((issue) => (
          <MapCircle
            key={`z${issue.id}`}
            ctx={ctx}
            lat={issue.lat}
            lng={issue.lng}
            radiusM={ZONE_RADIUS[issue.severity] ?? 16}
            fill={withAlpha(severityPin[issue.severity] ?? severityPin.unknown, 0.14)}
            stroke={withAlpha(severityPin[issue.severity] ?? severityPin.unknown, 0.5)}
          />
        ))}
      </Animated.View>

      {/* You are here */}
      {location && (
        <MapMarker ctx={ctx} lat={location.coords.latitude} lng={location.coords.longitude}>
          <View style={styles.me} />
        </MapMarker>
      )}

      {/* Community regions */}
      <Animated.View style={[StyleSheet.absoluteFill, regionsStyle]} pointerEvents={layer === 'community' ? 'box-none' : 'none'}>
        {regions.map((region, i) => (
          <MapCircle
            key={`rc${i}`}
            ctx={ctx}
            lat={region.lat}
            lng={region.lng}
            radiusM={REGION_RADIUS_M}
            fill={withAlpha(DISEASE_COLOR[region.dominant] ?? DISEASE_COLOR.unknown, 0.16)}
            stroke={withAlpha(DISEASE_COLOR[region.dominant] ?? DISEASE_COLOR.unknown, 0.5)}
          />
        ))}
        {layer === 'community' &&
          regions.map((region, i) => (
            <MapMarker key={`rb${i}`} ctx={ctx} lat={region.lat} lng={region.lng} zIndex={2}>
              <Pressable
                onPress={() => setSelectedRegion(region)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Region: ${region.total} scans, mostly ${region.dominant}`}
              >
                <RegionBadge region={region} selected={selectedRegion === region} />
              </Pressable>
            </MapMarker>
          ))}
      </Animated.View>

      {layer !== 'community' && mapped.map((issue, i) => (
        <MapMarker key={`p${issue.id}`} ctx={ctx} lat={issue.lat} lng={issue.lng} zIndex={selected?.issue.id === issue.id ? 2 : 1}>
          <Pressable
            onPress={() => selectIssue(issue)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${issue.diseaseName}, ${issue.severity}`}
          >
            <Pin severity={issue.severity} selected={selected?.issue.id === issue.id} index={i} />
          </Pressable>
        </MapMarker>
      ))}

      {layer === 'health' &&
        blocks.map((b) => (
          <MapMarker key={`b${b.block}`} ctx={ctx} lat={b.lat} lng={b.lng} zIndex={3}>
            <View style={styles.blockLabelOffset} pointerEvents="none">
              <BlockLabel block={b.block} worst={b.worst} />
            </View>
          </MapMarker>
        ))}
    </>
  );

  return (
    <ScreenTransition
      background={c.groundMap}
      backdrop={
        center ? (
          <TileMap
            ref={mapRef}
            center={center}
            zoom={MAP_ZOOM}
            dim={scheme === 'dark' ? 0.38 : 0}
            onPanStart={() => setSelected(null)}
            onPress={() => {
              setSelected(null);
              setSelectedRegion(null);
            }}
          >
            {renderOverlays}
          </TileMap>
        ) : (
          <View style={styles.waiting}>
            {locating ? <ActivityIndicator color={c.labelSecondary} /> : <MapPin size={40} color={c.checkBorder} hole={c.groundMap} />}
            <Text style={styles.waitingText}>{locating ? 'Finding your location…' : 'Turn on location to see your field'}</Text>
          </View>
        )
      }
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
          <View pointerEvents="none">
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
            { key: 'community', label: 'Community', accessibilityLabel: 'Community disease map', icon: (col) => <Globe color={col} /> },
          ]}
          selectedIndex={LAYERS.indexOf(layer)}
          onSelect={(i) => selectLayer(LAYERS[i])}
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

        {layer !== 'community' && soil && soilAdvisory && <SoilCard profile={soil} advisory={soilAdvisory} />}
      </View>

      {center && mapped.length === 0 && layer !== 'community' && (
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

      {center && (
        <Text style={[styles.attribution, { bottom: accessoryBottom + 62 }]} pointerEvents="none">
          © OpenStreetMap contributors
        </Text>
      )}

      {selectedRegion && layer === 'community' && (
        <RegionCard region={selectedRegion} bottom={accessoryBottom + 66 + 12} onClose={() => setSelectedRegion(null)} />
      )}

      {/* Tab bar accessory: legend for the active layer */}
      <Glass radius={27} style={[styles.legend, { bottom: accessoryBottom }, legendStyle]}>
        {layer === 'pins' && <PinsLegend key="pins" issues={mapped} />}
        {layer === 'health' && <HealthLegend key="health" />}
        {layer === 'community' && <CommunityLegend key="community" />}
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
  me: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.locate,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  blockLabelOffset: { transform: [{ translateY: -34 }] },
}));
