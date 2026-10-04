/**
 * Soil data layer — pH and key nutrients for a GPS point, offline-first.
 *
 * Lookup order (first hit wins):
 *   1. Bundled local grid  assets/soil/local-grid.json — SoilGrids extract for
 *      the farm area only (~250 m cells, a few KB). Instant, no network.
 *   2. Phone cache         <documents>/soil-cache.json — the last few points
 *      fetched online, kept for offline reuse (capped, see CACHE_LIMIT).
 *   3. Co-op hub           GET /soil — shares one SoilGrids call per area.
 *   4. SoilGrids REST v2   ISRIC, internet required.
 * Network results are saved to the phone cache.
 *
 * Data: SoilGrids 2.0 (ISRIC, CC-BY 4.0) — modelled, ~250 m resolution, top
 * 0–5 cm. It may not reflect variation within a single farm (CLAUDE.md data
 * honesty). Rebuild the local grid with scripts/soil/build_local_grid.py.
 */

import { File, Paths } from 'expo-file-system';
import localGrid from '../assets/soil/local-grid.json';
import { LOCAL_SERVER_URL } from './config';

export type SoilSource = 'local' | 'cache' | 'hub' | 'soilgrids';

export interface SoilProfile {
  ph: number;          // soil pH in water (0–14)
  nitrogen: number;    // total nitrogen g/kg
  carbon: number;      // organic carbon g/kg
  clay: number;        // clay content %
  latitude: number;
  longitude: number;
  fetchedAt: number;   // epoch ms
  source: SoilSource;
}

export interface SoilAdvisory {
  phStatus: 'low' | 'optimal' | 'high';
  phAdvice: string;
  generalAdvice: string;
}

// Coffee prefers pH 6.0–6.5; cassava tolerates 5.5–6.5; beans 6.0–7.0
const COFFEE_PH_MIN = 6.0;
const COFFEE_PH_MAX = 6.5;

const SOILGRIDS_URL = 'https://rest.isric.org/soilgrids/v2.0/properties/query';
const CACHE_LIMIT = 30;

type Layer = (number | null)[][];
interface LocalGrid {
  west: number;
  north: number;
  cellLng: number;
  cellLat: number;
  rows: number;
  cols: number;
  layers: { phh2o: Layer; nitrogen: Layer; soc: Layer; clay: Layer };
}

// SoilGrids mapped units → app units (same conversions for grid, hub and REST).
function toProfile(raw: { phh2o: number; nitrogen?: number | null; soc?: number | null; clay?: number | null }, lat: number, lng: number, source: SoilSource): SoilProfile {
  return {
    ph: raw.phh2o / 10,
    nitrogen: (raw.nitrogen ?? 0) / 100,
    carbon: (raw.soc ?? 0) / 10,
    clay: (raw.clay ?? 0) / 10,
    latitude: lat,
    longitude: lng,
    fetchedAt: Date.now(),
    source,
  };
}

// ── 1. Bundled local grid ─────────────────────────────────────────────────────

/** Soil from the bundled grid, or null outside its area. Masked cells borrow the nearest neighbour. */
export function soilFromLocalGrid(lat: number, lng: number): SoilProfile | null {
  const g = localGrid as unknown as LocalGrid;
  const row = Math.floor((g.north - lat) / g.cellLat);
  const col = Math.floor((lng - g.west) / g.cellLng);
  if (row < 0 || col < 0 || row >= g.rows || col >= g.cols) return null;

  for (let ring = 0; ring <= 1; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        const r = row + dr;
        const c = col + dc;
        const ph = g.layers.phh2o[r]?.[c];
        if (ph == null) continue;
        return toProfile(
          { phh2o: ph, nitrogen: g.layers.nitrogen[r][c], soc: g.layers.soc[r][c], clay: g.layers.clay[r][c] },
          lat,
          lng,
          'local',
        );
      }
    }
  }
  return null;
}

// ── 2. Phone cache ────────────────────────────────────────────────────────────

const cacheFile = () => new File(Paths.document, 'soil-cache.json');
// ~110 m buckets — finer than the 250 m data, so neighbours share an entry.
const cacheKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
let cache: Record<string, SoilProfile> | null = null;

async function readCache(): Promise<Record<string, SoilProfile>> {
  if (cache) return cache;
  try {
    const file = cacheFile();
    cache = file.exists ? JSON.parse(await file.text()) : {};
  } catch {
    cache = {};
  }
  return cache!;
}

