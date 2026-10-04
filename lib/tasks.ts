/**
 * To-do list — the farmer's own tasks plus tasks *derived* from her data
 * (watering due, "Do this next" suggestions from the insight engine), merged
 * into Overdue / Today / This week / Later / Done.
 *
 * Pure and deterministic (only `import type`), unit-tested in
 * tests/tasks.test.ts. Storage: lib/db.ts (tasks, task_marks). Derived tasks
 * are recomputed every time; only their snooze / "handled" marks are stored.
 *
 * Human in the loop (CLAUDE.md rule 4): completing a task only records what
 * the farmer says she did — the app never acts for her.
 */

import type { ActionType, TaskMark, TaskRecord } from './db';
import type { Suggestion } from './insights';
import type { WateringStatus } from './watering';

const DAY = 86_400_000;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const addDays = (t: number, n: number) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
const dayDiff = (a: number, b: number) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

// ── Model ─────────────────────────────────────────────────────────────────────

export type TaskKind = 'custom' | 'water' | 'suggestion';
/** Glyph for a task row: an action icon, or a generic one. */
export type TaskIcon = ActionType | 'task' | 'scan' | 'officer' | 'eye';

export interface TaskItem {
  /** Stable key: "task:12", "water:b:C", "water:p:7", "sug:treat-rust:p7", "sug:lime:bC". */
  key: string;
  kind: TaskKind;
  title: string;
  why?: string;
  icon: TaskIcon;
  plantId: number | null;
  block: string | null;
  /** When it's due (any time on that day). */
  dueAt: number;
  urgency?: Suggestion['urgency'];
  /** Custom tasks. */
  taskId?: number;
  repeatDays?: number | null;
  /** Suggestion tasks. */
  suggestionId?: string;
  /** Done-list items. */
  doneAt?: number;
}

export type GroupKey = 'overdue' | 'today' | 'week' | 'later' | 'done';

export interface TaskGroup {
  key: GroupKey;
  title: string;
  items: TaskItem[];
}

export const GROUP_TITLE: Record<GroupKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This Week',
  later: 'Later',
  done: 'Done',
};

// ── Suggestions → actions ─────────────────────────────────────────────────────

/**
 * What finishing a suggestion means. An action type = log that action (it
 * feeds the outcome stats). null = no treatment: just mark it handled.
 */
export const SUGGESTION_ACTION: Record<string, ActionType | null> = {
  'treat-rust': 'sprayed',
  'spray-not-working': 'sprayed',
  'treat-miner': 'removed_leaves',
  'treat-phoma': 'pruned',
  recurring: 'pruned',
  'treat-brown-eye': 'fertilised',
  nitrogen: 'fertilised',
  lime: 'fertilised',
  acidify: 'fertilised',
  'ask-officer': null,
  rescan: null,
  neighbours: null,
  routine: 'pruned',
};

export function actionForSuggestion(id: string): ActionType | null {
  return SUGGESTION_ACTION[id] ?? null;
}

/** Disease a treatment suggestion is about — stored on the logged action so outcome stats can learn from it. */
export const SUGGESTION_DISEASE: Record<string, string> = {
  'treat-rust': 'coffee_leaf_rust',
  'treat-miner': 'coffee_leaf_miner',
  'treat-phoma': 'coffee_phoma',
  'treat-brown-eye': 'coffee_brown_eye',
};

/** Picks a glyph for a farmer's own task from its words ("Spray Block C" → sprayer). */
export function iconForTitle(title: string): TaskIcon {
  const t = title.toLowerCase();
  if (/spray|copper|neem/.test(t)) return 'sprayed';
  if (/prun|cut|sucker/.test(t)) return 'pruned';
  if (/feed|fertili|manure|compost|lime/.test(t)) return 'fertilised';
  if (/water|irrigat/.test(t)) return 'watered';
  if (/leaves|leaf|pick/.test(t)) return 'removed_leaves';
  if (/scan|check/.test(t)) return 'scan';
  return 'task';
}

