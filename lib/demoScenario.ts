/**
 * Demo map scenario — a rural coffee farm with seeded scan history, health
 * heat map and community (regional) data, for showing the map without GPS,
 * a hub server or real scans.
 *
 * Everything here is generated in memory and never written to the database,
 * so toggling the demo can't mix fake records into a farmer's real history.
 */

import type { IssueRecord } from './db';
import type { HeatmapRegion } from '../components/map/MapParts';
import { getDisease } from './inference';
import { BLOCK_LAYOUT, BLOCK_RADIUS_M, offsetToLatLng } from './demoFarm';

/** Smallholder coffee hills near Othaya, Nyeri County, Kenya. */
export const DEMO_CENTER = { lat: -0.5562, lng: 36.9446 };
export const DEMO_PLACE = 'Demo farm · Othaya, Nyeri';

const DAYS = 21;

/** Disease mix per block for the in-memory scan history. */
const BLOCK_MIX: Record<string, Record<string, number>> = {
  A: { coffee_leaf_rust: 0.5, coffee_leaf_miner: 0.1, coffee_phoma: 0.1, healthy: 0.25, unknown: 0.05 },
  B: { healthy: 0.7, coffee_brown_eye: 0.15, coffee_leaf_miner: 0.15 },
  C: { coffee_leaf_miner: 0.35, coffee_phoma: 0.25, healthy: 0.25, coffee_brown_eye: 0.1, unknown: 0.05 },
  D: { healthy: 0.85, coffee_brown_eye: 0.15 },
};

const NOTES = [
  'Spots mostly on the lower branches.',
  'Neighbouring trees look the same.',
  'Leaves dropping after last week’s rain.',
  'Sprayed copper on Monday — checking again.',
  'Only on the shaded side of the row.',
  'Young trees, first time seeing this.',
];

/** Small deterministic PRNG so the demo field looks the same every time. */
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

/**
 * ~3 weeks of scan history laid out over the four blocks around `center`.
 * In-memory only (the database seeder in lib/seed.ts is separate and persists).
 */
function buildDemoIssues(center: { lat: number; lng: number }, now: number): Omit<IssueRecord, 'id'>[] {
  const rand = mulberry32(20261004);
  const blocks = Object.keys(BLOCK_LAYOUT);
  const issues: Omit<IssueRecord, 'id'>[] = [];

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (let day = DAYS - 1; day >= 0; day--) {
    const dayStart = today.getTime() - day * 86_400_000;
    // Busier in the last few days; today gets a full morning round.
    const count = day === 0 ? 9 + Math.floor(rand() * 5) : 2 + Math.floor(rand() * (day < 7 ? 6 : 4));

    for (let i = 0; i < count; i++) {
      // Field rounds between 06:30 and 17:30; skip anything later than now.
      const timestamp = dayStart + (6.5 + rand() * 11) * 3_600_000;
      if (timestamp > now) continue;

      const block = blocks[Math.floor(rand() * blocks.length)];
      const layout = BLOCK_LAYOUT[block];
      const disease = getDisease(pick(BLOCK_MIX[block], rand()));
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * BLOCK_RADIUS_M;
      const hasFix = rand() > 0.08;
      const pos = offsetToLatLng(center, layout.east + Math.cos(angle) * dist, layout.north + Math.sin(angle) * dist);

      issues.push({
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence: disease.id === 'unknown' ? 0.4 + rand() * 0.2 : 0.72 + rand() * 0.25,
        lat: hasFix ? pos.lat : 0,
        lng: hasFix ? pos.lng : 0,
        photoUri: null,
        timestamp: Math.round(timestamp),
        notes: disease.id !== 'healthy' && rand() < 0.25 ? NOTES[Math.floor(rand() * NOTES.length)] : null,
        block,
        plantId: null,
      });
    }
  }
  return issues.sort((a, b) => a.timestamp - b.timestamp);
}

export function buildDemoScenario(now = Date.now()) {
  const issues: IssueRecord[] = buildDemoIssues(DEMO_CENTER, now).map((issue, i) => ({ ...issue, id: -(i + 1) }));
  return { issues, regions: buildDemoRegions() };
}

/** Neighbouring villages, as the hub's /heatmap would report them (~10 km grid). */
function buildDemoRegions(): HeatmapRegion[] {
  // [name, km east, km north, counts] — place names are real localities around Othaya; counts are invented
  const villages: [string, number, number, Record<string, number>][] = [
    ['Gatugi', 1.6, -1.1, { coffee_leaf_rust: 34, healthy: 41, coffee_leaf_miner: 9, coffee_phoma: 6, unknown: 3 }],
    ['Othaya town', 11, 4, { coffee_leaf_rust: 52, healthy: 22, coffee_brown_eye: 7, unknown: 4 }],
    ['Karima', -9, 8, { healthy: 63, coffee_leaf_miner: 12, coffee_brown_eye: 5 }],
    ['Iria-ini', -12, -6, { coffee_leaf_miner: 29, healthy: 25, coffee_phoma: 8, unknown: 2 }],
    ['Mahiga', 6, -11, { coffee_phoma: 21, healthy: 18, coffee_leaf_rust: 11, unknown: 3 }],
    ['Chinga', 17, -3, { coffee_leaf_rust: 38, coffee_leaf_miner: 10, healthy: 14 }],
    ['Kagicha', -3, 15, { healthy: 47, coffee_brown_eye: 9, coffee_leaf_rust: 6 }],
    ['Thuti', -18, 2, { coffee_brown_eye: 16, healthy: 19, coffee_leaf_miner: 6 }],
  ];
  const kmPerDegLng = 111.32 * Math.cos((DEMO_CENTER.lat * Math.PI) / 180);
  return villages.map(([name, east, north, counts]) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const dominant = Object.entries(counts)
      .filter(([id]) => id !== 'healthy' && id !== 'unknown')
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'healthy';
    return {
      name,
      lat: DEMO_CENTER.lat + north / 111.32,
      lng: DEMO_CENTER.lng + east / kmPerDegLng,
      dominant: counts.healthy > total / 2 ? 'healthy' : dominant,
      total,
      counts,
    };
  });
}
