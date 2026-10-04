/**
 * TileMap — a lightweight slippy map drawn entirely in React Native.
 *
 * Why not react-native-maps: in Expo Go the native Google map rendered black
 * (Google logo, no tiles, tile overlays ignored). This draws OpenStreetMap
 * tiles as cached images and handles pan / pinch / double-tap with
 * gesture-handler + Reanimated, so it works anywhere, and tiles seen once stay
 * available offline (expo-image disk cache).
 *
 * Coordinates: everything lives in "world pixels" at a fixed base zoom Z0,
 * relative to the initial centre. One animated layer (translate + scale) moves
 * tiles and overlays together on the UI thread; tiles for the right zoom level
 * are re-picked in JS as the view changes.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ease } from '../../lib/theme';

const TILE = 256;
/**
 * The moving layer is a large square centred on the screen (not zero-sized):
 * Android only delivers touches to children inside their parent's bounds, so
 * pins must sit inside the layer. Layer-local coords = world coords + HALF.
 */
const HALF = 50_000;
const MIN_TILE_Z = 3;
const MAX_TILE_Z = 19;
const MIN_SCALE = 1 / 256; // ~8 zoom levels out from the base, for the community view
const MAX_SCALE = 8;
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
// OSM tile usage policy asks clients to identify themselves.
const TILE_HEADERS = { 'User-Agent': 'agriOS/1.0 (+https://github.com/Geoshua/agriOS)' };

export interface LatLng {
  lat: number;
  lng: number;
}

