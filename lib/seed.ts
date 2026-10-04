/**
 * Demo data seeder — six weeks of history on the demo farm so the map, the
 * plant/block reports and the farm insights have something real to show.
 *
 * Ten tagged trees each tell a small story (a rust treatment that worked, one
 * that keeps coming back, a tree not checked for weeks, an unclear scan, …),
 * plus untagged scans across Blocks A–D, logged actions and their outcomes.
 * Everything is marked source = 'seed' so it can be replaced cleanly; bump
 * SEED_VERSION to reseed. Set SEED_DEMO_DATA = false to ship without it.
 */

import { ActionRecord, ActionType, countIssues, createPlant, deleteSeedData, insertIssues, IssueRecord, logAction, nextTagNumber } from './db';
import { getDisease } from './inference';
import { getQuickLocation } from './location';
import { DEMO_FARM, DEMO_MODE } from './config';
import { BLOCK_LAYOUT, BLOCK_RADIUS_M, offsetToLatLng } from './demoFarm';
import { DEMO_PHOTO } from './photos';
import { loadSettings, saveSettings } from './settings';
import { buildDemoWateringActions } from './watering';
import { FIELD_BLOCKS } from './store';

export const SEED_DEMO_DATA = true;
/** Bump to replace previously seeded demo history on next launch. */
export const SEED_VERSION = 3;

const DAY = 86_400_000;
const WEEKS = 6;

/** Disease mix for untagged block scans. */
const BLOCK_MIX: Record<string, Record<string, number>> = {
  A: { coffee_leaf_rust: 0.45, coffee_leaf_miner: 0.1, coffee_phoma: 0.1, healthy: 0.3, unknown: 0.05 },
  B: { healthy: 0.7, coffee_brown_eye: 0.15, coffee_leaf_miner: 0.15 },
  C: { coffee_leaf_miner: 0.35, coffee_phoma: 0.25, healthy: 0.3, coffee_brown_eye: 0.1 },
  D: { healthy: 0.85, coffee_brown_eye: 0.15 },
};

type Event = [daysAgo: number, diseaseId: string] | [daysAgo: number, action: ActionType, forDisease: string];

/** Each tagged tree's story, oldest first. */
const TREES: { tag: number; block: string; east: number; north: number; story: Event[] }[] = [
  // Rust keeps coming back despite spraying → "spraying hasn't cleared it", recurring.
  { tag: 1, block: 'A', east: -12, north: 8, story: [[38, 'coffee_leaf_rust'], [37, 'sprayed', 'coffee_leaf_rust'], [27, 'healthy'], [16, 'coffee_leaf_rust'], [15, 'sprayed', 'coffee_leaf_rust'], [3, 'coffee_leaf_rust']] },
  // Rust treated and cleared → a success that feeds "worked N of M times".
  { tag: 2, block: 'A', east: 10, north: -6, story: [[30, 'coffee_leaf_rust'], [29, 'sprayed', 'coffee_leaf_rust'], [21, 'healthy'], [9, 'healthy'], [2, 'healthy']] },
  // Fresh rust, nothing done yet → urgent "spray under the leaves".
  { tag: 3, block: 'A', east: 18, north: 14, story: [[20, 'healthy'], [9, 'healthy'], [1, 'coffee_leaf_rust']] },
  // Consistently healthy → routine suckers advice.
  { tag: 4, block: 'B', east: -8, north: 5, story: [[35, 'healthy'], [24, 'healthy'], [13, 'healthy'], [4, 'healthy']] },
  // Brown eye fixed by feeding.
  { tag: 5, block: 'B', east: 12, north: -10, story: [[28, 'coffee_brown_eye'], [27, 'fertilised', 'coffee_brown_eye'], [17, 'healthy'], [6, 'healthy']] },
  // Leaf miner cleared by removing leaves.
  { tag: 6, block: 'B', east: 2, north: 16, story: [[25, 'coffee_leaf_miner'], [24, 'removed_leaves', 'coffee_leaf_miner'], [14, 'healthy'], [5, 'healthy']] },
  // Phoma back after pruning → recurring, prune lower branches.
  { tag: 7, block: 'C', east: -10, north: -4, story: [[33, 'coffee_phoma'], [32, 'pruned', 'coffee_phoma'], [22, 'healthy'], [8, 'coffee_phoma']] },
  // Leaf miner found, untreated.
  { tag: 8, block: 'C', east: 14, north: 8, story: [[18, 'healthy'], [4, 'coffee_leaf_miner']] },
  // Healthy but not checked for 3 weeks → "scan again", low confidence.
  { tag: 9, block: 'D', east: -6, north: 10, story: [[40, 'healthy'], [21, 'healthy']] },
  // Unclear result → "ask your extension officer", never spray.
  { tag: 10, block: 'D', east: 9, north: -9, story: [[16, 'healthy'], [2, 'unknown']] },
];

