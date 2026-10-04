/**
 * Demo scene — a 360° panorama of coffee leaves that stands in for the camera,
 * so the scanner can be demonstrated without real plants. Turning/tilting the
 * phone pans the view (DeviceMotion); dragging with a finger also works, for
 * phones or emulators without a gyroscope.
 *
 * `captureFrame()` crops the centre of the current view out of the bundled
 * panorama (a 3:4 portrait frame, like a camera photo) and returns a JPEG URI
 * that goes through `runInference()` exactly like a camera frame.
 *
 * Panorama layout (see scripts/demo_scene/make_panorama.py): the first `width`
 * columns are one full turn; a `wrapMargin`-wide copy of the start is appended
 * on the right, so every view window is one rectangle — no stitching at the seam.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { DeviceMotion, DeviceMotionMeasurement } from 'expo-sensors';
import { Asset } from 'expo-asset';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { LookAround } from '../glass/Icons';
import { colors } from '../../lib/theme';
import { useChromeInsets } from '../../lib/layout';
import sceneMeta from '../../assets/demo-scene/leaves.json';

const PANORAMA = require('../../assets/demo-scene/panorama.jpg');
// Byte-identical copy used only for cropping. In release builds expo-asset
// returns a bundled *image* as an Android resource name (no file), which
// ImageManipulator can't open — every demo frame failed silently. Non-image
// assets are copied to a real file, so crop from this .bin copy.
const PANORAMA_FILE = require('../../assets/demo-scene/panorama-crop.bin');
const PANO_W = sceneMeta.width; // one full turn, px
const PANO_H = sceneMeta.height;
const MARGIN = sceneMeta.wrapMargin;
/** Panorama px visible across the screen (~40° of the 360°); must be ≤ MARGIN. Mirrored in check_crops.py. */
const VIEW_W_PX = 420;
const PX_PER_RAD = PANO_W / (2 * Math.PI);
/** Low-pass factor per sensor sample (~30 Hz → ~150 ms time constant). */
const SMOOTHING = 0.2;
const SENSOR_INTERVAL_MS = 33;

export interface DemoSceneHandle {
  /** JPEG file URI of the current centre view, or null if the scene isn't ready. */
  captureFrame: () => Promise<string | null>;
}

interface Props {
  /** Subscribes to motion sensors only while true (screen focused). */
  active: boolean;
}