async function writeCache(profile: SoilProfile): Promise<void> {
  const entries = await readCache();
  entries[cacheKey(profile.latitude, profile.longitude)] = { ...profile, source: 'cache' };
  // Keep only the most recent points — local stats only, not a growing dataset.
  const kept = Object.entries(entries).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, CACHE_LIMIT);
  cache = Object.fromEntries(kept);
  try {
    const file = cacheFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(cache));
  } catch {
    // Non-fatal: the next lookup just goes to the network again.
  }
}

// ── 3. Hub / 4. SoilGrids ─────────────────────────────────────────────────────

async function fetchFromHub(lat: number, lng: number): Promise<SoilProfile | null> {
  if (!LOCAL_SERVER_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(`${LOCAL_SERVER_URL}/soil?lat=${lat}&lng=${lng}`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data.ph) return null;
    return { ph: data.ph, nitrogen: data.nitrogen, carbon: data.carbon, clay: data.clay, latitude: lat, longitude: lng, fetchedAt: Date.now(), source: 'hub' };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type SoilGridsResponse = {
  properties: { layers: Array<{ name: string; depths: Array<{ label: string; values: { mean: number | null } }> }> };
};

async function fetchFromSoilGrids(lat: number, lng: number): Promise<SoilProfile | null> {
  const params = new URLSearchParams({ lon: String(lng), lat: String(lat), depth: '0-5cm', value: 'mean' });
  for (const p of ['phh2o', 'nitrogen', 'soc', 'clay']) params.append('property', p);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${SOILGRIDS_URL}?${params}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    const layers = ((await res.json()) as SoilGridsResponse)?.properties?.layers ?? [];
    const mean = (name: string) => layers.find((l) => l.name === name)?.depths?.find((d) => d.label === '0-5cm')?.values?.mean ?? null;
    const ph = mean('phh2o');
    if (!ph) return null; // null or 0 = masked (water / built-up)
    return toProfile({ phh2o: ph, nitrogen: mean('nitrogen'), soc: mean('soc'), clay: mean('clay') }, lat, lng, 'soilgrids');
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** `offlineOnly`: bundled grid + phone cache only — instant, never touches the network. */
export async function fetchSoilData(lat: number, lng: number, opts: { offlineOnly?: boolean } = {}): Promise<SoilProfile | null> {
  const local = soilFromLocalGrid(lat, lng);
  if (local) return local;

  const cached = (await readCache())[cacheKey(lat, lng)];
  if (cached) return { ...cached, source: 'cache' };
  if (opts.offlineOnly) return null;

  const remote = (await fetchFromHub(lat, lng)) ?? (await fetchFromSoilGrids(lat, lng));
  if (remote) await writeCache(remote);
  return remote;
}

export const SOIL_SOURCE_LABEL: Record<SoilSource, string> = {
  local: 'Offline · farm soil map',
  cache: 'Offline · saved earlier',
  hub: 'Co-op hub',
  soilgrids: 'Internet',
};

export function getSoilAdvisory(profile: SoilProfile): SoilAdvisory {
  const { ph } = profile;

  let phStatus: SoilAdvisory['phStatus'];
  let phAdvice: string;

  if (ph < COFFEE_PH_MIN) {
    phStatus = 'low';
    // Heavier (clay-rich) soils resist pH change and need more lime. A rough
    // guide only — real rates need a soil test (buffer pH).
    const perUnit = profile.clay >= 35 ? 3 : profile.clay > 0 && profile.clay < 20 ? 1.5 : 2;
    const rate = Math.max(0.5, Math.round((COFFEE_PH_MIN - ph) * perUnit * 2) / 2);
    phAdvice = `Soil pH is ${ph.toFixed(1)} — too acidic for coffee (ideal 6.0–6.5). ` +
      `Liming helps: roughly ${rate} t/ha of agricultural lime as a first estimate — confirm the rate with a soil test or your extension officer.`;
  } else if (ph > COFFEE_PH_MAX) {
    phStatus = 'high';
    phAdvice = `Soil pH is ${ph.toFixed(1)} — slightly alkaline for coffee. Acidifying fertilisers (e.g. sulphate of ammonia) ` +
      `can bring it toward 6.0–6.5 over time; check with your extension officer.`;
  } else {
    phStatus = 'optimal';
    phAdvice = `Soil pH is ${ph.toFixed(1)} — good for coffee (6.0–6.5). No liming needed.`;
  }

  const generalAdvice = profile.nitrogen > 0 && profile.nitrogen < 1.5
    ? 'Nitrogen looks low. Compost or a nitrogen top-dressing before the rains would help.'
    : 'Nitrogen level looks adequate.';

  return { phStatus, phAdvice, generalAdvice };
}
