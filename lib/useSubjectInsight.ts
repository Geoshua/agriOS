/**
 * Loads everything a tree's or block's report needs from SQLite (offline),
 * plus soil and outcome stats, and runs the insight engine. Reloads whenever
 * scans, trees or actions change (store.dataVersion).
 *
 * Offline-first: the report renders from local data immediately (soil from the
 * bundled grid / phone cache only); a network soil lookup — if still needed —
 * runs afterwards and refines the report when it arrives.
 */

import { useEffect, useState } from 'react';
import { ActionRecord, getAllActions, getAllIssues, getAllPlants, IssueRecord, PlantRecord } from './db';
import { computeInsight, Insight, OutcomeStats } from './insights';
import { loadRegionalStats, localOutcomeStats, RegionalStats } from './outcomes';
import { fetchSoilData, SoilProfile } from './soil';
import { useShambaStore } from './store';
import { DEMO_FARM, DEMO_MODE } from './config';
import { BLOCK_LAYOUT, offsetToLatLng } from './demoFarm';

export type Subject = { kind: 'plant'; id: number } | { kind: 'block'; block: string };

export interface TreeSummary {
  plant: PlantRecord;
  insight: Insight;
}

export interface SubjectData {
  subject: Subject;
  title: string;
  plant: PlantRecord | null;
  scans: IssueRecord[];
  actions: ActionRecord[];
  trees: PlantRecord[];
  /** Health of each tagged tree in the subject (for a block: all its trees). */
  treeSummaries: TreeSummary[];
  insight: Insight;
  soil: SoilProfile | null;
  /** True when soil may still arrive from the network. */
  soilPending: boolean;
  localStats: OutcomeStats;
  regional: RegionalStats | null;
}

/** A representative point for a block: mean of its GPS scans, else the demo layout. */
export function blockCenter(block: string, scans: IssueRecord[]): { lat: number; lng: number } | null {
  const pts = scans.filter((s) => s.block === block && s.lat !== 0);
  if (pts.length) return { lat: pts.reduce((a, s) => a + s.lat, 0) / pts.length, lng: pts.reduce((a, s) => a + s.lng, 0) / pts.length };
  const layout = BLOCK_LAYOUT[block];
  return DEMO_MODE && layout ? offsetToLatLng(DEMO_FARM, layout.east, layout.north) : null;
}

/** `soil: 'offline'` never waits on the network; `'full'` may (hub, then SoilGrids). */
export async function loadSubject(subject: Subject, opts: { soil?: 'offline' | 'full' } = {}): Promise<SubjectData | null> {
  const [allScans, allActions, plants, regional] = await Promise.all([getAllIssues(), getAllActions(), getAllPlants(), loadRegionalStats()]);
  const chrono = [...allScans].sort((a, b) => a.timestamp - b.timestamp);

  let plant: PlantRecord | null = null;
  let scans: IssueRecord[];
  let actions: ActionRecord[];
  let block: string | null;
  let title: string;
  let point: { lat: number; lng: number } | null;

  if (subject.kind === 'plant') {
    plant = plants.find((p) => p.id === subject.id) ?? null;
    if (!plant) return null;
    scans = chrono.filter((s) => s.plantId === plant!.id);
    actions = allActions.filter((a) => a.plantId === plant!.id);
    block = plant.block;
    title = plant.tag != null ? `Tree ${plant.tag}` : plant.name;
    point = { lat: plant.lat, lng: plant.lng };
  } else {
    block = subject.block;
    scans = chrono.filter((s) => s.block === block);
    actions = allActions.filter((a) => a.block === block);
    title = `Block ${block}`;
    point = blockCenter(block, chrono);
  }

  const soil = point ? await fetchSoilData(point.lat, point.lng, { offlineOnly: opts.soil !== 'full' }).catch(() => null) : null;
  const localStats = localOutcomeStats(chrono, allActions);
  const soilInput = soil ? { ph: soil.ph, nitrogen: soil.nitrogen } : null;
  const insight = computeInsight({
    scans,
    actions,
    // Neighbours: same block for a tree; the other blocks for a block.
    blockScans: subject.kind === 'block' ? chrono.filter((s) => s.block !== block) : block ? chrono.filter((s) => s.block === block) : [],
    plantId: plant?.id ?? null,
    kind: subject.kind,
    soil: soilInput,
    localStats,
    regionalStats: regional?.stats,
  });
  const trees = plants.filter((p) => (subject.kind === 'block' ? p.block === block : p.id === plant?.id));
  // Per-tree health from the arrays already in memory — no extra reads.
  const treeSummaries = trees.map((t) => ({
    plant: t,
    insight: computeInsight({
      scans: chrono.filter((s) => s.plantId === t.id),
      actions: allActions.filter((a) => a.plantId === t.id),
      blockScans: chrono.filter((s) => s.block === t.block),
      plantId: t.id,
      soil: soilInput,
      localStats,
      regionalStats: regional?.stats,
    }),
  }));
  return {
    subject,
    title,
    plant,
    scans,
    actions,
    trees,
    treeSummaries,
    insight,
    soil,
    soilPending: !soil && !!point && opts.soil !== 'full',
    localStats,
    regional,
  };
}

export function useSubjectInsight(subject: Subject | null) {
  const dataVersion = useShambaStore((s) => s.dataVersion);
  const [data, setData] = useState<SubjectData | null>(null);
  const [loading, setLoading] = useState(!!subject);
  const [error, setError] = useState(false);
  const key = subject ? (subject.kind === 'plant' ? `p${subject.id}` : `b${subject.block}`) : '';

  // A different subject: never show the previous one's report.
  useEffect(() => {
    setData(null);
    setError(false);
    setLoading(!!subject);
  }, [key]);

  useEffect(() => {
    if (!subject) return;
    let cancelled = false;
    (async () => {
      try {
        const offline = await loadSubject(subject, { soil: 'offline' });
        if (cancelled) return;
        setData(offline);
        setError(false);
        setLoading(false);
        if (offline?.soilPending) {
          const full = await loadSubject(subject, { soil: 'full' });
          if (!cancelled && full?.soil) setData(full);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, dataVersion]);

  return { data, loading, error };
}
