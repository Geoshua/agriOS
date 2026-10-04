/**
 * Loads the to-do list (own tasks + watering due + insight suggestions) from
 * SQLite, offline, and the actions behind each button (complete / snooze /
 * delete, each with an undo). Reloads whenever store.dataVersion changes.
 */

import { useEffect, useState } from 'react';
import {
  ActionRecord,
  addTask,
  deleteAction,
  deleteTask,
  deleteTaskMark,
  getAllActions,
  getAllIssues,
  getAllPlants,
  getTaskMarks,
  getTasks,
  getWateringPlans,
  logAction,
  PlantRecord,
  setTaskMark,
  TaskRecord,
  updateTask,
} from '../../lib/db';
import { computeInsight, SoilInput } from '../../lib/insights';
import {
  actionForSuggestion,
  buildTaskList,
  completeTask,
  deriveSuggestionTasks,
  deriveWateringTasks,
  doneMark,
  snoozeDueAt,
  snoozeMark,
  SUGGESTION_DISEASE,
  SuggestionSubject,
  TaskItem,
  TaskList,
  WaterTaskSubject,
} from '../../lib/tasks';
import { planFor, ResolvedPlan, WaterSubject, wateringActionsFor, wateringStatus, WateringStatus, startOfDay } from '../../lib/watering';
import { plantLabel } from '../../lib/plants';
import { fetchSoilData } from '../../lib/soil';
import { blockCenter } from '../../lib/useSubjectInsight';
import { FIELD_BLOCKS, useShambaStore } from '../../lib/store';

const DAY = 86_400_000;

export interface WateringRow {
  subject: WaterSubject;
  label: string;
  status: WateringStatus;
  plan: ResolvedPlan;
}

export interface TasksData {
  now: number;
  list: TaskList;
  watering: WateringRow[];
  plants: PlantRecord[];
  custom: TaskRecord[];
}

/** "Tree 7", "Block A", or "Farm". */
export function subjectLabel(item: { plantId: number | null; block: string | null }, plants: PlantRecord[]): string {
  if (item.plantId != null) {
    const p = plants.find((x) => x.id === item.plantId);
    return p ? plantLabel(p) : 'Tree';
  }
  return item.block ? `Block ${item.block}` : 'Farm';
}

// Soil per block barely changes — look it up once per session (bundled grid first, offline).
const soilCache = new Map<string, Promise<SoilInput | null>>();
function blockSoil(block: string, scans: Parameters<typeof blockCenter>[1]): Promise<SoilInput | null> {
  if (!soilCache.has(block)) {
    const pt = blockCenter(block, scans);
    soilCache.set(
      block,
      pt
        ? fetchSoilData(pt.lat, pt.lng)
            .then((s) => (s ? { ph: s.ph, nitrogen: s.nitrogen } : null))
            .catch(() => null)
        : Promise.resolve(null),
    );
  }
  return soilCache.get(block)!;
}

export async function loadTasks(now = Date.now()): Promise<TasksData> {
  const [actions, plants, issues, plans, custom, marks] = await Promise.all([
    getAllActions(),
    getAllPlants(),
    getAllIssues(),
    getWateringPlans(),
    getTasks(),
    getTaskMarks(now),
  ]);
  const scans = [...issues].sort((a, b) => a.timestamp - b.timestamp);
  const blocks = [...new Set<string>([...FIELD_BLOCKS, ...plants.map((p) => p.block).filter((b): b is string => !!b)])].sort();

  // Watering: every block, plus trees with their own plan.
  const watering: WateringRow[] = [];
  const waterSubjects: WaterTaskSubject[] = [];
  const addWater = (subject: WaterSubject, label: string) => {
    const plan = planFor(subject, plans);
    const status = wateringStatus({ everyDays: plan.everyDays, actions: wateringActionsFor(subject, actions), now });
    watering.push({ subject, label, status, plan });
    waterSubjects.push({ kind: subject.kind, plantId: subject.kind === 'plant' ? subject.id : null, block: subject.block, status });
  };
  for (const b of blocks) addWater({ kind: 'block', block: b }, `Block ${b}`);
  for (const p of plants) {
    if (plans.some((x) => x.subjectType === 'plant' && x.subjectId === String(p.id))) addWater({ kind: 'plant', id: p.id, block: p.block }, plantLabel(p));
  }

  // Suggestions for each block and each tagged tree.
  const soils = await Promise.all(blocks.map((b) => blockSoil(b, scans)));
  const sugSubjects: SuggestionSubject[] = [];
  blocks.forEach((b, i) => {
    const insight = computeInsight({
      scans: scans.filter((s) => s.block === b),
      actions: actions.filter((a) => a.block === b),
      blockScans: scans.filter((s) => s.block === b),
      kind: 'block',
      soil: soils[i],
      now,
    });
    sugSubjects.push({ kind: 'block', plantId: null, block: b, suggestions: insight.suggestions });
  });
  for (const p of plants) {
    const insight = computeInsight({
      scans: scans.filter((s) => s.plantId === p.id),
      actions: actions.filter((a) => a.plantId === p.id),
      blockScans: p.block ? scans.filter((s) => s.block === p.block) : [],
      plantId: p.id,
      kind: 'plant',
      now,
    });
    sugSubjects.push({ kind: 'plant', plantId: p.id, block: p.block, suggestions: insight.suggestions });
  }

  const derived = [...deriveWateringTasks(waterSubjects, now), ...deriveSuggestionTasks(sugSubjects, now)];
  const list = buildTaskList({ custom, derived, marks, now, extraDone: recentWaterings(actions, now) });
  return { now, list, watering, plants, custom };
}