/**
 * How long a finished suggestion stays hidden. Treatments mostly clear their
 * suggestion through the logged action anyway; rules that stay true (soil pH,
 * "keeps coming back") need a longer rest so the list doesn't nag.
 */
export function handledDays(id: string): number {
  if (id === 'lime' || id === 'acidify' || id === 'nitrogen') return 90;
  if (id === 'recurring' || id === 'routine') return 21;
  if (id === 'neighbours') return 7;
  if (id === 'ask-officer' || id === 'rescan') return 5;
  return 7;
}

const SUGGESTION_ICON: Record<string, TaskIcon> = {
  'ask-officer': 'officer',
  rescan: 'scan',
  neighbours: 'eye',
};

/** Suggestions that describe the whole block (soil, spread) — listed once per block, not per tree. */
export const BLOCK_WIDE_SUGGESTIONS = new Set(['neighbours', 'lime', 'acidify', 'nitrogen']);

// ── Derived tasks ─────────────────────────────────────────────────────────────

export function subjectKey(s: { plantId: number | null; block: string | null }): string {
  return s.plantId != null ? `p${s.plantId}` : `b${s.block ?? '-'}`;
}

export interface SuggestionSubject {
  kind: 'plant' | 'block';
  plantId: number | null;
  block: string | null;
  suggestions: Suggestion[];
}

/**
 * Turns insight suggestions (urgency now / soon only) into tasks, deduped:
 * - block-wide ones (soil, neighbours) appear once per block;
 * - a tree-specific one (e.g. treat-rust) on a tagged tree replaces the same
 *   suggestion on its block (the block one is usually caused by that tree's scan).
 */
export function deriveSuggestionTasks(subjects: SuggestionSubject[], now: number): TaskItem[] {
  const today = startOfDay(now);
  const out = new Map<string, TaskItem>();
  const treeIdsByBlock = new Map<string, Set<string>>();
  for (const s of subjects) {
    if (s.kind !== 'plant' || !s.block) continue;
    const set = treeIdsByBlock.get(s.block) ?? new Set<string>();
    s.suggestions.forEach((g) => set.add(g.id));
    treeIdsByBlock.set(s.block, set);
  }

  // Blocks first, so block-wide suggestions attach to the block.
  const ordered = [...subjects].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'block' ? -1 : 1));
  for (const s of ordered) {
    for (const g of s.suggestions) {
      if (g.urgency !== 'now' && g.urgency !== 'soon') continue;
      const blockWide = BLOCK_WIDE_SUGGESTIONS.has(g.id);
      if (s.kind === 'block' && !blockWide && s.block && treeIdsByBlock.get(s.block)?.has(g.id)) continue;
      const asBlock = blockWide && s.block != null;
      const plantId = asBlock ? null : s.plantId;
      const key = `sug:${g.id}:${subjectKey({ plantId, block: s.block })}`;
      if (out.has(key)) continue;
      out.set(key, {
        key,
        kind: 'suggestion',
        title: blockWide && s.kind === 'plant' ? g.title.replace('this tree', 'this block') : g.title,
        why: g.why,
        icon: SUGGESTION_ICON[g.id] ?? actionForSuggestion(g.id) ?? 'task',
        plantId,
        block: s.block,
        // "Now" = today; "soon" = within a few days (shows under This week).
        dueAt: g.urgency === 'now' ? today : addDays(today, 2),
        urgency: g.urgency,
        suggestionId: g.id,
      });
    }
  }
  return [...out.values()];
}

export interface WaterTaskSubject {
  kind: 'block' | 'plant';
  plantId: number | null;
  block: string | null;
  status: WateringStatus;
}

