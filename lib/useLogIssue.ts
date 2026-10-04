import { useCallback, useEffect, useState } from 'react';
import { logIssue } from './db';
import { getQuickLocation } from './location';
import { persistScanPhoto, prunePhotos } from './photos';
import { useShambaStore } from './store';

export type LogState = 'idle' | 'saving' | 'saved';

/**
 * Logs the current detection: saves the camera frame behind the result,
 * stores the scan in the active block (untagged), then opens the optional
 * "Tag to a tree?" prompt. State resets whenever `resetKey` changes.
 */
export function useLogIssue(disease: any | null, confidence: number, resetKey: unknown) {
  const addIssue = useShambaStore((s) => s.addIssue);
  const activeBlock = useShambaStore((s) => s.activeBlock);
  const pendingTag = useShambaStore((s) => s.pendingTag);
  const [state, setState] = useState<LogState>('idle');
  const [issueId, setIssueId] = useState<number | null>(null);

  const [taggedAs, setTaggedAs] = useState<string | null>(null);

  useEffect(() => {
    setState('idle');
    setIssueId(null);
    setTaggedAs(null);
  }, [resetKey]);

  // Remember the tree chosen in the tag prompt (the prompt itself closes soon after).
  useEffect(() => {
    if (issueId != null && pendingTag?.issueId === issueId && pendingTag.taggedAs !== undefined) setTaggedAs(pendingTag.taggedAs ?? null);
  }, [pendingTag, issueId]);

  /** Logs the detection; `notes` is the farmer's spoken/typed observation, if any. */
  const log = useCallback(async (notes?: string) => {
    if (!disease || state !== 'idle') return;
    setState('saving');
    try {
      const frame = useShambaStore.getState().lastFrameUri;
      const [loc, photoUri] = await Promise.all([
        getQuickLocation(),
        frame ? persistScanPhoto(frame) : Promise.resolve(null),
      ]);
      const lat = loc?.coords.latitude ?? 0;
      const lng = loc?.coords.longitude ?? 0;

      const record = {
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence,
        lat,
        lng,
        photoUri,
        timestamp: Date.now(),
        notes: notes?.trim() || null,
        block: activeBlock,
        plantId: null,
        source: 'user' as const,
      };
      const id = await logIssue(record);
      addIssue({ id, ...record });
      setIssueId(id);
      setState('saved');
      const store = useShambaStore.getState();
      store.bumpData();
      store.setPendingTag({ issueId: id, block: activeBlock, lat, lng, diseaseName: disease.name });
      prunePhotos();
    } catch {
      setState('idle');
    }
  }, [disease, confidence, state, addIssue, activeBlock]);

  return { state, issueId, plantName: taggedAs, log };
}
