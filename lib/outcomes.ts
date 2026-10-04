/**
 * Outcome learning — "did the treatment work?"
 *
 * On the phone: every treatment followed by a later scan of the same tree
 * (or block) becomes an outcome (success = healthier). Tallied per disease ×
 * action, these are the farm's own stats ("worked 3 of 4 times on your farm").
 *
 * With the hub: phones upload anonymous outcome events (disease, action,
 * success — no GPS, no photos) and download the regional tally across all
 * farms, cached for offline use. Suggestions quote both. This is counting,
 * not model training: transparent, and it improves as outcomes accumulate.
 */

import { File, Paths } from 'expo-file-system';
import { ActionRecord, getAllActions, getAllIssues, IssueRecord, markActionsSynced } from './db';
import { aggregateOutcomes, computeOutcomes, OutcomeStats } from './insights';
import { LOCAL_SERVER_URL } from './config';
import { loadSettings, saveSettings } from './settings';

const statsFile = () => new File(Paths.document, 'outcome-stats.json');

export interface RegionalStats {
  stats: OutcomeStats;
  farms: number;
  updatedAt: number;
}

export function localOutcomeStats(scans: IssueRecord[], actions: ActionRecord[]): OutcomeStats {
  return aggregateOutcomes(computeOutcomes(scans, actions));
}

export async function loadRegionalStats(): Promise<RegionalStats | null> {
  try {
    const file = statsFile();
    return file.exists ? JSON.parse(await file.text()) : null;
  } catch {
    return null;
  }
}

function saveRegionalStats(stats: RegionalStats) {
  try {
    const file = statsFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(stats));
  } catch {}
}

async function hubFetch(path: string, init?: RequestInit, timeoutMs = 6000): Promise<Response | null> {
  if (!LOCAL_SERVER_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${LOCAL_SERVER_URL}${path}`, { ...init, signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Anonymous random id for this install (created once). */
async function farmId(): Promise<string> {
  const settings = await loadSettings();
  if (settings.farmId) return settings.farmId;
  const id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  await saveSettings({ farmId: id });
  return id;
}

/**
 * Uploads this farm's new outcome events and refreshes the regional tally.
 * Silent no-op without a hub. Returns the latest regional stats (cached or new).
 */
export async function syncOutcomes(): Promise<RegionalStats | null> {
  if (!LOCAL_SERVER_URL) return loadRegionalStats();
  try {
    const [scans, actions] = await Promise.all([getAllIssues(), getAllActions()]);
    const userScans = scans.filter((s) => s.source !== 'seed');
    const pending = actions.filter((a) => a.source !== 'seed' && !a.synced);
    const events = computeOutcomes(userScans, pending);
    if (events.length) {
      const res = await hubFetch('/outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farm: await farmId(), events: events.map(({ diseaseId, type, success }) => ({ diseaseId, type, success })) }),
      });
      if (res) await markActionsSynced(events.map((e) => e.actionId));
    }
    const res = await hubFetch('/outcome-stats');
    if (res) {
      const data = (await res.json()) as { stats?: OutcomeStats; farms?: number };
      const stats: RegionalStats = { stats: data.stats ?? {}, farms: data.farms ?? 0, updatedAt: Date.now() };
      saveRegionalStats(stats);
      return stats;
    }
  } catch {}
  return loadRegionalStats();
}

/** Optional hub LLM summary of a tree's history (explains the numbers; never decides). */
export async function fetchHistorySummary(payload: {
  subject: string;
  health: string;
  trend: string;
  recurring: string[];
  recentScans: { date: string; result: string }[];
  actions: { date: string; action: string }[];
  soilPh?: number;
}): Promise<string | null> {
  const res = await hubFetch(
    '/history-summary',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    35_000,
  );
  if (!res) return null;
  try {
    const data = (await res.json()) as { summary?: string };
    return data.summary?.trim() || null;
  } catch {
    return null;
  }
}
