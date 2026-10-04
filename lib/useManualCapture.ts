import { RefObject, useCallback, useRef, useState } from 'react';
import type { CameraView } from 'expo-camera';
import { logIssue } from './db';
import { getDisease, runInference } from './inference';
import { getQuickLocation } from './location';
import { persistScanPhoto, prunePhotos } from './photos';
import { useShambaStore } from './store';

export type CaptureState = 'idle' | 'busy' | 'saved' | 'failed';

export interface CaptureResult {
  diseaseName: string;
  severity: string;
  block: string;
}

/**
 * Manual capture: takes a full-quality photo, classifies it, and logs it
 * straight to the scanned list (SQLite + store) with photo, GPS and block.
 * `busyRef` is shared with the auto-scan loop so the two never overlap.
 */
export function useManualCapture(cameraRef: RefObject<CameraView | null>, busyRef: { current: boolean }) {
  const setCurrentDetection = useShambaStore((s) => s.setCurrentDetection);
  const addIssue = useShambaStore((s) => s.addIssue);
  const activeBlock = useShambaStore((s) => s.activeBlock);
  const [state, setState] = useState<CaptureState>('idle');
  const [last, setLast] = useState<CaptureResult | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const capture = useCallback(async () => {
    if (state === 'busy' || !cameraRef.current) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState('busy');

    // Let an in-flight auto-scan frame finish (max ~1.5 s) before taking over the camera.
    for (let i = 0; busyRef.current && i < 15; i++) await new Promise((r) => setTimeout(r, 100));
    busyRef.current = true;

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (!photo) throw new Error('No photo');

      const [result, loc, photoUri] = await Promise.all([
        runInference(photo.uri),
        getQuickLocation(),
        persistScanPhoto(photo.uri),
      ]);
      setCurrentDetection({ result, timestamp: Date.now() });

      const disease = getDisease(result.diseaseId);
      const lat = loc?.coords.latitude ?? 0;
      const lng = loc?.coords.longitude ?? 0;
      const record = {
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence: result.confidence,
        lat,
        lng,
        photoUri,
        timestamp: Date.now(),
        notes: null,
        block: activeBlock,
        plantId: null,
        source: 'user' as const,
      };
      const id = await logIssue(record);
      addIssue({ id, ...record });

      setLast({ diseaseName: disease.name, severity: disease.severity, block: activeBlock });
      setState('saved');
      const store = useShambaStore.getState();
      store.bumpData();
      store.setPendingTag({ issueId: id, block: activeBlock, lat, lng, diseaseName: disease.name });
      prunePhotos();
    } catch {
      setState('failed');
    } finally {
      busyRef.current = false;
      resetTimer.current = setTimeout(() => setState('idle'), 2200);
    }
  }, [state, cameraRef, busyRef, setCurrentDetection, addIssue, activeBlock]);

  return { state, last, capture };
}
