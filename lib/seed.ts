/**
 * Demo data seeder — fills an empty database with ~3 weeks of realistic scan
 * history across four field blocks, so the map, health heat map and report
 * have something to show before anyone has scanned.
 *
 * Runs once, only when the issues table is empty. Points are laid out around
 * the phone's location (or a coffee farm in Kiambu, Kenya, without GPS).
 * Set SEED_DEMO_DATA = false to ship without it.
 */

import { countIssues, insertIssues, IssueRecord } from './db';
import { getDisease } from './inference';
import { getQuickLocation } from './location';

export const SEED_DEMO_DATA = true;

const FALLBACK_CENTER = { lat: -1.1714, lng: 36.8356 }; // Kiambu coffee belt
const DAYS = 21;

/** Each block has a centre offset (metres east/north) and a disease mix. */
const BLOCKS: { block: string; east: number; north: number; mix: Record<string, number> }[] = [
  { block: 'A', east: -80, north: 65, mix: { coffee_leaf_rust: 0.5, coffee_leaf_miner: 0.1, coffee_phoma: 0.1, healthy: 0.25, unknown: 0.05 } },
  { block: 'B', east: 80, north: 70, mix: { healthy: 0.7, coffee_brown_eye: 0.15, coffee_leaf_miner: 0.15 } },
  { block: 'C', east: -75, north: -70, mix: { coffee_leaf_miner: 0.35, coffee_phoma: 0.25, healthy: 0.25, coffee_brown_eye: 0.1, unknown: 0.05 } },
  { block: 'D', east: 85, north: -65, mix: { healthy: 0.85, coffee_brown_eye: 0.15 } },
];
const BLOCK_RADIUS_M = 45;

const NOTES = [
  'Spots mostly on the lower branches.',
  'Neighbouring trees look the same.',
  'Leaves dropping after last week’s rain.',
  'Sprayed copper on Monday — checking again.',
  'Only on the shaded side of the row.',
  'Young trees, first time seeing this.',
];

/** Small deterministic PRNG so the demo field looks the same on every install. */
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

export function buildDemoIssues(center: { lat: number; lng: number }, now = Date.now()): Omit<IssueRecord, 'id'>[] {
  const rand = mulberry32(20261004);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((center.lat * Math.PI) / 180);
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

      const b = BLOCKS[Math.floor(rand() * BLOCKS.length)];
      const disease = getDisease(pick(b.mix, rand()));
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * BLOCK_RADIUS_M;
      const east = b.east + Math.cos(angle) * dist;
      const north = b.north + Math.sin(angle) * dist;
      const hasFix = rand() > 0.08;

      issues.push({
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence: disease.id === 'unknown' ? 0.4 + rand() * 0.2 : 0.72 + rand() * 0.25,
        lat: hasFix ? center.lat + north / mPerDegLat : 0,
        lng: hasFix ? center.lng + east / mPerDegLng : 0,
        photoUri: null,
        timestamp: Math.round(timestamp),
        notes: disease.id !== 'healthy' && rand() < 0.25 ? NOTES[Math.floor(rand() * NOTES.length)] : null,
        block: b.block,
      });
    }
  }
  return issues.sort((a, b) => a.timestamp - b.timestamp);
}

/** Seeds demo history if the database is empty. Returns true when it seeded. */
export async function seedDemoDataIfEmpty(): Promise<boolean> {
  if (!SEED_DEMO_DATA) return false;
  if ((await countIssues()) > 0) return false;
  const loc = await getQuickLocation(6000).catch(() => null);
  const center = loc ? { lat: loc.coords.latitude, lng: loc.coords.longitude } : FALLBACK_CENTER;
  await insertIssues(buildDemoIssues(center));
  return true;
}
