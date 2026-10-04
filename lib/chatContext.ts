/**
 * Builds the "Ask" assistant's ChatContext (lib/chat.ts) from what is on the
 * phone: SQLite (scans, trees, actions, to-dos, watering), diseases.json and
 * the bundled soil map. Never touches the network.
 */

import diseaseData from '../assets/diseases.json';
import { getAllActions, getAllIssues, getAllPlants } from './db';
import { aggregateOutcomes, computeInsight, computeOutcomes } from './insights';
import { plantLabel } from './plants';
import { fetchSoilData, getSoilAdvisory, SOIL_SOURCE_LABEL } from './soil';
import { dueLabel } from './tasks';
import { agoWord, dueWord } from './watering';
import { DEMO_FARM, DEMO_MODE } from './config';
import { FIELD_BLOCKS, useShambaStore } from './store';
import { loadTasks, subjectLabel } from '../components/tasks/useTasks';
import type { ChatContext, ChatSoil, DiseaseInfo, SubjectSummary } from './chat';

export async function loadChatContext(now = Date.now()): Promise<ChatContext> {
  const [allScans, actions, plants, tasks] = await Promise.all([getAllIssues(), getAllActions(), getAllPlants(), loadTasks(now).catch(() => null)]);
  const scans = [...allScans].sort((a, b) => a.timestamp - b.timestamp);
  const scansIn = (block: string | null) => (block ? scans.filter((s) => s.block === block) : []);

  const blocks: SubjectSummary[] = FIELD_BLOCKS.map((block) => {
    const insight = computeInsight({ kind: 'block', scans: scansIn(block), actions: actions.filter((a) => a.block === block), blockScans: scansIn(block), now });
    return { label: `Block ${block}`, plantId: null, block, tag: null, level: insight.health.level, next: insight.suggestions[0] ?? null, lastScan: insight.lastScan };
  });

  const trees: SubjectSummary[] = plants.map((plant) => {
    const insight = computeInsight({
      scans: scans.filter((s) => s.plantId === plant.id),
      actions: actions.filter((a) => a.plantId === plant.id),
      blockScans: scansIn(plant.block),
      plantId: plant.id,
      now,
    });
    return { label: plantLabel(plant), plantId: plant.id, block: plant.block, tag: plant.tag, level: insight.health.level, next: insight.suggestions[0] ?? null, lastScan: insight.lastScan };
  });
  const rank = { sick: 0, watch: 1, good: 2, unknown: 3 } as const;
  trees.sort((a, b) => rank[a.level] - rank[b.level]);

  return {
    now,
    diseases: diseaseData.diseases as unknown as Record<string, DiseaseInfo>,
    scans,
    blocks,
    trees,
    tasks: (tasks?.list.open ?? []).map((t) => {
      const when = dueLabel(t.dueAt, now);
      return { title: t.title, where: subjectLabel(t, plants), when, overdue: when.startsWith('Overdue'), dueToday: when === 'Today' };
    }),
    watering: (tasks?.watering ?? []).map((w) => ({
      label: w.label,
      due: dueWord(w.status),
      last: agoWord(w.status.daysSinceLast),
      dueToday: w.status.dueToday,
      everyDays: w.status.everyDays,
    })),
    soil: await localSoil(scans),
    outcomes: aggregateOutcomes(computeOutcomes(scans, actions)),
  };
}

/** Soil for the farm from the bundled grid or the phone's cache — offline only. */
async function localSoil(scans: { lat: number; lng: number }[]): Promise<ChatSoil | null> {
  const known = useShambaStore.getState().lastKnownLocation;
  const located = [...scans].reverse().find((s) => s.lat !== 0);
  const at = DEMO_MODE ? DEMO_FARM : known ?? located ?? null;
  if (!at) return null;
  const profile = await fetchSoilData(at.lat, at.lng, { offlineOnly: true }).catch(() => null);
  if (!profile) return null;
  const advice = getSoilAdvisory(profile);
  return { ph: profile.ph, nitrogen: profile.nitrogen, phAdvice: advice.phAdvice, generalAdvice: advice.generalAdvice, source: SOIL_SOURCE_LABEL[profile.source] };
}