/** Last week's watering / rain as Done items (one per place per day). */
function recentWaterings(actions: ActionRecord[], now: number): TaskItem[] {
  const seen = new Set<string>();
  const out: TaskItem[] = [];
  for (const a of [...actions].reverse()) {
    if ((a.type !== 'watered' && a.type !== 'rained') || now - a.timestamp > 7 * DAY) continue;
    const k = `${a.type}:${a.plantId ?? ''}:${a.block ?? ''}:${startOfDay(a.timestamp)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      key: `act:${a.id}`,
      kind: 'water',
      title: a.type === 'rained' ? 'It rained' : 'Watered',
      icon: a.type,
      plantId: a.plantId,
      block: a.block,
      dueAt: a.timestamp,
      doneAt: Math.min(a.timestamp, now),
    });
  }
  return out;
}

export function useTasks() {
  const dataVersion = useShambaStore((s) => s.dataVersion);
  const [data, setData] = useState<TasksData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadTasks()
      .then((d) => !cancelled && setData(d))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  return { data, loading };
}

// ── Mutations (each returns an undo) ──────────────────────────────────────────

export type Undo = () => Promise<void>;
const bump = () => useShambaStore.getState().bumpData();

/** The farmer says she did it. Logs the matching action where there is one. */
export async function completeItem(item: TaskItem, now = Date.now()): Promise<Undo> {
  if (item.kind === 'custom' && item.taskId != null) {
    const id = item.taskId;
    const before = (await getTasks()).find((t) => t.id === id);
    if (!before) return async () => {};
    await updateTask(id, completeTask(before, now));
    bump();
    return async () => {
      await updateTask(id, { dueAt: before.dueAt, doneAt: before.doneAt, lastDoneAt: before.lastDoneAt });
      bump();
    };
  }

  if (item.kind === 'water') {
    const actionId = await logAction({ type: 'watered', plantId: item.plantId, block: item.block, issueId: null, diseaseId: null, timestamp: now, source: 'user', synced: false });
    bump();
    return async () => {
      await deleteAction(actionId);
      bump();
    };
  }

  const type = item.suggestionId ? actionForSuggestion(item.suggestionId) : null;
  const actionId = type
    ? await logAction({
        type,
        plantId: item.plantId,
        block: item.block,
        issueId: null,
        diseaseId: (item.suggestionId && SUGGESTION_DISEASE[item.suggestionId]) || null,
        timestamp: now,
        source: 'user',
        synced: false,
      })
    : null;
  await setTaskMark(doneMark(item, now, actionId));
  bump();
  return async () => {
    await deleteTaskMark(item.key);
    if (actionId != null) await deleteAction(actionId);
    bump();
  };
}

/** Not today — back tomorrow (own tasks move their due date by a day). */
export async function snoozeItem(item: TaskItem, now = Date.now()): Promise<Undo> {
  if (item.kind === 'custom' && item.taskId != null) {
    const id = item.taskId;
    const prev = item.dueAt;
    await updateTask(id, { dueAt: snoozeDueAt(item.dueAt, now) });
    bump();
    return async () => {
      await updateTask(id, { dueAt: prev });
      bump();
    };
  }
  await setTaskMark(snoozeMark(item, now));
  bump();
  return async () => {
    await deleteTaskMark(item.key);
    bump();
  };
}

/** Deletes one of the farmer's own tasks (derived tasks can only be snoozed). */
export async function deleteItem(item: TaskItem): Promise<Undo> {
  if (item.kind !== 'custom' || item.taskId == null) return async () => {};
  const before = (await getTasks()).find((t) => t.id === item.taskId);
  await deleteTask(item.taskId);
  bump();
  return async () => {
    if (before) await addTask({ title: before.title, plantId: before.plantId, block: before.block, dueAt: before.dueAt, repeatDays: before.repeatDays, notes: before.notes, createdAt: before.createdAt });
    bump();
  };
}

export async function createTask(input: { title: string; plantId: number | null; block: string | null; dueAt: number; repeatDays: number | null }): Promise<void> {
  await addTask({ ...input, notes: null });
  bump();
}
