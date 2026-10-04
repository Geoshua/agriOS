import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getPendingOffloads, resolveOffload } from './db';
import { runCloudOffload } from './inference';

/**
 * Background hook that retries pending cloud offloads when the app becomes active.
 * Mount once in scan.tsx (or _layout.tsx). Failures are silent — the row stays
 * in the queue and will be retried next time the app foregrounds.
 */
export function useOffloadQueue() {
  useEffect(() => {
    let processing = false;

    async function processQueue() {
      if (processing) return;
      processing = true;
      try {
        const pending = await getPendingOffloads();
        for (const item of pending) {
          const result = await runCloudOffload(item.framePath);
          if (result) await resolveOffload(item.id);
          // If runCloudOffload returns null (hub still unreachable), leave in queue.
        }
      } catch {
        // Network error — will retry on next foreground
      } finally {
        processing = false;
      }
    }

    // Try immediately on mount (covers app-open and tab-switch cases).
    processQueue();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') processQueue();
    });

    return () => sub.remove();
  }, []);
}
