/**
 * Community (regional) data: the hub's /heatmap aggregates, or the demo
 * villages, plus "which community am I part of" — the nearest region.
 *
 * Regions come from anonymised scans (GPS rounded to ~10 km by the hub), so
 * membership is approximate by design.
 */

import { LOCAL_SERVER_URL } from './config';
import { buildDemoScenario } from './demoScenario';
import type { HeatmapRegion } from '../components/map/MapParts';

const HEATMAP_TIMEOUT_MS = 8000;
/** A region within this distance counts as "your" community. */
export const COMMUNITY_RADIUS_KM = 15;

export interface RegionData {
  regions: HeatmapRegion[];
  total: number;
  villages: number;
}

/** Demo villages, or the hub's /heatmap. Resolves null when the hub is unreachable. */
export async function fetchRegions(demo: boolean, signal?: AbortSignal): Promise<RegionData | null> {
  if (demo) {
    const { regions } = buildDemoScenario();
    return { regions, total: regions.reduce((n, r) => n + r.total, 0), villages: regions.length };
  }
  const base = LOCAL_SERVER_URL || 'http://localhost:7384';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEATMAP_TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort());
  try {
    const res = await fetch(`${base}/heatmap`, { signal: controller.signal });
    const data = await res.json();
    return { regions: data.regions ?? [], total: data.total ?? 0, villages: data.villages ?? 0 };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export interface CommunityMatch {
  region: HeatmapRegion;
  distanceKm: number;
  /** True when within COMMUNITY_RADIUS_KM — otherwise it's only the closest one. */
  member: boolean;
}

/** The closest region to a point, or null when there are none. */
export function nearestCommunity(point: { lat: number; lng: number }, regions: HeatmapRegion[]): CommunityMatch | null {
  let best: CommunityMatch | null = null;
  for (const region of regions) {
    const d = distanceKm(point, region);
    if (!best || d < best.distanceKm) best = { region, distanceKm: d, member: d <= COMMUNITY_RADIUS_KM };
  }
  return best;
}
