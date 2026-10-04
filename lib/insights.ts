/**
 * Insight engine — turns a tree's (or block's) scan and action history into
 * an honest health estimate, five pentagon axes, a weekly strip, and ranked
 * suggestions that each say *why*.
 *
 * Pure and deterministic (no React Native imports): runs offline on the phone
 * and is unit-tested in tests/insights.test.ts.
 *
 * Honesty rules (CLAUDE.md rule 5): every estimate carries a confidence and the
 * number of scans it is based on; nothing is claimed about yield because no
 * harvest data exists; suggestions are agronomy rules triggered by this tree's
 * data, and "worked N of M times" evidence only comes from logged outcomes.
 */

import type { ActionRecord, ActionType, IssueRecord } from './db';

// Mirrors TREATMENT_ACTIONS in db.ts (kept local so this module stays import-free for tests).
const TREATMENTS: ActionType[] = ['sprayed', 'pruned', 'fertilised', 'removed_leaves'];
const isTreatment = (t: ActionType) => TREATMENTS.includes(t);

const DAY = 86_400_000;

export const SEVERITY_WEIGHT: Record<string, number> = { high: 1, medium: 0.6, low: 0.3, unknown: 0.35, none: 0 };
const sev = (s: string) => SEVERITY_WEIGHT[s] ?? 0.35;
const byTime = <T extends { timestamp: number }>(xs: T[]) => [...xs].sort((a, b) => a.timestamp - b.timestamp);
/** Low-confidence results count as "unclear" (CLAUDE.md rule 5: no confident wrong answers). */
export const MIN_CONFIDENCE = 0.6;
const isUnclear = (s: IssueRecord) => s.diseaseId === 'unknown' || s.confidence < MIN_CONFIDENCE;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Parts of the coffee-bush diagram a suggestion can point at. */
export type Zone = 'leaves_underside' | 'lower_branches' | 'canopy_center' | 'suckers' | 'old_stems' | 'soil' | 'whole';

export type HealthLevel = 'good' | 'watch' | 'sick' | 'unknown';
export type Confidence = 'none' | 'low' | 'medium' | 'high';
export type Trend = 'improving' | 'worsening' | 'stable' | 'new';
export type AxisKey = 'leaf' | 'recovery' | 'spread' | 'soil' | 'care';

export interface Axis {
  key: AxisKey;
  label: string;
  /** 0–5, or null when there is no data for it. */
  value: number | null;
  detail: string;
}

export interface WeekCell {
  start: number;
  /** Worst severity seen that week, or null when not scanned. */
  worst: string | null;
  scans: number;
  actions: ActionType[];
}

export interface Suggestion {
  id: string;
  title: string;
  why: string;
  zone: Zone;
  urgency: 'now' | 'soon' | 'routine';
  /** Outcome evidence ("Worked 3 of 4 times on your farm · 71% in your area"). */
  evidence?: string;
}

export interface OutcomeStat {
  success: number;
  total: number;
}
/** diseaseId → action → tally of "next scan was better". */
export type OutcomeStats = Record<string, Partial<Record<ActionType, OutcomeStat>>>;

export interface SoilInput {
  ph: number;
  nitrogen: number;
}

export interface InsightInput {
  /** Scans of the subject (one tree, or a whole block). */
  scans: IssueRecord[];
  /** Actions on the subject. */
  actions: ActionRecord[];
  /** All scans in the subject's block(s), for spread risk. */
  blockScans?: IssueRecord[];
  /** Tree being assessed — excluded from its own spread risk. */
  plantId?: number | null;
  /** 'plant' (default) or 'block' — changes wording and how neighbours are chosen. */
  kind?: 'plant' | 'block';
  soil?: SoilInput | null;
  /** Outcome stats from this farm (computed on the phone). */
  localStats?: OutcomeStats;
  /** Outcome stats from the hub (all farms in the area). */
  regionalStats?: OutcomeStats;
  now?: number;
}