/** Global pixel position of a coordinate at zoom z (Web Mercator). */
function project(lat: number, lng: number, z: number) {
  const size = TILE * 2 ** z;
  const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export interface MapContext {
  /** Position inside the map layer for a coordinate (use for absolute left/top). */
  toWorld: (lat: number, lng: number) => { x: number; y: number };
  /** Length of `meters` in world pixels at latitude `lat`. */
  metersToPx: (meters: number, lat: number) => number;
  /** Current zoom scale of the layer — counter-scale markers with 1 / scale. */
  scale: SharedValue<number>;
}

export interface TileMapHandle {
  /** Screen position (relative to the map view) of a coordinate. */
  toScreen: (lat: number, lng: number) => { x: number; y: number };
  /** Animate so `point` sits in the middle, at `zoomLevel` (defaults to the initial zoom). */
  recenter: (point: LatLng, zoomLevel?: number) => void;
}

interface Props {
  center: LatLng;
  /** Initial zoom level (OSM z). */
  zoom?: number;
  /** Darken tiles (dark mode). */
  dim?: number;
  onPanStart?: () => void;
  onPress?: () => void;
  children?: (ctx: MapContext) => React.ReactNode;
}

type Tile = { key: string; z: number; x: number; y: number; left: number; top: number; size: number };

const TileMap = forwardRef<TileMapHandle, Props>(function TileMap({ center, zoom = 17, dim = 0, onPanStart, onPress, children }, ref) {
  const Z0 = Math.round(zoom);
  const origin = useMemo(() => project(center.lat, center.lng, Z0), []); // fixed for the map's lifetime
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Gesture worklets run on the UI thread and can keep a stale copy of `size`
  // from before layout ({0, 0}). That anchored pinch-zoom half a screen
  // down-right of the fingers, so the map slid instead of zooming. Worklets
  // read this shared value instead.
  const viewSize = useSharedValue({ w: 0, h: 0 });
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [prevTiles, setPrevTiles] = useState<Tile[]>([]);
  const lastZ = useRef<number | null>(null);
  const tilesRef = useRef<Tile[]>([]);
  const prevTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // View transform: screen = centre + t + world * s
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const s = useSharedValue(2 ** (zoom - Z0));
  // Pinch and pan run simultaneously, so each keeps its own anchor. Sharing one
  // (and both writing tx/ty every frame) made a pinch slide the map instead of
  // zooming about the fingers.
  const start = useSharedValue({ tx: 0, ty: 0, s: 1, fx: 0, fy: 0 });
  const panBase = useSharedValue({ x: 0, y: 0, pointers: 0 });
  const pinching = useSharedValue(false);
  const lastPick = useSharedValue(0);

  const toWorld = useCallback(
    (lat: number, lng: number) => {
      const p = project(lat, lng, Z0);
      return { x: p.x - origin.x, y: p.y - origin.y };
    },
    [Z0, origin],
  );

  const metersToPx = useCallback(
    (meters: number, lat: number) => meters / ((156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** Z0),
    [Z0],
  );

  // ── Tile picking (JS) ───────────────────────────────────────────────────────
  const pickTiles = useCallback(
    (t: { x: number; y: number; s: number }) => {
      if (!size.w) return;
      const z = Math.max(MIN_TILE_Z, Math.min(MAX_TILE_Z, Math.round(Z0 + Math.log2(t.s))));
      const ts = TILE * 2 ** (Z0 - z); // tile size in world px
      const margin = ts * 0.5;
      const left = (-size.w / 2 - t.x) / t.s - margin;
      const right = (size.w / 2 - t.x) / t.s + margin;
      const top = (-size.h / 2 - t.y) / t.s - margin;
      const bottom = (size.h / 2 - t.y) / t.s + margin;
      const n = 2 ** z;
      const next: Tile[] = [];
      for (let ix = Math.floor((origin.x + left) / ts); ix <= Math.floor((origin.x + right) / ts); ix++) {
        for (let iy = Math.floor((origin.y + top) / ts); iy <= Math.floor((origin.y + bottom) / ts); iy++) {
          if (iy < 0 || iy >= n) continue;
          const wx = ((ix % n) + n) % n;
          next.push({ key: `${z}/${ix}/${iy}`, z, x: wx, y: iy, left: HALF + ix * ts - origin.x, top: HALF + iy * ts - origin.y, size: ts });
        }
      }
      if (lastZ.current !== null && lastZ.current !== z) {
        // Keep the old zoom level underneath until the new tiles fade in.
        setPrevTiles(tilesRef.current);
        if (prevTimer.current) clearTimeout(prevTimer.current);
        prevTimer.current = setTimeout(() => setPrevTiles([]), 700);
      }
      lastZ.current = z;
      tilesRef.current = next;
      setTiles(next);
    },
    [size.w, size.h, Z0, origin],
  );

  useEffect(() => {
    pickTiles({ x: tx.value, y: ty.value, s: s.value });
  }, [pickTiles]);
  useEffect(() => () => {
    if (prevTimer.current) clearTimeout(prevTimer.current);
  }, []);

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    viewSize.value = { w: width, h: height };
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  }

  // ── Gestures (UI thread) ────────────────────────────────────────────────────
  const maybePick = () => {
    'worklet';
    const now = Date.now();
    if (now - lastPick.value > 120) {
      lastPick.value = now;
      runOnJS(pickTiles)({ x: tx.value, y: ty.value, s: s.value });
    }
  };
  const finalPick = () => {
    'worklet';
    runOnJS(pickTiles)({ x: tx.value, y: ty.value, s: s.value });
  };

  const pan = Gesture.Pan()
    .minDistance(4)
    .averageTouches(true)
    .onStart((e) => {
      panBase.value = { x: tx.value - e.translationX, y: ty.value - e.translationY, pointers: e.numberOfPointers };
      if (onPanStart) runOnJS(onPanStart)();
    })
    .onUpdate((e) => {
      // While pinching, the pinch owns the position; keep re-anchoring so the
      // pan continues smoothly afterwards. Also re-anchor when a finger lifts
      // or lands — the averaged touch point jumps then.
      if (pinching.value || e.numberOfPointers !== panBase.value.pointers) {
        panBase.value = { x: tx.value - e.translationX, y: ty.value - e.translationY, pointers: e.numberOfPointers };
        return;
      }
      tx.value = panBase.value.x + e.translationX;
      ty.value = panBase.value.y + e.translationY;
      maybePick();
    })
    .onEnd(() => finalPick());

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      pinching.value = true;
      start.value = { tx: tx.value, ty: ty.value, s: s.value, fx: e.focalX - viewSize.value.w / 2, fy: e.focalY - viewSize.value.h / 2 };
      if (onPanStart) runOnJS(onPanStart)();
    })
    .onUpdate((e) => {
      const st = start.value;
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, st.s * e.scale));
      const k = next / st.s;
      // The world point that was under the fingers stays under them — including
      // when the fingers move together (two-finger pan).
      const fx = e.focalX - viewSize.value.w / 2;
      const fy = e.focalY - viewSize.value.h / 2;
      tx.value = fx - (st.fx - st.tx) * k;
      ty.value = fy - (st.fy - st.ty) * k;
      s.value = next;
      maybePick();
    })
    .onFinalize(() => {
      pinching.value = false;
    })
    .onEnd(() => finalPick());

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      const fx = e.x - viewSize.value.w / 2;
      const fy = e.y - viewSize.value.h / 2;
      const next = Math.min(MAX_SCALE, s.value * 2);
      const k = next / s.value;
      const cfg = { duration: 280, easing: ease.emphasized };
      tx.value = withTiming(fx - (fx - tx.value) * k, cfg);
      ty.value = withTiming(fy - (fy - ty.value) * k, cfg);
      s.value = withTiming(next, cfg, () => finalPick());
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  // ── Imperative API ──────────────────────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      toScreen: (lat, lng) => {
        const p = toWorld(lat, lng);
        return { x: size.w / 2 + tx.value + p.x * s.value, y: size.h / 2 + ty.value + p.y * s.value };
      },
      recenter: (point, zoomLevel = zoom) => {
        const p = toWorld(point.lat, point.lng);
        const target = Math.max(MIN_SCALE, Math.min(MAX_SCALE, 2 ** (zoomLevel - Z0)));
        const cfg = { duration: 650, easing: ease.emphasized };
        tx.value = withTiming(-p.x * target, cfg);
        ty.value = withTiming(-p.y * target, cfg);
        s.value = withTiming(target, cfg, () => finalPick());
      },
    }),
    [toWorld, size.w, size.h, zoom, Z0],
  );

  const layerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: s.value }],
  }));

  const toLayer = useCallback(
    (lat: number, lng: number) => {
      const p = toWorld(lat, lng);
      return { x: HALF + p.x, y: HALF + p.y };
    },
    [toWorld],
  );
  const ctx = useMemo<MapContext>(() => ({ toWorld: toLayer, metersToPx, scale: s }), [toLayer, metersToPx]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.root} onLayout={onLayout} collapsable={false}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onPress} accessible={false} />
        {size.w > 0 && (
          <Animated.View style={[styles.layer, { left: size.w / 2 - HALF, top: size.h / 2 - HALF }, layerStyle]} pointerEvents="box-none">
            {[...prevTiles, ...tiles].map((t) => (
              <Image
                key={t.key}
                source={{ uri: TILE_URL(t.z, t.x, t.y), headers: TILE_HEADERS }}
                cachePolicy="disk"
                transition={180}
                recyclingKey={t.key}
                style={{ position: 'absolute', left: t.left, top: t.top, width: t.size + 0.5, height: t.size + 0.5 }}
              />
            ))}
            {children?.(ctx)}
          </Animated.View>
        )}
        {dim > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${dim})` }]} pointerEvents="none" />}
      </View>
    </GestureDetector>
  );
});

export default TileMap;

/** Places children at a coordinate and keeps them the same size on screen while zooming. */
export function MapMarker({ ctx, lat, lng, children, zIndex }: { ctx: MapContext; lat: number; lng: number; children: React.ReactNode; zIndex?: number }) {
  const p = ctx.toWorld(lat, lng);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 / ctx.scale.value }] }));
  return (
    <Animated.View style={[styles.marker, { left: p.x, top: p.y, zIndex }, style]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}

/** A filled circle with a real-world radius (scales with the map). */
export function MapCircle({
  ctx,
  lat,
  lng,
  radiusM,
  fill,
  stroke,
  strokeWidth = 1.5,
}: {
  ctx: MapContext;
  lat: number;
  lng: number;
  radiusM: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  const p = ctx.toWorld(lat, lng);
  const r = ctx.metersToPx(radiusM, lat);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: p.x - r,
        top: p.y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: fill,
        borderColor: stroke,
        borderWidth: stroke ? strokeWidth : 0,
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  layer: { position: 'absolute', width: HALF * 2, height: HALF * 2 },
  marker: { position: 'absolute', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
});
