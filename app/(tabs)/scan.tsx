import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useShambaStore, ScanMode } from '../../lib/store';
import { runInference, getDisease } from '../../lib/inference';
import { getQuickLocation } from '../../lib/location';
import { useLogIssue } from '../../lib/useLogIssue';
import { useManualCapture } from '../../lib/useManualCapture';
import { useOffloadQueue } from '../../lib/useOffloadQueue';
import { colors } from '../../lib/theme';
import ScreenTransition from '../../components/glass/ScreenTransition';
import PressableScale from '../../components/glass/PressableScale';
import { Leaf } from '../../components/glass/Icons';
import ScanTopBar from '../../components/scan/ScanTopBar';
import ARSpots from '../../components/scan/ARSpots';
import CameraGuides from '../../components/scan/CameraGuides';
import CaptureButton from '../../components/scan/CaptureButton';
import ModeRail from '../../components/scan/ModeRail';
import DetectionAccessory from '../../components/scan/DetectionAccessory';
import AdvisorySheet, { Detent } from '../../components/advisory/AdvisorySheet';

const INFERENCE_INTERVAL_MS = 1200;
const LOCATION_REFRESH_MS = 30_000;

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const isRunningRef = useRef(false);
  const focused = useIsFocused();

  const {
    currentDetection,
    setCurrentDetection,
    isScanning,
    scanMode,
    setScanMode,
    torch,
    activeBlock,
    setLastFrameUri,
    setLastKnownLocation,
  } = useShambaStore();

  // Cached GPS — refreshed every 30s, passed to /classify for data contribution.
  // Using a ref avoids re-creating runScan on every location update.
  const lastLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  // The live mode to return to when the details sheet closes.
  const liveMode = useRef<Exclude<ScanMode, 'details'>>('ar');
  const [detent, setDetent] = useState<Detent>('closed');
  const sheetPos = useSharedValue(0);

  const scanning = !!permission?.granted && isScanning && scanMode !== 'details' && focused;

  // Retry any queued cloud offloads when the app comes back to foreground.
  useOffloadQueue();

  // Refresh GPS in background. The first call fires immediately.
  useEffect(() => {
    let active = true;
    async function refresh() {
      const loc = await getQuickLocation();
      if (!active || !loc) return;
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      lastLocationRef.current = coords;
      setLastKnownLocation(coords);
    }
    refresh();
    const timer = setInterval(refresh, LOCATION_REFRESH_MS);
    return () => { active = false; clearInterval(timer); };
  }, [setLastKnownLocation]);

  const runScan = useCallback(async () => {
    if (isRunningRef.current || !cameraRef.current) return;
    isRunningRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.4,
        skipProcessing: true,
        base64: false,
      });
      if (!photo) return;
      // Pass cached GPS so the hub can anonymise and queue the scan for /heatmap.
      const result = await runInference(photo.uri, lastLocationRef.current ?? undefined);
      setLastFrameUri(photo.uri);
      setCurrentDetection({ result, timestamp: Date.now() });
    } catch (_) {
      // Silently skip failed frames
    } finally {
      isRunningRef.current = false;
    }
  }, [setCurrentDetection, setLastFrameUri]);

  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(runScan, INFERENCE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [scanning, runScan]);

  const disease = currentDetection ? getDisease(currentDetection.result.diseaseId) : null;
  const confidence = currentDetection?.result.confidence ?? 0;
  const spots = currentDetection?.result.spots ?? [];
  const { state: captureState, last: lastCapture, capture } = useManualCapture(cameraRef, isRunningRef);
  const { state: logState, plantName: loggedPlant, log } = useLogIssue(disease, confidence, `${disease?.id}-${activeBlock}`);

  function openDetails() {
    if (!disease) return;
    if (scanMode !== 'details') liveMode.current = scanMode;
    setScanMode('details');
    setDetent('medium');
  }

  function closeDetails() {
    setDetent('closed');
    setScanMode(liveMode.current);
  }

  function selectMode(mode: ScanMode) {
    if (mode === 'details') return openDetails();
    if (scanMode === 'details') setDetent('closed');
    setScanMode(mode);
  }

  // The camera recedes (iOS page-sheet style) as the sheet expands to full.
  const cameraStyle = useAnimatedStyle(() => {
    const e = interpolate(sheetPos.value, [1, 2], [0, 1], Extrapolation.CLAMP);
    return { borderRadius: 38 * e, transform: [{ scale: 1 - 0.07 * e }] };
  });
  const dimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetPos.value, [1, 2], [0, 0.45], Extrapolation.CLAMP),
  }));

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <ScreenTransition background={colors.black} statusBar="light">
        <View style={styles.permission}>
          <Leaf size={56} color="rgba(255,255,255,0.6)" />
          <Text style={styles.permissionTitle}>Scan your coffee leaves</Text>
          <Text style={styles.permissionBody}>agriOS needs the camera to spot rust, miners and other problems on your trees.</Text>
          <PressableScale onPress={requestPermission} style={styles.permissionButton} accessibilityRole="button">
            <Text style={styles.permissionButtonText}>Allow camera</Text>
          </PressableScale>
        </View>
      </ScreenTransition>
    );
  }

  return (
    <ScreenTransition background={colors.black} statusBar="light">
      {/* CONTENT LAYER: camera + AR annotations */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.cameraWrap, cameraStyle]}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch && focused}
          animateShutter={false}
          mute
        />
        <ARSpots spots={spots} visible={scanMode === 'ar'} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} pointerEvents="none" />

      {scanMode === 'camera' && <CameraGuides scanning={scanning} />}
      {scanMode === 'camera' && <CaptureButton state={captureState} last={lastCapture} onPress={capture} />}

      {/* CONTROL LAYER: Liquid Glass */}
      <ModeRail mode={scanMode} detailsEnabled={!!disease} onSelect={selectMode} />
      <DetectionAccessory
        mode={scanMode}
        disease={disease}
        confidence={confidence}
        logState={logState}
        onOpen={openDetails}
        onLog={log}
      />

      {/* Tapping the visible camera area dismisses the sheet. */}
      {detent !== 'closed' && (
        <Pressable style={StyleSheet.absoluteFill} onPress={closeDetails} accessibilityLabel="Back to scanner" />
      )}

      <ScanTopBar
        mode={scanMode}
        scanning={scanning}
        onBack={() => (scanMode === 'details' ? closeDetails() : setScanMode('ar'))}
      />

      <AdvisorySheet
        disease={disease}
        confidence={confidence}
        logState={logState}
        plantName={loggedPlant}
        onLog={log}
        detent={detent}
        onDetentChange={(d) => (d === 'closed' ? closeDetails() : setDetent(d))}
        pos={sheetPos}
      />
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  cameraWrap: { overflow: 'hidden', backgroundColor: colors.black },
  dim: { backgroundColor: colors.black },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  permissionTitle: { color: colors.onDark, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  permissionBody: { color: colors.onDarkSecondary, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  permissionButton: {
    marginTop: 8,
    height: 54,
    paddingHorizontal: 28,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionButtonText: { color: colors.white, fontSize: 17, fontWeight: '600' },
});