export interface Insight {
  health: { score: number | null; level: HealthLevel; confidence: Confidence; scansUsed: number; spanDays: number; stale: boolean };
  trend: Trend;
  axes: Axis[];
  weeks: WeekCell[];
  recurring: { diseaseId: string; name: string; count: number; lastSeen: number }[];
  suggestions: Suggestion[];
  lastScan: IssueRecord | null;
  lastAction: ActionRecord | null;
}

// ── Health ────────────────────────────────────────────────────────────────────

const RECENT_DAYS = 28;

function weightedSeverity(scans: IssueRecord[], now: number): number {
  let num = 0;
  let den = 0;
  for (const s of scans) {
    const w = Math.exp(-Math.max(0, now - s.timestamp) / (10 * DAY)); // newest weigh most
    num += w * sev(s.severity);
    den += w;
  }
  return den ? num / den : 0;
}

export function healthEstimate(input: IssueRecord[], now: number): Insight['health'] {
  const scans = byTime(input);
  if (!scans.length) return { score: null, level: 'unknown', confidence: 'none', scansUsed: 0, spanDays: 0, stale: false };
  const recent = scans.filter((s) => now - s.timestamp <= RECENT_DAYS * DAY);
  const stale = recent.length === 0;
  const used = stale ? scans.slice(-3) : recent;
  const score = Math.round(100 * (1 - weightedSeverity(used, now)));
  const level: HealthLevel = score >= 75 ? 'good' : score >= 45 ? 'watch' : 'sick';
  const confidence: Confidence = stale || used.length <= 2 ? 'low' : used.length <= 5 ? 'medium' : 'high';
  const spanDays = Math.max(1, Math.round((now - Math.min(...used.map((s) => s.timestamp))) / DAY));
  return { score, level, confidence, scansUsed: used.length, spanDays, stale };
}

export function trendOf(input: IssueRecord[], now: number): Trend {
  // Only the last 4 weeks count — a trend from months-old scans would mislead.
  const scans = byTime(input).filter((s) => now - s.timestamp <= 28 * DAY);
  if (scans.length < 2) return 'new';
  const last = scans.filter((s) => now - s.timestamp <= 14 * DAY);
  const prev = scans.filter((s) => now - s.timestamp > 14 * DAY);
  let diff: number;
  if (last.length && prev.length) {
    const avg = (xs: IssueRecord[]) => xs.reduce((a, s) => a + sev(s.severity), 0) / xs.length;
    diff = avg(last) - avg(prev);
  } else {
    diff = sev(scans[scans.length - 1].severity) - sev(scans[scans.length - 2].severity);
  }
  return diff < -0.15 ? 'improving' : diff > 0.15 ? 'worsening' : 'stable';
}

// ── Axes ──────────────────────────────────────────────────────────────────────

const clamp5 = (v: number) => Math.max(0, Math.min(5, Math.round(v * 2) / 2));

function lastActionAfter(actions: ActionRecord[], t: number, types?: ActionType[]) {
  return actions.filter((a) => a.timestamp >= t && (!types || types.includes(a.type))).sort((a, b) => a.timestamp - b.timestamp)[0];
}

/** Sick scans older than 3 days with no action logged within 7 days after them. */
function untreated(scans: IssueRecord[], actions: ActionRecord[], now: number): IssueRecord[] {
  return scans.filter((s) => {
    if (sev(s.severity) < 0.6 || s.diseaseId === 'unknown') return false;
    if (now - s.timestamp < 3 * DAY || now - s.timestamp > RECENT_DAYS * DAY) return false;
    return !actions.some((a) => isTreatment(a.type) && a.timestamp >= s.timestamp && a.timestamp <= s.timestamp + 7 * DAY);
  });
}

