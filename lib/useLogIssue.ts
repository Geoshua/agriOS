import { useCallback, useEffect, useState } from 'react';
import { logIssue } from './db';
import { getQuickLocation } from './location';
import { assignPlant } from './plants';
import { useShambaStore } from './store';

export type LogState = 'idle' | 'saving' | 'saved';

/**
 * Logs the given disease detection (with GPS when permitted) to SQLite and the
 * in-memory store. State resets whenever `resetKey` changes, e.g. a new detection.
 */
export function useLogIssue(disease: any | null, confidence: number, resetKey: unknown) {
  const addIssue = useShambaStore((s) => s.addIssue);
  const activeBlock = useShambaStore((s) => s.activeBlock);
  const [state, setState] = useState<LogState>('idle');
  /** Tracked plant the last log was grouped with (by GPS), if any. */
  const [plantName, setPlantName] = useState<string | null>(null);

  useEffect(() => {
    setState('idle');
    setPlantName(null);
  }, [resetKey]);

  /** Logs the detection; `notes` is the farmer's spoken/typed observation, if any. */
  const log = useCallback(async (notes?: string) => {
    if (!disease || state !== 'idle') return;
    setState('saving');
    try {
      const loc = await getQuickLocation();
      const lat = loc?.coords.latitude ?? 0;
      const lng = loc?.coords.longitude ?? 0;
      const plant = await assignPlant(lat, lng);

      const record = {
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence,
        lat,
        lng,
        photoUri: null,
        timestamp: Date.now(),
        notes: notes?.trim() || null,
        block: activeBlock,
        plantId: plant.plantId,
      };
      const id = await logIssue(record);
      addIssue({ id, ...record });
      setPlantName(plant.plantName);
      setState('saved');
    } catch {
      setState('idle');
    }
  }, [disease, confidence, state, addIssue, activeBlock]);

  return { state, plantName, log };
}