/** A "Water" task for each subject due today or overdue. */
export function deriveWateringTasks(subjects: WaterTaskSubject[], now: number): TaskItem[] {
  const today = startOfDay(now);
  return subjects
    .filter((s) => s.status.dueToday)
    .map((s) => ({
      key: `water:${s.kind === 'block' ? `b:${s.block}` : `p:${s.plantId}`}`,
      kind: 'water' as const,
      title: 'Water',
      why: s.status.neverLogged ? 'No watering logged yet.' : `Every ${s.status.everyDays} days.`,
      icon: 'watered' as const,
      plantId: s.kind === 'plant' ? s.plantId : null,
      block: s.block,
      dueAt: s.status.nextDueAt ?? today,
    }));
}

/** A custom task as a list item (active state). */
export function customTaskItem(t: TaskRecord): TaskItem {
  return {
    key: `task:${t.id}`,
    kind: 'custom',
    title: t.title,
    why: t.notes ?? undefined,
    icon: iconForTitle(t.title),
    plantId: t.plantId,
    block: t.block,
    dueAt: t.dueAt,
    taskId: t.id,
    repeatDays: t.repeatDays,
  };
}

// ── Custom task transitions ───────────────────────────────────────────────────

/**
 * Completing a task. One-off → done. Repeating → next due date: one repeat
 * after the old due date, skipping any repeats already in the past (finishing a
 * weekly task 3 weeks late doesn't leave 2 overdue copies).
 */
export function completeTask(t: Pick<TaskRecord, 'dueAt' | 'repeatDays'>, now: number): Pick<TaskRecord, 'dueAt' | 'doneAt' | 'lastDoneAt'> {
  if (!t.repeatDays || t.repeatDays < 1) return { dueAt: t.dueAt, doneAt: now, lastDoneAt: now };
  const today = startOfDay(now);
  let next = addDays(t.dueAt, t.repeatDays);
  while (startOfDay(next) <= today) next = addDays(next, t.repeatDays);
  return { dueAt: next, doneAt: null, lastDoneAt: now };
}

/** Snooze = one more day: tomorrow if it's due today or overdue, else the day after its due date. */
export function snoozeDueAt(dueAt: number, now: number): number {
  const today = startOfDay(now);
  return addDays(Math.max(startOfDay(dueAt), today), 1);
}

/** Mark for a snoozed derived task: hidden until the start of tomorrow. */
export function snoozeMark(item: Pick<TaskItem, 'key' | 'title' | 'plantId' | 'block'>, now: number): TaskMark {
  return { key: item.key, kind: 'snooze', until: addDays(startOfDay(now), 1), createdAt: now, title: item.title, plantId: item.plantId, block: item.block, actionId: null };
}

/** Mark for a finished derived suggestion: hidden for handledDays(), listed under Done. */
export function doneMark(item: Pick<TaskItem, 'key' | 'title' | 'plantId' | 'block' | 'suggestionId'>, now: number, actionId: number | null): TaskMark {
  const days = item.suggestionId ? handledDays(item.suggestionId) : 1;
  return { key: item.key, kind: 'done', until: addDays(startOfDay(now), days), createdAt: now, title: item.title, plantId: item.plantId, block: item.block, actionId };
}

// ── Merge & group ─────────────────────────────────────────────────────────────

export interface TaskListInput {
  custom: TaskRecord[];
  derived: TaskItem[];
  marks: TaskMark[];
  now: number;
  /** Recently done items from logged watering, if the caller wants them listed. */
  extraDone?: TaskItem[];
  doneWindowDays?: number;
}

export interface TaskList {
  groups: TaskGroup[];
  counts: Record<GroupKey, number>;
  /** All open items in order (overdue first). */
  open: TaskItem[];
}

const URGENCY_RANK = { now: 0, soon: 1, routine: 2 } as const;
const KIND_RANK: Record<TaskKind, number> = { water: 0, suggestion: 1, custom: 2 };

export function compareTasks(a: TaskItem, b: TaskItem): number {
  return (
    startOfDay(a.dueAt) - startOfDay(b.dueAt) ||
    (URGENCY_RANK[a.urgency ?? 'routine'] - URGENCY_RANK[b.urgency ?? 'routine']) ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (a.block ?? '').localeCompare(b.block ?? '') ||
    (a.plantId ?? -1) - (b.plantId ?? -1) ||
    a.title.localeCompare(b.title)
  );
}

