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
import { buildDemoIssues } from './seed';

/** Smallholder coffee hills near Othaya, Nyeri County, Kenya. */
export const DEMO_CENTER = { lat: -0.5562, lng: 36.9446 };
export const DEMO_PLACE = 'Demo farm · Othaya, Nyeri';

export function buildDemoScenario(now = Date.now()) {
  const issues: IssueRecord[] = buildDemoIssues(DEMO_CENTER, now).map((issue, i) => ({ ...issue, id: -(i + 1) }));
  return { issues, regions: buildDemoRegions() };
}

/** Neighbouring villages, as the hub's /heatmap would report them (~10 km grid). */
function buildDemoRegions(): HeatmapRegion[] {
  // [km east, km north, counts]
  const villages: [number, number, Record<string, number>][] = [
    [0, 0, { coffee_leaf_rust: 34, healthy: 41, coffee_leaf_miner: 9, coffee_phoma: 6, unknown: 3 }],
    [11, 4, { coffee_leaf_rust: 52, healthy: 22, coffee_brown_eye: 7, unknown: 4 }],
    [-9, 8, { healthy: 63, coffee_leaf_miner: 12, coffee_brown_eye: 5 }],
    [-12, -6, { coffee_leaf_miner: 29, healthy: 25, coffee_phoma: 8, unknown: 2 }],
    [6, -11, { coffee_phoma: 21, healthy: 18, coffee_leaf_rust: 11, unknown: 3 }],
    [17, -3, { coffee_leaf_rust: 38, coffee_leaf_miner: 10, healthy: 14 }],
    [-3, 15, { healthy: 47, coffee_brown_eye: 9, coffee_leaf_rust: 6 }],
    [-18, 2, { coffee_brown_eye: 16, healthy: 19, coffee_leaf_miner: 6 }],
  ];
  const kmPerDegLng = 111.32 * Math.cos((DEMO_CENTER.lat * Math.PI) / 180);
  return villages.map(([east, north, counts]) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const dominant = Object.entries(counts)
      .filter(([id]) => id !== 'healthy' && id !== 'unknown')
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'healthy';
    return {
      lat: DEMO_CENTER.lat + north / 111.32,
      lng: DEMO_CENTER.lng + east / kmPerDegLng,
      dominant: counts.healthy > total / 2 ? 'healthy' : dominant,
      total,
      counts,
    };
  });
}