function wrapPi(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Compass heading and elevation of the direction the back camera points, from
 * the W3C-style alpha/beta/gamma (Z-X'-Y'') that expo-sensors reports. Working
 * from the camera vector stays stable with the phone held upright, where alpha
 * and gamma on their own hit gimbal lock.
 */
function cameraDirection({ alpha: a, beta: b, gamma: g }: DeviceMotionMeasurement['rotation']) {
  const x = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const y = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  const z = -Math.cos(b) * Math.cos(g);
  return { heading: Math.atan2(x, y), elevation: Math.asin(Math.max(-1, Math.min(1, z))) };
}

/** Crop rectangle (panorama px) for a view centred on (cx, cy). */
function cropRect(cx: number, cy: number, viewW: number) {
  'worklet';
  const width = Math.round(Math.min(viewW, MARGIN));
  const height = Math.min(Math.round((width * 4) / 3), PANO_H);
  const originX = Math.floor((((cx - width / 2) % PANO_W) + PANO_W) % PANO_W);
  const originY = Math.round(Math.min(Math.max(cy - height / 2, 0), PANO_H - height));
  return { originX, originY, width, height };
}

const DemoScene = forwardRef<DemoSceneHandle, Props>(function DemoScene({ active }, ref) {
  const { width: sw, height: sh } = useWindowDimensions();
  const { top } = useChromeInsets();
  const [hasMotion, setHasMotion] = useState<boolean | null>(null);

  // Screen dp per panorama px. Fill the width with VIEW_W_PX, but never show more
  // than ~92 % of the panorama's height (so tilting still has room to move).
  const scale = Math.max(sw / VIEW_W_PX, sh / (PANO_H * 0.92));
  const viewW = sw / scale;
  const viewH = sh / scale;

  // View centre = sensor pose + finger drag, in panorama px (x unbounded, wrapped when drawn).
  const sensorX = useSharedValue(sceneMeta.leaves[0].x * PANO_W);
  const sensorY = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const uriRef = useRef<string | null>(null);
  useEffect(() => {
    Asset.fromModule(PANORAMA_FILE)
      .downloadAsync()
      .then((a) => { uriRef.current = a.localUri ?? a.uri; })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    // Heading is unwrapped (continuous across ±π) then low-passed.
    let lastRaw: number | null = null;
    let unwrapped = 0;
    let filtered = 0;
    let elev = 0;
    let elev0: number | null = null;
    let originX = 0;

    (async () => {
      const available = await DeviceMotion.isAvailableAsync().catch(() => false);
      if (available) await DeviceMotion.requestPermissionsAsync().catch(() => null);
      if (cancelled) return;
      setHasMotion(available);
      if (!available) return;
      DeviceMotion.setUpdateInterval(SENSOR_INTERVAL_MS);
      sub = DeviceMotion.addListener((m) => {
        if (!m.rotation) return;
        const { heading, elevation } = cameraDirection(m.rotation);
        elev = elev0 === null ? elevation : elev + SMOOTHING * (elevation - elev);
        // Pointing nearly straight up/down: heading is meaningless, hold it.
        if (Math.abs(elevation) < 1.2) {
          if (lastRaw === null) {
            // Start wherever the view currently is.
            unwrapped = filtered = heading;
            originX = sensorX.value - heading * PX_PER_RAD;
          } else {
            unwrapped += wrapPi(heading - lastRaw);
            filtered += SMOOTHING * (unwrapped - filtered);
          }
          lastRaw = heading;
          sensorX.value = originX + filtered * PX_PER_RAD;
        }
        // Relative to the starting tilt, so any comfortable grip starts level.
        // Tilting up moves the view up; the clamp happens where it's used.
        if (elev0 === null) elev0 = elev;
        sensorY.value = -(elev - elev0) * PX_PER_RAD;
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active]);

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onChange((e) => {
      dragX.value -= e.changeX / scale;
      dragY.value = Math.max(-PANO_H / 2, Math.min(PANO_H / 2, dragY.value - e.changeY / scale));
    });

  function centre() {
    'worklet';
    const cx = sensorX.value + dragX.value;
    const cy = Math.min(Math.max(PANO_H / 2 + sensorY.value + dragY.value, viewH / 2), PANO_H - viewH / 2);
    return { cx, cy };
  }

  const imageStyle = useAnimatedStyle(() => {
    const { cx, cy } = centre();
    const x0 = (((cx - viewW / 2) % PANO_W) + PANO_W) % PANO_W;
    return { transform: [{ translateX: -x0 * scale }, { translateY: -(cy - viewH / 2) * scale }] };
  });

  // The classified 3:4 frame, highlighted by dimming the rest of the view.
  const frameH = Math.min(Math.round((Math.round(Math.min(viewW, MARGIN)) * 4) / 3), PANO_H) * scale;
  const frameTop = (sh - frameH) / 2;

  useImperativeHandle(ref, () => ({
    async captureFrame() {
      const uri = uriRef.current;
      if (!uri) return null;
      const { cx, cy } = centre();
      const rect = cropRect(cx, cy, viewW);
      const context = ImageManipulator.manipulate(uri).crop(rect);
      try {
        const image = await context.renderAsync();
        try {
          const saved = await image.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
          return saved.uri;
        } finally {
          image.release();
        }
      } finally {
        context.release();
      }
    },
  }), [scale, viewW, viewH]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill} accessibilityLabel="Demo scene. Turn the phone or drag to look around.">
          <Animated.Image
            source={PANORAMA}
            fadeDuration={0}
            resizeMode="stretch"
            style={[{ width: (PANO_W + MARGIN) * scale, height: PANO_H * scale }, styles.image, imageStyle]}
          />
          <View pointerEvents="none" style={[styles.shade, { top: 0, height: frameTop }]} />
          <View pointerEvents="none" style={[styles.shade, { bottom: 0, height: frameTop }]} />
          <View pointerEvents="none" style={[styles.crosshair, { top: sh / 2 - 14, left: sw / 2 - 14 }]} />
        </View>
      </GestureDetector>

      <Animated.View entering={FadeIn.duration(220)} style={[styles.badgeRow, { top: top + 60 }]} pointerEvents="none">
        <View style={styles.badge}>
          <LookAround size={18} color={colors.emeraldBright} />
          <Text style={styles.badgeText}>Demo scene</Text>
          {hasMotion === false && <Text style={styles.badgeHint}>· drag to look</Text>}
        </View>
      </Animated.View>
    </View>
  );
});

export default DemoScene;

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: colors.bg },
  image: { position: 'absolute', left: 0, top: 0 },
  shade: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.28)' },
  crosshair: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(242,234,216,0.85)',
  },
  badgeRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  badge: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.chipScrim,
    borderWidth: 1.5,
    borderColor: colors.emeraldBright,
  },
  badgeText: { color: colors.onDark, fontSize: 15, fontWeight: '700' },
  badgeHint: { color: colors.onDarkSecondary, fontSize: 14 },
});
