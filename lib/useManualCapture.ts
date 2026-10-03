import { RefObject, useCallback, useRef, useState } from 'react';
import type { CameraView } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { logIssue } from './db';
import { getDisease, runInference } from './inference';
import { getQuickLocation } from './location';
import { useShambaStore } from './store';

export type CaptureState = 'idle' | 'busy' | 'saved' | 'failed';

export interface CaptureResult {
  diseaseName: string;
  severity: string;
  block: string;
}

/** Copies a camera capture out of the cache so the logged photo survives. */
async function persistPhoto(uri: string): Promise<string> {
  try {
    const dir = new Directory(Paths.document, 'scans');
    if (!dir.exists) dir.create();
    const dest = new File(dir, `scan-${Date.now()}.jpg`);
    await new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/**
 * Manual capture: takes a full-quality photo, classifies it, and logs it
 * straight to the scanned list (SQLite + store) with photo, GPS and block.
 * `busyRef` is shared with the auto-scan loop so the two never overlap.
 */
export function useManualCapture(cameraRef: RefObject<CameraView | null>, busyRef: { current: boolean }) {
  const { setCurrentDetection, addIssue, activeBlock } = useShambaStore();
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
        persistPhoto(photo.uri),
      ]);
      setCurrentDetection({ result, timestamp: Date.now() });

      const disease = getDisease(result.diseaseId);
      const record = {
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence: result.confidence,
        lat: loc?.coords.latitude ?? 0,
        lng: loc?.coords.longitude ?? 0,
        photoUri,
        timestamp: Date.now(),
        notes: null,
        block: activeBlock,
      };
      const id = await logIssue(record);
      addIssue({ id, ...record });

      setLast({ diseaseName: disease.name, severity: disease.severity, block: activeBlock });
      setState('saved');
    } catch {
      setState('failed');
    } finally {
      busyRef.current = false;
      resetTimer.current = setTimeout(() => setState('idle'), 2200);
    }
  }, [state, cameraRef, busyRef, setCurrentDetection, addIssue, activeBlock]);

  return { state, last, capture };
}
