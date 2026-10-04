/**
 * Watering — how often a block (or one tree) should be watered, when it was
 * last watered, and when it's due next. Rain counts as watering.
 *
 * Pure and deterministic (only `import type`), so it runs offline on the phone
 * and is unit-tested in tests/tasks.test.ts. Storage is in lib/db.ts
 * (watering_plans table + 'watered' / 'rained' actions).
 *
 * Honesty: the interval is the farmer's own plan, not a measurement of soil
 * moisture. The app only reminds; it never decides she must water.
 */

import type { ActionRecord, WateringPlanRecord } from './db';

const DAY = 86_400_000;

/**
 * Placeholder default: about once a week for Arabica during a dry spell
 * (mature trees in the rainy season may need none). Not agronomic advice for
 * this farm — the farmer adjusts it with the −/+ stepper, and rain resets it.
 */
export const DEFAULT_WATER_EVERY_DAYS = 7;
export const MIN_WATER_EVERY_DAYS = 1;
export const MAX_WATER_EVERY_DAYS = 30;

export type WaterSubject = { kind: 'block'; block: string } | { kind: 'plant'; id: number; block: string | null };

export type WaterSource = 'watered' | 'rained';

const isWater = (a: Pick<ActionRecord, 'type'>) => a.type === 'watered' || a.type === 'rained';

/** Local midnight of the day containing `t`. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole calendar days from a to b (b later → positive). Rounded, so DST shifts don't matter. */
export function dayDiff(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}

export function clampEveryDays(n: number): number {
  return Math.max(MIN_WATER_EVERY_DAYS, Math.min(MAX_WATER_EVERY_DAYS, Math.round(n)));
}

/**
 * Watering / rain actions that count for a subject.
 * - Block: actions logged for the whole block (no tree).
 * - Tree: its own actions AND its block's (watering the block waters its trees).
 */
export function wateringActionsFor(subject: WaterSubject, actions: ActionRecord[]): ActionRecord[] {
  return actions.filter((a) => {
    if (!isWater(a)) return false;
    if (subject.kind === 'block') return a.plantId == null && a.block === subject.block;
    if (a.plantId === subject.id) return true;
    return a.plantId == null && subject.block != null && a.block === subject.block;
  });
}

export interface ResolvedPlan {
  everyDays: number;
  /** Where the number came from: the tree's own plan, its block's plan, or the default. */
  from: 'own' | 'block' | 'default';
}

/** A tree uses its own plan, else its block's; a block uses its plan, else the default. */
export function planFor(subject: WaterSubject, plans: WateringPlanRecord[]): ResolvedPlan {
  if (subject.kind === 'plant') {
    const own = plans.find((p) => p.subjectType === 'plant' && p.subjectId === String(subject.id));
    if (own) return { everyDays: clampEveryDays(own.everyDays), from: 'own' };
  }
  const block = subject.block;
  const bp = block != null ? plans.find((p) => p.subjectType === 'block' && p.subjectId === block) : undefined;
  if (bp) return { everyDays: clampEveryDays(bp.everyDays), from: 'block' };
  return { everyDays: DEFAULT_WATER_EVERY_DAYS, from: 'default' };
}

export interface WateringStatus {
  everyDays: number;
  lastWateredAt: number | null;
  lastSource: WaterSource | null;
  /** Calendar days since the last watering / rain (null if never logged). */
  daysSinceLast: number | null;
  /** Start of the day watering is next due (null if never logged — then it's due now). */
  nextDueAt: number | null;
  /** True when due today or overdue (or never logged). */
  dueToday: boolean;
  /** Days past the due day (0 when not overdue). */
  overdueDays: number;
  /** Days until due (0 when due today / overdue). */
  daysUntilDue: number;
  neverLogged: boolean;
  /** Distinct days with watering or rain in the last 30 days. */
  timesLast30Days: number;
  rainedLast30Days: number;
  /** Average gap between watering days over the last 60 days (null with < 2 days logged). */
  averageIntervalDays: number | null;
}