export function groupFor(dueAt: number, now: number): Exclude<GroupKey, 'done'> {
  const d = dayDiff(now, dueAt);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 7) return 'week';
  return 'later';
}

/** Merges custom + derived tasks, hides snoozed / handled ones, groups and sorts. */
export function buildTaskList({ custom, derived, marks, now, extraDone = [], doneWindowDays = 7 }: TaskListInput): TaskList {
  const active = new Map<string, TaskMark>();
  for (const m of marks) if (m.until > now) active.set(m.key, m);

  const open: TaskItem[] = [];
  const done: TaskItem[] = [];
  const recent = (t: number | null | undefined) => t != null && now - t <= doneWindowDays * DAY;

  for (const t of custom) {
    if (t.doneAt != null) {
      if (recent(t.doneAt)) done.push({ ...customTaskItem(t), doneAt: t.doneAt });
      continue;
    }
    open.push(customTaskItem(t));
    // A repeating task finished recently also shows under Done.
    if (t.repeatDays && recent(t.lastDoneAt)) done.push({ ...customTaskItem(t), key: `task:${t.id}:done`, doneAt: t.lastDoneAt! });
  }
  for (const d of derived) if (!active.has(d.key)) open.push(d);

  for (const m of marks) {
    if (m.kind !== 'done' || !recent(m.createdAt)) continue;
    const sugId = m.key.startsWith('sug:') ? m.key.split(':')[1] : undefined;
    done.push({
      key: `${m.key}:done`,
      kind: m.key.startsWith('water:') ? 'water' : 'suggestion',
      title: m.title ?? 'Done',
      icon: sugId ? SUGGESTION_ICON[sugId] ?? actionForSuggestion(sugId) ?? 'task' : 'task',
      plantId: m.plantId,
      block: m.block,
      dueAt: m.createdAt,
      doneAt: m.createdAt,
      suggestionId: sugId,
    });
  }
  for (const e of extraDone) if (recent(e.doneAt)) done.push(e);

  open.sort(compareTasks);
  done.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

  const buckets: Record<GroupKey, TaskItem[]> = { overdue: [], today: [], week: [], later: [], done };
  for (const item of open) buckets[groupFor(item.dueAt, now)].push(item);
  const order: GroupKey[] = ['overdue', 'today', 'week', 'later', 'done'];
  return {
    groups: order.filter((k) => buckets[k].length).map((k) => ({ key: k, title: GROUP_TITLE[k], items: buckets[k] })),
    counts: { overdue: buckets.overdue.length, today: buckets.today.length, week: buckets.week.length, later: buckets.later.length, done: done.length },
    open,
  };
}

// ── Labels ────────────────────────────────────────────────────────────────────

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Overdue 2 days", "Today", "Tomorrow", "Thu", "12 Oct". */
export function dueLabel(dueAt: number, now: number): string {
  const d = dayDiff(now, dueAt);
  if (d < 0) return `Overdue ${-d} day${d === -1 ? '' : 's'}`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  const date = new Date(dueAt);
  if (d < 7) return WEEKDAY[date.getDay()];
  return `${date.getDate()} ${MONTH[date.getMonth()]}`;
}

/** "Done today", "Done yesterday", "Done Mon". */
export function doneLabel(doneAt: number, now: number): string {
  const d = dayDiff(doneAt, now);
  if (d <= 0) return 'Done today';
  if (d === 1) return 'Done yesterday';
  return `Done ${WEEKDAY[new Date(doneAt).getDay()]}`;
}

/** "Every week", "Every 2 weeks", "Every 3 days". */
export function repeatLabel(days: number | null | undefined): string | null {
  if (!days) return null;
  if (days % 7 === 0) return days === 7 ? 'Every week' : `Every ${days / 7} weeks`;
  return days === 1 ? 'Every day' : `Every ${days} days`;
}
