import { useCallback, useEffect, useState } from 'react';
import { logIssue } from './db';
import { getQuickLocation } from './location';
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

  useEffect(() => setState('idle'), [resetKey]);

  /** Logs the detection; `notes` is the farmer's spoken/typed observation, if any. */
  const log = useCallback(async (notes?: string) => {
    if (!disease || state !== 'idle') return;
    setState('saving');
    try {
      const loc = await getQuickLocation();

      const record = {
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence,
        lat: loc?.coords.latitude ?? 0,
        lng: loc?.coords.longitude ?? 0,
        photoUri: null,
        timestamp: Date.now(),
        notes: notes?.trim() || null,
        block: activeBlock,
      };
      const id = await logIssue(record);
      addIssue({ id, ...record });
      setState('saved');
    } catch {
      setState('idle');
    }
  }, [disease, confidence, state, addIssue, activeBlock]);

  return { state, log };
}