/** Status from already-filtered actions (see wateringActionsFor). */
export function wateringStatus({ everyDays, actions, now }: { everyDays: number; actions: Pick<ActionRecord, 'type' | 'timestamp'>[]; now: number }): WateringStatus {
  const every = clampEveryDays(everyDays);
  // Phone clocks drift: anything "in the future" counts as now.
  const events = actions
    .filter(isWater)
    .map((a) => ({ type: a.type as WaterSource, t: Math.min(a.timestamp, now) }))
    .sort((a, b) => a.t - b.t);
  const last = events[events.length - 1] ?? null;
  const today = startOfDay(now);

  const daysIn = (windowDays: number) => {
    const from = today - (windowDays - 1) * DAY;
    return [...new Set(events.filter((e) => e.t >= from).map((e) => startOfDay(e.t)))].sort((a, b) => a - b);
  };
  const days30 = daysIn(30);
  const rainDays30 = new Set(events.filter((e) => e.type === 'rained' && e.t >= today - 29 * DAY).map((e) => startOfDay(e.t))).size;
  const days60 = daysIn(60);
  const averageIntervalDays =
    days60.length >= 2 ? Math.round((10 * dayDiff(days60[0], days60[days60.length - 1])) / (days60.length - 1)) / 10 : null;

  if (!last) {
    return {
      everyDays: every,
      lastWateredAt: null,
      lastSource: null,
      daysSinceLast: null,
      nextDueAt: null,
      dueToday: true,
      overdueDays: 0,
      daysUntilDue: 0,
      neverLogged: true,
      timesLast30Days: 0,
      rainedLast30Days: 0,
      averageIntervalDays: null,
    };
  }

  const lastDay = startOfDay(last.t);
  // Add days on the calendar (not 24 h steps) so DST never shifts the due day.
  const due = new Date(lastDay);
  due.setDate(due.getDate() + every);
  const nextDueAt = startOfDay(due.getTime());
  const diff = dayDiff(today, nextDueAt); // >0 future, 0 today, <0 overdue
  return {
    everyDays: every,
    lastWateredAt: last.t,
    lastSource: last.type,
    daysSinceLast: dayDiff(lastDay, today),
    nextDueAt,
    dueToday: diff <= 0,
    overdueDays: Math.max(0, -diff),
    daysUntilDue: Math.max(0, diff),
    neverLogged: false,
    timesLast30Days: days30.length,
    rainedLast30Days: rainDays30,
    averageIntervalDays,
  };
}

/** Short status line, e.g. "Overdue 2 days", "Due today", "In 3 days". */
export function dueWord(s: WateringStatus): string {
  if (s.neverLogged) return 'Not logged yet';
  if (s.overdueDays > 0) return `Overdue ${s.overdueDays} day${s.overdueDays === 1 ? '' : 's'}`;
  if (s.dueToday) return 'Due today';
  return s.daysUntilDue === 1 ? 'Tomorrow' : `In ${s.daysUntilDue} days`;
}

/** "Today", "Yesterday", "5 days ago". */
export function agoWord(days: number | null): string {
  if (days == null) return 'never';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// ── Demo data ─────────────────────────────────────────────────────────────────

/** Small deterministic PRNG (same idea as lib/seed.ts). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plausible demo watering history over `days` (default ~6 weeks), deterministic
 * for a given `now` day. Each block has its own rhythm and finishes in a
 * different state (one recently watered, one due soon, one overdue …); a short
 * rainy spell ~4 weeks ago is logged for every block; a couple of trees get a
 * hand-watering of their own. All rows are source 'seed', synced: true.
 */
export function buildDemoWateringActions({
  blocks,
  trees = [],
  now,
  days = 42,
}: {
  blocks: readonly string[];
  trees?: { id: number; block: string | null }[];
  now: number;
  days?: number;
}): Omit<ActionRecord, 'id'>[] {
  const out: Omit<ActionRecord, 'id'>[] = [];
  const today = startOfDay(now);
  const rand = rng(Math.floor(today / DAY));
  const at = (daysAgo: number, hour: number) => Math.min(now, today - daysAgo * DAY + hour * 3_600_000);
  const row = (type: WaterSource, timestamp: number, block: string | null, plantId: number | null): Omit<ActionRecord, 'id'> => ({
    type,
    plantId,
    block,
    issueId: null,
    diseaseId: null,
    timestamp,
    source: 'seed',
    synced: true,
  });

  // Farm-wide rainy spell (rain falls on every block the same days).
  const rainDays = [29, 28, 26].filter((d) => d < days);
  // Last watering per block, in days ago: 1 = fine, 5 = due soon, 9 = overdue, 3 = fine.
  const LAST = [1, 5, 9, 3];
  blocks.forEach((block, i) => {
    for (const d of rainDays) out.push(row('rained', at(d, 15), block, null));
    const every = 6 + (i % 3); // 6, 7, 8 days
    let d = LAST[i % LAST.length];
    while (d < days) {
      // Skip watering during / just after the rain.
      if (!rainDays.some((r) => d <= r && d >= r - 3)) out.push(row('watered', at(d, 7 + Math.floor(rand() * 3)), block, null));
      d += every + Math.floor(rand() * 3) - 1; // ±1 day of human irregularity
    }
  });

  // A couple of trees watered by hand between block waterings (young or stressed trees).
  trees.slice(0, 2).forEach((t, i) => {
    for (const d of i === 0 ? [2, 11, 19] : [4, 16]) if (d < days) out.push(row('watered', at(d, 17), t.block, t.id));
  });

  return out.sort((a, b) => a.timestamp - b.timestamp);
}
