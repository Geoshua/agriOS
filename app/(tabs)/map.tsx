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
import BrandMark from '../../components/glass/BrandMark';
import { Globe, Heat, Leaf, Locate, MapPin } from '../../components/glass/Icons';
import { buildDemoScenario, DEMO_CENTER, DEMO_PLACE } from '../../lib/demoScenario';
import {
  BlockLabel,
  CommunityLegend,
  DISEASE_COLOR,
  HealthLegend,
  HeatmapRegion,
  PinsLegend,
  ClusterPin,
  Pin,
  Popover,
  POPOVER_WIDTH,
  RegionBadge,
  RegionCard,
  SoilCard,
} from '../../components/map/MapParts';
import TileMap, { MapCircle, MapContext, MapMarker, TileMapHandle } from '../../components/map/TileMap';
import ReadAloudButton from '../../components/ReadAloudButton';

type Layer = 'pins' | 'health' | 'community';
const LAYERS: Layer[] = ['pins', 'health', 'community'];

const ZONE_RADIUS: Record<string, number> = { high: 30, medium: 22, low: 16, none: 12, unknown: 16 };
const HEAT_RADIUS: Record<string, number> = { high: 48, medium: 40, low: 32, none: 42, unknown: 28 };
const HEAT_RINGS: [number, number][] = [[1, 0.16], [0.62, 0.2], [0.3, 0.26]]; // [radius factor, alpha]
const SEVERITY_RANK: Record<string, number> = { high: 4, medium: 3, low: 2, unknown: 1, none: 0 };
const MAP_ZOOM = 17;
// The community view re-bases the map at this zoom (see TileMap MIN_SCALE).
const COMMUNITY_ZOOM = 12;
/** Pins closer than this on screen merge into one cluster bubble. */
const CLUSTER_PX = 44;
/** A village within this distance is 'your community'. */
const COMMUNITY_RADIUS_KM = 15;
/** Village area on the community map; small enough that neighbours (~5–8 km apart) stay distinct at COMMUNITY_ZOOM. */
const REGION_RADIUS_M = 2800;
const HEATMAP_TIMEOUT_MS = 8000;

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export default function MapScreen() {
  const { width, height } = useWindowDimensions();
  const { top, accessoryBottom } = useChromeInsets();
  const mapRef = useRef<TileMapHandle>(null);
  const { c } = useTheme();
  const styles = useStyles();
  const storeIssues = useShambaStore((s) => s.issues);

  const [gpsLocation, setLocation] = useState<Location.LocationObject | null>(null);
  const [locating, setLocating] = useState(true);
  const [dbIssues, setIssues] = useState<IssueRecord[]>([]);

  // Demo scenario: a rural farm with seeded pins, health and community data,
  // held in memory only (never written to the farmer's database).
  const [demo, setDemo] = useState(false);
  const demoData = useMemo(() => (demo ? buildDemoScenario() : null), [demo]);
  const location: Location.LocationObject | null = demo
    ? { coords: { latitude: DEMO_CENTER.lat, longitude: DEMO_CENTER.lng, altitude: null, accuracy: 5, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() }
    : gpsLocation;
  const issues = demoData?.issues ?? dbIssues;
  const [layer, setLayer] = useState<Layer>('pins');
  const [zoomLevel, setZoomLevel] = useState(MAP_ZOOM);
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
    if (!location) return;
    let cancelled = false;
    setSoil(null);
    fetchSoilData(location.coords.latitude, location.coords.longitude)
      .then((profile) => !cancelled && profile && setSoil(profile))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasLocation, demo]);
  const soilAdvisory = soil ? getSoilAdvisory(soil) : null;

  // If GPS arrives after the map opened on logged scans, glide to the farmer.
  useEffect(() => {
    if (location) mapRef.current?.recenter({ lat: location.coords.latitude, lng: location.coords.longitude });
  }, [hasLocation]);

  useEffect(() => {
    if (layer !== 'community') return;
    if (demoData) {
      setRegions(demoData.regions);
      setRegionsMeta({ total: demoData.regions.reduce((n, r) => n + r.total, 0), villages: demoData.regions.length });
      setRegionsLoading(false);
      return;
    }
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
  }, [layer, demoData]);

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

  // Merge pins that would overlap at the current zoom into count bubbles.
  const clusters = useMemo(() => {
    if (!mapped.length) return [];
    const lat0 = mapped[0].lat;
    const metresPerPx = (156543.03 * Math.cos((lat0 * Math.PI) / 180)) / 2 ** zoomLevel;
    const cellM = CLUSTER_PX * metresPerPx;
    const mPerDegLat = 111_320;
    const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    const cells = new Map<string, IssueRecord[]>();
    for (const i of mapped) {
      const key = `${Math.floor((i.lat * mPerDegLat) / cellM)}:${Math.floor((i.lng * mPerDegLng) / cellM)}`;
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }
    return [...cells.values()].map((list) => ({
      issues: list,
      lat: list.reduce((a, i) => a + i.lat, 0) / list.length,
      lng: list.reduce((a, i) => a + i.lng, 0) / list.length,
      worst: list.reduce((w, i) => ((SEVERITY_RANK[i.severity] ?? 0) > (SEVERITY_RANK[w] ?? 0) ? i.severity : w), 'none'),
    }));
  }, [mapped, zoomLevel]);

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

  function toggleDemo() {
    const next = !demo;
    setSelected(null);
    setSelectedRegion(null);
    setDemo(next);
    const focus = next ? DEMO_CENTER : gpsLocation ? { lat: gpsLocation.coords.latitude, lng: gpsLocation.coords.longitude } : null;
    if (focus) mapRef.current?.recenter(focus, layer === 'community' ? COMMUNITY_ZOOM : MAP_ZOOM);
  }

  function selectLayer(next: Layer) {
    setSelected(null);
    setSelectedRegion(null);
    // Switching to/from community re-mounts the map at that view's zoom.
    if ((next === 'community') !== (layer === 'community')) setZoomLevel(next === 'community' ? COMMUNITY_ZOOM : MAP_ZOOM);
    setLayer(next);
  }


  // "Your community": the nearest village within COMMUNITY_RADIUS_KM.
  const myCommunity = useMemo(() => {
    if (!location || !regions.length) return null;
    const me = { lat: location.coords.latitude, lng: location.coords.longitude };
    let best: { region: HeatmapRegion; km: number } | null = null;
    for (const region of regions) {
      const km = distanceKm(me, region);
      if (!best || km < best.km) best = { region, km };
    }
    return best && best.km <= COMMUNITY_RADIUS_KM ? best : null;
  }, [regions, location?.coords.latitude, location?.coords.longitude]);

  const popLeft = selected ? Math.max(16, Math.min(width - POPOVER_WIDTH - 16, selected.x - POPOVER_WIDTH / 2)) : 0;
  const subtitle =
    (demo ? `${DEMO_PLACE} · ` : '') +
    (layer === 'community'
      ? regionsLoading
        ? 'Loading regional data…'
        : regionsMeta && regionsMeta.total > 0
          ? `${regionsMeta.total} scans · ${regionsMeta.villages} villages · GPS ~10 km` +
            (myCommunity ? ` · you're in ${myCommunity.region.name ?? 'a community'}` : '')
          : 'No regional data yet'
      : mapped.length
        ? `${mapped.length} pin${mapped.length === 1 ? '' : 's'}${urgent ? ` · ${urgent} urgent` : ''}`
        : 'No issues logged yet');

  // Spoken summary for the speaker button: pins, worst blocks, soil.
  const SEVERITY_SPOKEN: Record<string, string> = { high: 'urgent problems', medium: 'problems', low: 'small problems', unknown: 'unclear scans', none: 'all healthy' };
  function mapPageText(): string {
    if (layer === 'community') {
      return regionsMeta && regionsMeta.total > 0
        ? `Community map. ${regionsMeta.total} scans from ${regionsMeta.villages} villages near you. Red areas have more disease.`
        : 'Community map. There is no regional data yet. It needs the co-op hub.';
    }
    const pins = mapped.length
      ? `Your field map shows ${mapped.length} logged ${mapped.length === 1 ? 'scan' : 'scans'}${urgent ? `, ${urgent} urgent` : ''}.`
      : 'No problems are logged on your field map yet.';
    const blockLine = blocks.length
      ? ' ' + [...blocks].sort((a, b) => a.block.localeCompare(b.block)).map((b) => `Block ${b.block}: ${SEVERITY_SPOKEN[b.worst] ?? b.worst}.`).join(' ')
      : '';
    const soilLine = soilAdvisory ? ` Soil: ${soilAdvisory.phAdvice} ${soilAdvisory.generalAdvice}` : '';
    return pins + blockLine + soilLine;
  }

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
        {layer === 'community' && myCommunity && (
          <MapCircle
            ctx={ctx}
            lat={myCommunity.region.lat}
            lng={myCommunity.region.lng}
            radiusM={REGION_RADIUS_M * 1.12}
            fill="transparent"
            stroke={colors.primary}
          />
        )}
        {layer === 'community' && myCommunity && (
          <MapMarker ctx={ctx} lat={myCommunity.region.lat} lng={myCommunity.region.lng} zIndex={3}>
            <View style={styles.communityTagOffset} pointerEvents="none">
              {/* Opaque pill (not Glass) so it reads over busy map tiles. */}
              <View style={styles.communityTag}>
                <View style={styles.communityTagDot} />
                <Text style={styles.communityTagText} numberOfLines={1}>
                  Your community · {myCommunity.region.name ?? 'nearby'}
                </Text>
              </View>
            </View>
          </MapMarker>
        )}
        {layer === 'community' &&
          regions.map((region, i) => (
            <MapMarker key={`rb${i}`} ctx={ctx} lat={region.lat} lng={region.lng} zIndex={2}>
              <Pressable
                onPress={() => setSelectedRegion(region)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${region.name ?? 'Region'}: ${region.total} scans, mostly ${region.dominant}`}
              >
                <RegionBadge region={region} selected={selectedRegion === region} />
              </Pressable>
            </MapMarker>
          ))}
      </Animated.View>

      {/* Pins (Pins view only), merged into clusters where they'd overlap */}
      {layer === 'pins' &&
        clusters.map((cl, i) =>
          cl.issues.length === 1 ? (
            <MapMarker key={`p${cl.issues[0].id}`} ctx={ctx} lat={cl.lat} lng={cl.lng} zIndex={selected?.issue.id === cl.issues[0].id ? 2 : 1}>
              <Pressable
                onPress={() => selectIssue(cl.issues[0])}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${cl.issues[0].diseaseName}, ${cl.issues[0].severity}`}
              >
                <Pin severity={cl.issues[0].severity} selected={selected?.issue.id === cl.issues[0].id} index={i} />
              </Pressable>
            </MapMarker>
          ) : (
            <MapMarker key={`c${cl.issues[0].id}-${cl.issues.length}`} ctx={ctx} lat={cl.lat} lng={cl.lng} zIndex={1}>
              <Pressable
                onPress={() => {
                  setSelected(null);
                  mapRef.current?.recenter({ lat: cl.lat, lng: cl.lng }, Math.min(zoomLevel + 2, MAP_ZOOM + 3));
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`${cl.issues.length} scans here, worst ${cl.worst}. Zoom in`}
              >
                <ClusterPin severity={cl.worst} count={cl.issues.length} />
              </Pressable>
            </MapMarker>
          ),
        )}

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
            // Community re-mounts the map at its own base zoom: zooming the
            // field-zoom layer out that far made tiles too big to draw (black map).
            key={layer === 'community' ? 'community' : 'field'}
            ref={mapRef}
            center={location ? { lat: location.coords.latitude, lng: location.coords.longitude } : center}
            zoom={layer === 'community' ? COMMUNITY_ZOOM : MAP_ZOOM}
            onZoomChange={setZoomLevel}
            dim={0.5}
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
          <BrandMark size={48} tone="glass" />
          <View pointerEvents="none" style={styles.titleBlock}>
            <Text style={styles.title} accessibilityRole="header">Field Map</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          <ReadAloudButton style={styles.speak} text={mapPageText} />
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
          tone="light"
          radius={24}
          padding={4}
          itemStyle={styles.layerItem}
          style={styles.layerSwitch}
          accessibilityLabel="Map layer"
        />

        {layer !== 'community' && soil && soilAdvisory && <SoilCard profile={soil} advisory={soilAdvisory} />}
      </View>

      {center && mapped.length === 0 && layer !== 'community' && (
        <Animated.View entering={FadeIn.duration(300).delay(200)} exiting={FadeOut.duration(150)} style={[styles.hint, { bottom: accessoryBottom + 70 }]} pointerEvents="none">
          <Glass radius={22} style={styles.hintGlass}>
            <MapPin size={18} color={colors.emeraldBright} hole={c.card} />
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
      {/* Floating map buttons, bottom right above the legend: demo farm + re-centre */}
      {!selectedRegion && (
        <View style={[styles.mapButtons, { bottom: accessoryBottom + 90 }]} pointerEvents="box-none">
          {/* Floating demo toggle: rural farm with seeded pins, health and community data */}
          <PressableScale
            onPress={toggleDemo}
            accessibilityRole="switch"
            accessibilityState={{ checked: demo }}
            accessibilityLabel={demo ? 'Leave demo farm' : 'Show demo farm'}
          >
            <Glass radius={24} tone="light" style={[styles.locate, demo && styles.demoOn]}>
              <Leaf size={22} color={demo ? colors.onPrimary : colors.emeraldBright} />
            </Glass>
            <Text style={styles.demoLabel}>{demo ? 'Exit demo' : 'Demo'}</Text>
          </PressableScale>
          <PressableScale onPress={recenter} disabled={!location} accessibilityRole="button" accessibilityLabel="Center on my location">
            <Glass radius={24} tone="light" style={styles.locate}>
              <Locate />
            </Glass>
          </PressableScale>
        </View>
      )}

      <Glass radius={27} tone="light" style={[styles.legend, { bottom: accessoryBottom }, legendStyle]}>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 40, color: c.label },
  subtitle: { fontSize: 16, fontWeight: '500', color: c.labelSecondary },
  locate: { width: 48, height: 48, marginTop: 4, alignItems: 'center', justifyContent: 'center' },
  mapButtons: { position: 'absolute', right: SIDE, alignItems: 'center', gap: 10 },
  titleBlock: { flex: 1 },
  demoOn: { backgroundColor: colors.primary },
  demoLabel: { marginTop: 2, fontSize: 12, fontWeight: '600', textAlign: 'center', color: c.label, textShadowColor: c.groundMap, textShadowRadius: 3 },
  layerSwitch: { alignSelf: 'flex-start', height: 48 },
  layerItem: { height: 40, paddingHorizontal: 16 },
  speak: { marginTop: 4 },
  legend: { position: 'absolute', left: SIDE, right: SIDE },
  attribution: { position: 'absolute', right: SIDE + 6, fontSize: 10, color: c.labelTertiary },
  hint: { position: 'absolute', left: SIDE, right: SIDE + 64, alignItems: 'center' },
  hintGlass: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
  hintText: { fontSize: 15, fontWeight: '500', color: c.labelStrong, flexShrink: 1 },
  me: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.locate,
    borderWidth: 4,
    borderColor: colors.cream,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  blockLabelOffset: { transform: [{ translateY: -34 }] },
  // Badge is 44 high (top at -22); tag sits just above it.
  communityTagOffset: { transform: [{ translateY: -52 }] },
  communityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: c.tag,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  communityTagDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  communityTagText: { fontSize: 14, fontWeight: '700', color: c.label },
}));
