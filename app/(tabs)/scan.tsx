import React, { useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useShambaStore } from '../../lib/store';
import { runInference, getDisease } from '../../lib/inference';
import AdvisorySheet from '../../components/AdvisorySheet';

const INFERENCE_INTERVAL_MS = 1200;

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunningRef = useRef(false);

  const { currentDetection, setCurrentDetection, advisoryOpen, setAdvisoryOpen, isScanning } = useShambaStore();

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
      const result = await runInference(photo.uri);
      setCurrentDetection({ result, timestamp: Date.now() });
    } catch (_) {
      // Silently skip failed frames
    } finally {
      isRunningRef.current = false;
    }
  }, [setCurrentDetection]);

  useEffect(() => {
    if (!permission?.granted || !isScanning || advisoryOpen) return;
    intervalRef.current = setInterval(runScan, INFERENCE_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [permission?.granted, isScanning, advisoryOpen, runScan]);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera access needed to scan crops</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const disease = currentDetection ? getDisease(currentDetection.result.diseaseId) : null;
  const confidence = currentDetection?.result.confidence ?? 0;

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        {/* Detection overlay */}
        {disease && (
          <TouchableOpacity
            style={[styles.detectionBadge, { backgroundColor: disease.color + 'EE' }]}
            onPress={() => setAdvisoryOpen(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.detectionName}>{disease.name}</Text>
            <Text style={styles.detectionConfidence}>
              {Math.round(confidence * 100)}% — tap for advice
            </Text>
          </TouchableOpacity>
        )}

        {/* Scanning indicator */}
        <View style={styles.scanningIndicator}>
          <View style={styles.scanningDot} />
          <Text style={styles.scanningText}>
            {currentDetection?.result.isMock ? 'MOCK MODE' : 'Scanning...'}
          </Text>
        </View>

        {/* Corner frame guides */}
        <View style={styles.frameTopLeft} />
        <View style={styles.frameTopRight} />
        <View style={styles.frameBottomLeft} />
        <View style={styles.frameBottomRight} />
      </CameraView>

      <AdvisorySheet
        disease={disease}
        confidence={confidence}
        open={advisoryOpen}
        onClose={() => setAdvisoryOpen(false)}
      />
    </View>
  );
}

const CORNER = 28;
const BORDER = 3;
const COLOR = 'rgba(255,255,255,0.8)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#F9FAF9' },
  permissionText: { fontSize: 16, color: '#374151', textAlign: 'center', marginBottom: 20 },
  permissionButton: { backgroundColor: '#2D6A4F', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
  permissionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  detectionBadge: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  detectionName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  detectionConfidence: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 4 },
  scanningIndicator: {
    position: 'absolute',
    top: 60,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  scanningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80', marginRight: 6 },
  scanningText: { color: '#fff', fontSize: 12 },
  frameTopLeft: { position: 'absolute', top: 120, left: 40, width: CORNER, height: CORNER, borderTopWidth: BORDER, borderLeftWidth: BORDER, borderColor: COLOR },
  frameTopRight: { position: 'absolute', top: 120, right: 40, width: CORNER, height: CORNER, borderTopWidth: BORDER, borderRightWidth: BORDER, borderColor: COLOR },
  frameBottomLeft: { position: 'absolute', bottom: 180, left: 40, width: CORNER, height: CORNER, borderBottomWidth: BORDER, borderLeftWidth: BORDER, borderColor: COLOR },
  frameBottomRight: { position: 'absolute', bottom: 180, right: 40, width: CORNER, height: CORNER, borderBottomWidth: BORDER, borderRightWidth: BORDER, borderColor: COLOR },
});