export function buildAxes(input: InsightInput, health: Insight['health'], trend: Trend, now: number): Axis[] {
  const { scans, actions, soil } = input;

  const leaf: Axis = {
    key: 'leaf',
    label: 'Leaves',
    value: health.score == null ? null : clamp5(health.score / 20),
    detail: health.score == null ? 'Not scanned yet' : `Health ${health.score}/100 from ${health.scansUsed} scan${health.scansUsed === 1 ? '' : 's'}`,
  };

  const recoveryValue: Record<Trend, number | null> = {
    improving: 5,
    stable: health.level === 'good' ? 4 : 2.5,
    worsening: 1,
    new: null,
  };
  const recovery: Axis = {
    key: 'recovery',
    label: 'Recovery',
    value: recoveryValue[trend],
    detail: trend === 'new' ? 'Needs two or more scans' : `Getting ${trend === 'improving' ? 'better' : trend === 'worsening' ? 'worse' : 'neither better nor worse'} over 4 weeks`,
  };

  const own = new Set(scans.map((s) => s.id));
  const neighbours = (input.blockScans ?? []).filter(
    (s) => now - s.timestamp <= 14 * DAY && !own.has(s.id) && (input.plantId == null || s.plantId !== input.plantId),
  );
  const sickShare = neighbours.length ? neighbours.filter((s) => sev(s.severity) >= 0.6).length / neighbours.length : null;
  const spread: Axis = {
    key: 'spread',
    label: 'Neighbours',
    value: sickShare == null ? null : clamp5(5 * (1 - sickShare)),
    detail:
      sickShare == null
        ? `No scans ${input.kind === 'block' ? 'in other blocks' : 'of nearby trees'} in 2 weeks`
        : `${Math.round(sickShare * 100)}% of ${input.kind === 'block' ? 'other blocks’' : 'nearby'} scans sick (2 weeks)`,
  };

  let soilAxis: Axis = { key: 'soil', label: 'Soil', value: null, detail: 'No soil data here' };
  if (soil) {
    const off = soil.ph < 6 ? 6 - soil.ph : soil.ph > 6.6 ? soil.ph - 6.6 : 0;
    const lowN = soil.nitrogen > 0 && soil.nitrogen < 1.5;
    soilAxis = {
      key: 'soil',
      label: 'Soil',
      value: clamp5(5 - off * 4 - (lowN ? 1 : 0)), // pH 5.8 → ~4, 5.5 → 3, 5.3 → 2
      detail: `pH ${soil.ph.toFixed(1)} (coffee likes 6.0–6.5)${lowN ? ', nitrogen low' : ''}`,
    };
  }

  let care: Axis = { key: 'care', label: 'Care', value: null, detail: 'Not scanned yet' };
  if (scans.length) {
    const days = Math.max(0, Math.floor((now - scans[scans.length - 1].timestamp) / DAY));
    const missed = untreated(scans, actions, now).length;
    const base = days <= 7 ? 5 : days <= 14 ? 4 : days <= 28 ? 2.5 : 1;
    care = {
      key: 'care',
      label: 'Care',
      value: clamp5(base - (missed ? 1.5 : 0)),
      detail: `Checked ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}${missed ? ` · ${missed} problem${missed === 1 ? '' : 's'} not treated` : ''}`,
    };
  }

  return [leaf, recovery, spread, soilAxis, care];
}

// ── Weekly strip & recurrence ─────────────────────────────────────────────────

export function weeklyStrip(scans: IssueRecord[], actions: ActionRecord[], now: number, weeks = 8): WeekCell[] {
  const end = now;
  return Array.from({ length: weeks }, (_, i) => {
    const start = end - (weeks - i) * 7 * DAY;
    const stop = start + 7 * DAY;
    const inWeek = scans.filter((s) => s.timestamp > start && s.timestamp <= stop);
    const worst = inWeek.length ? inWeek.reduce((w, s) => (sev(s.severity) > sev(w) ? s.severity : w), inWeek[0].severity) : null;
    return {
      start,
      worst,
      scans: inWeek.length,
      actions: actions.filter((a) => a.timestamp > start && a.timestamp <= stop && a.type !== 'none').map((a) => a.type),
    };
  });
}

/**
 * Diseases that came back: counts separate *episodes* — a new episode starts
 * when the disease is seen again after a healthy scan or after 7+ days — so
 * several scans on one day (or one leaf after another) don't count as "recurring".
 */