/** Small deterministic PRNG so the demo farm looks the same on every install. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(mix: Record<string, number>, r: number) {
  let acc = 0;
  for (const [id, w] of Object.entries(mix)) {
    acc += w;
    if (r < acc) return id;
  }
  return Object.keys(mix)[0];
}

/** A morning field-round time on the given day, never in the future. */
function at(now: number, daysAgo: number, rand: () => number) {
  const day = new Date(now - daysAgo * DAY);
  day.setHours(7, 0, 0, 0);
  return Math.min(now - 60_000, day.getTime() + rand() * 4 * 3_600_000);
}

function scanRecord(
  diseaseId: string,
  timestamp: number,
  block: string,
  pos: { lat: number; lng: number } | null,
  plantId: number | null,
  rand: () => number,
): Omit<IssueRecord, 'id'> {
  const d = getDisease(diseaseId);
  return {
    diseaseId: d.id,
    diseaseName: d.name,
    severity: d.severity,
    confidence: d.id === 'unknown' ? 0.4 + rand() * 0.15 : 0.74 + rand() * 0.22,
    lat: pos?.lat ?? 0,
    lng: pos?.lng ?? 0,
    photoUri: DEMO_PHOTO,
    timestamp: Math.round(timestamp),
    notes: null,
    block,
    plantId,
    source: 'seed',
  };
}

async function seedFarm(center: { lat: number; lng: number }, now = Date.now()): Promise<void> {
  const rand = mulberry32(20261004);
  const issues: Omit<IssueRecord, 'id'>[] = [];
  const actions: Omit<ActionRecord, 'id'>[] = [];

  // Tagged trees and their stories. Numbers start after any trees the farmer
  // tagged themselves, so demo tags never collide with real ones.
  const tagBase = (await nextTagNumber()) - 1;
  const created: { id: number; block: string }[] = [];
  for (const t of TREES) {
    const tag = tagBase + t.tag;
    const layout = BLOCK_LAYOUT[t.block];
    const pos = offsetToLatLng(center, layout.east + t.east, layout.north + t.north);
    const firstDay = Math.max(...t.story.map((e) => e[0]));
    const plantId = await createPlant(`Tree ${tag}`, pos.lat, pos.lng, {
      tag,
      block: t.block,
      source: 'seed',
      createdAt: now - firstDay * DAY,
    });
    created.push({ id: plantId, block: t.block });
    for (const e of t.story) {
      const ts = at(now, e[0], rand);
      if (e.length === 2) {
        const jitter = offsetToLatLng(pos, (rand() - 0.5) * 3, (rand() - 0.5) * 3);
        issues.push(scanRecord(e[1], ts, t.block, jitter, plantId, rand));
      } else {
        // An hour after that morning's scan; "synced" so demo outcomes never reach the hub.
        actions.push({ type: e[1], plantId, block: t.block, issueId: null, diseaseId: e[2], timestamp: ts + 3_600_000, source: 'seed', synced: true });
      }
    }
  }

  // Untagged scans across the blocks (about 3 a week per block, a fuller round today).
  for (const block of Object.keys(BLOCK_LAYOUT)) {
    const layout = BLOCK_LAYOUT[block];
    for (let day = WEEKS * 7; day >= 0; day--) {
      const count = day === 0 ? 2 : rand() < 0.45 ? 1 : 0;
      for (let i = 0; i < count; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = Math.sqrt(rand()) * BLOCK_RADIUS_M;
        const pos = rand() > 0.08 ? offsetToLatLng(center, layout.east + Math.cos(angle) * dist, layout.north + Math.sin(angle) * dist) : null;
        issues.push(scanRecord(pick(BLOCK_MIX[block], rand()), at(now, day, rand), block, pos, null, rand));
      }
    }
  }

  // Watering and rain history (Block C ends overdue so the To Do list shows it).
  actions.push(...buildDemoWateringActions({ blocks: FIELD_BLOCKS, trees: created, now }));

  await insertIssues(issues);
  for (const a of actions) await logAction(a);
}

/** Seeds demo history when needed. Returns true when the data changed. */
export async function seedDemoDataIfEmpty(): Promise<boolean> {
  if (!SEED_DEMO_DATA) return false;

  if (DEMO_MODE) {
    const settings = await loadSettings();
    if (settings.seedVersion === SEED_VERSION) return false;
    // Replaces only rows marked as seed — the farmer's own scans are never touched.
    await deleteSeedData();
    await seedFarm(DEMO_FARM);
    await saveSettings({ seedVersion: SEED_VERSION });
    return true;
  }

  if ((await countIssues()) > 0) return false;
  const loc = await getQuickLocation(6000).catch(() => null);
  if (!loc) return false;
  await seedFarm({ lat: loc.coords.latitude, lng: loc.coords.longitude });
  return true;
}