export function recurringDiseases(input: IssueRecord[], now: number, windowDays = 42): Insight['recurring'] {
  const scans = byTime(input).filter((s) => now - s.timestamp <= windowDays * DAY);
  const counts = new Map<string, { name: string; count: number; lastSeen: number; healthySince: boolean }>();
  for (const s of scans) {
    if (s.diseaseId === 'healthy') {
      for (const c of counts.values()) c.healthySince = true;
      continue;
    }
    if (isUnclear(s)) continue;
    const c = counts.get(s.diseaseId);
    if (!c) {
      counts.set(s.diseaseId, { name: s.diseaseName, count: 1, lastSeen: s.timestamp, healthySince: false });
    } else {
      if (c.healthySince || s.timestamp - c.lastSeen >= 7 * DAY) c.count++;
      c.lastSeen = s.timestamp;
      c.healthySince = false;
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c.count >= 2)
    .map(([diseaseId, c]) => ({ diseaseId, name: c.name, count: c.count, lastSeen: c.lastSeen }))
    .sort((a, b) => b.count - a.count);
}

// ── Outcomes (what worked) ────────────────────────────────────────────────────

export interface OutcomeEvent {
  actionId: number;
  diseaseId: string;
  type: ActionType;
  success: boolean;
}

/**
 * For each treatment, finds the scan that prompted it and the next clear
 * (not "unknown") scan of the same tree 3–28 days later: success = healthier
 * than the trigger. Block-level treatments (no tree) compare the block's
 * average severity in that window instead. Several logs of the same action for
 * one trigger count once. Treatments with no follow-up yet are skipped.
 */
export function computeOutcomes(scanInput: IssueRecord[], actionInput: ActionRecord[]): OutcomeEvent[] {
  const scans = byTime(scanInput);
  const actions = byTime(actionInput);
  const latestByKey = new Map<string, OutcomeEvent>();

  for (const a of actions) {
    if (!isTreatment(a.type) || !a.diseaseId || a.diseaseId === 'healthy' || a.diseaseId === 'unknown') continue;
    if (a.plantId == null && a.block == null) continue;

    const trigger =
      (a.issueId != null ? scans.find((s) => s.id === a.issueId) : undefined) ??
      scans.filter((s) => s.timestamp <= a.timestamp && s.diseaseId === a.diseaseId && (a.plantId != null ? s.plantId === a.plantId : s.block === a.block)).pop();
    const plantId = a.plantId ?? trigger?.plantId ?? null;
    const inWindow = (s: IssueRecord) => s.timestamp >= a.timestamp + 3 * DAY && s.timestamp <= a.timestamp + 28 * DAY && !isUnclear(s);
    const before = trigger ? sev(trigger.severity) : 0.6;

    let success: boolean;
    if (plantId != null) {
      const next = scans.find((s) => s.plantId === plantId && inWindow(s));
      if (!next) continue;
      success = next.diseaseId === 'healthy' || sev(next.severity) < before;
    } else {
      const follow = scans.filter((s) => s.block === a.block && inWindow(s));
      if (!follow.length) continue;
      const avg = follow.reduce((acc, s) => acc + sev(s.severity), 0) / follow.length;
      success = avg < before;
    }
    // One outcome per (trigger, action type): the latest log wins.
    const key = `${trigger?.id ?? `${plantId ?? a.block}-${a.diseaseId}`}:${a.type}`;
    latestByKey.set(key, { actionId: a.id, diseaseId: a.diseaseId, type: a.type, success });
  }
  return [...latestByKey.values()];
}

export function aggregateOutcomes(events: Pick<OutcomeEvent, 'diseaseId' | 'type' | 'success'>[]): OutcomeStats {
  const stats: OutcomeStats = {};
  for (const e of events) {
    const byAction = (stats[e.diseaseId] ??= {});
    const tally = (byAction[e.type] ??= { success: 0, total: 0 });
    tally.total++;
    if (e.success) tally.success++;
  }
  return stats;
}

function evidenceFor(diseaseId: string, action: ActionType, input: InsightInput): string | undefined {
  const parts: string[] = [];
  const local = input.localStats?.[diseaseId]?.[action];
  if (local && local.total > 0) parts.push(`Worked ${local.success} of ${local.total} time${local.total === 1 ? '' : 's'} on your farm`);
  const regional = input.regionalStats?.[diseaseId]?.[action];
  if (regional && regional.total >= 5) parts.push(`${Math.round((100 * regional.success) / regional.total)}% in your area (${regional.total} cases)`);
  return parts.length ? parts.join(' · ') : undefined;
}

// ── Suggestions ───────────────────────────────────────────────────────────────

const fmtDate = (t: number) => {
  const d = new Date(t);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
};

export function buildSuggestions(input: InsightInput, insight: Omit<Insight, 'suggestions'>, now: number): Suggestion[] {
  const { scans, actions, soil } = input;
  const out: Suggestion[] = [];
  const latest = scans[scans.length - 1];
  const subjectWord = input.kind === 'block' ? 'block' : 'tree';
  const name = (s: IssueRecord) => s.diseaseName.toLowerCase();

  // 1. Active problem — the latest scan (within 2 weeks) shows a disease.
  if (latest && now - latest.timestamp <= 14 * DAY && latest.diseaseId !== 'healthy') {
    const sprayedSince = lastActionAfter(actions, latest.timestamp, ['sprayed']);
    const actedSince = lastActionAfter(actions, latest.timestamp, ['sprayed', 'pruned', 'fertilised', 'removed_leaves']);
    const seen = `${latest.diseaseName} found on ${fmtDate(latest.timestamp)}`;
    switch (isUnclear(latest) ? 'unknown' : latest.diseaseId) {
      case 'coffee_leaf_rust':
        if (!sprayedSince)
          out.push({
            id: 'treat-rust',
            title: 'Spray copper under the leaves',
            why: `${seen}. No spraying logged since. Rust spreads fast in wet weather — act within 3 days.`,
            zone: 'leaves_underside',
            urgency: 'now',
            evidence: evidenceFor('coffee_leaf_rust', 'sprayed', input),
          });
        break;
      case 'coffee_leaf_miner':
        if (!actedSince)
          out.push({
            id: 'treat-miner',
            title: 'Pick off the mined leaves',
            why: `${seen}. Remove and destroy damaged leaves, then spray neem early in the morning.`,
            zone: 'lower_branches',
            urgency: 'now',
            evidence: evidenceFor('coffee_leaf_miner', 'removed_leaves', input),
          });
        break;
      case 'coffee_phoma':
        if (!actedSince)
          out.push({
            id: 'treat-phoma',
            title: 'Open up the centre of the bush',
            why: `${seen}. Phoma likes damp, crowded canopies — prune for airflow and avoid watering from above.`,
            zone: 'canopy_center',
            urgency: 'now',
            evidence: evidenceFor('coffee_phoma', 'pruned', input),
          });
        break;
      case 'coffee_brown_eye':
        if (!actedSince)
          out.push({
            id: 'treat-brown-eye',
            title: 'Feed the tree',
            why: `${seen}. Brown eye usually means a hungry, stressed tree — add a balanced fertiliser (nitrogen and potassium).`,
            zone: 'soil',
            urgency: 'soon',
            evidence: evidenceFor('coffee_brown_eye', 'fertilised', input),
          });
        break;
      case 'unknown':
        out.push({
          id: 'ask-officer',
          title: 'Ask your extension officer',
          why: `The last scan (${fmtDate(latest.timestamp)}) wasn't clear enough to name a disease. Don't spray until it's confirmed.`,
          zone: 'whole',
          urgency: 'soon',
        });
        break;
    }
  }

  // 2. Treatment not working — the tree still has the disease it was sprayed for:
  //    the latest scan shows it, ≥10 days after a spray, with no newer spray since.
  const latestClear = [...scans].reverse().find((s) => !isUnclear(s));
  const lastSpray = [...actions].reverse().find((x) => x.type === 'sprayed' && x.diseaseId && x.diseaseId !== 'unknown');
  if (lastSpray && latestClear && latestClear.diseaseId === lastSpray.diseaseId) {
    const a = lastSpray;
    const again = latestClear;
    if (again.timestamp >= a.timestamp + 10 * DAY && now - again.timestamp <= 21 * DAY) {
      out.push({
        id: 'spray-not-working',
        title: 'Spraying hasn’t cleared it',
        why: `Sprayed on ${fmtDate(a.timestamp)}, but ${name(again)} was found again on ${fmtDate(again.timestamp)}. Check the product, cover the leaf undersides, or ask your extension officer.`,
        zone: 'leaves_underside',
        urgency: 'soon',
      });
    }
  }

  // 3. Keeps coming back.
  const top = insight.recurring[0];
  if (top && top.count >= 2) {
    out.push({
      id: 'recurring',
      title: 'Prune the lower branches',
      why: `${top.name} found ${top.count} times in 6 weeks — it keeps coming back. Low, crowded branches stay wet; pruning them lets air and sun in.`,
      zone: 'lower_branches',
      urgency: 'soon',
    });
  }

  // 4. Neighbours sick.
  const spread = insight.axes.find((a) => a.key === 'spread');
  if (spread?.value != null && spread.value <= 2) {
    out.push({ id: 'neighbours', title: `Check this ${subjectWord} every week`, why: `${spread.detail}. Disease can spread from nearby trees.`, zone: 'whole', urgency: 'soon' });
  }

  // 5. Not checked recently.
  if (latest && now - latest.timestamp > 14 * DAY) {
    const days = Math.floor((now - latest.timestamp) / DAY);
    out.push({ id: 'rescan', title: `Scan this ${subjectWord} again`, why: `Last checked ${days} days ago — the estimate is getting old.`, zone: 'whole', urgency: 'routine' });
  }

  // 6. Soil.
  if (soil) {
    if (soil.ph < 6) {
      out.push({ id: 'lime', title: 'Lime the soil', why: `Soil pH ${soil.ph.toFixed(1)} is too acidic for coffee (6.0–6.5). Lime around the drip line; confirm the rate with a soil test.`, zone: 'soil', urgency: 'routine' });
    } else if (soil.ph > 6.6) { // same threshold as the soil axis
      out.push({ id: 'acidify', title: 'Use an acidifying fertiliser', why: `Soil pH ${soil.ph.toFixed(1)} is a little high for coffee. Sulphate of ammonia helps bring it down over time.`, zone: 'soil', urgency: 'routine' });
    }
    if (soil.nitrogen > 0 && soil.nitrogen < 1.5) {
      out.push({ id: 'nitrogen', title: 'Add compost or nitrogen', why: `Soil nitrogen looks low (${soil.nitrogen.toFixed(1)} g/kg). Feed before the rains.`, zone: 'soil', urgency: 'routine' });
    }
  }

  // 7. Healthy — keep the routine.
  if (insight.health.level === 'good' && scans.slice(-2).every((s) => s.diseaseId === 'healthy') && scans.length >= 2) {
    out.push({ id: 'routine', title: 'Keep it healthy: remove suckers', why: 'Last scans were healthy. Remove suckers and water shoots after harvest so energy goes to the cherries.', zone: 'suckers', urgency: 'routine' });
  }

  const rank = { now: 0, soon: 1, routine: 2 };
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).sort((a, b) => rank[a.urgency] - rank[b.urgency]);
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function computeInsight(input: InsightInput): Insight {
  const now = input.now ?? Date.now();
  // Phone clocks drift: treat anything "in the future" as now.
  const clamp = <T extends { timestamp: number }>(x: T): T => (x.timestamp > now ? { ...x, timestamp: now } : x);
  const scans = byTime(input.scans.map(clamp));
  const actions = byTime(input.actions.map(clamp));
  const normalized = { ...input, scans, actions, blockScans: input.blockScans?.map(clamp) };
  const health = healthEstimate(scans, now);
  const trend = trendOf(scans, now);
  const base = {
    health,
    trend,
    axes: buildAxes(normalized, health, trend, now),
    weeks: weeklyStrip(scans, actions, now),
    recurring: recurringDiseases(scans, now),
    lastScan: scans[scans.length - 1] ?? null,
    lastAction: actions[actions.length - 1] ?? null,
  };
  return { ...base, suggestions: buildSuggestions(normalized, base, now) };
}
