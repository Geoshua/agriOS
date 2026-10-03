/**
 * Soil data layer — fetches pH and key nutrients by GPS coordinates.
 *
 * Data source: SoilGrids REST API (ISRIC, free, global coverage)
 * https://rest.soilgrids.org — returns soil properties for any lat/lon
 *
 * For Africa specifically, iSDAsoil (isda-africa.com) has higher resolution
 * but requires an account. SoilGrids is used here for offline-friendly caching
 * and zero-auth global coverage.
 *
 * Cached in SQLite via the store so repeated reads are free.
 */

export interface SoilProfile {
  ph: number;          // soil pH in water (0–14)
  nitrogen: number;    // total nitrogen g/kg
  carbon: number;      // organic carbon g/kg
  clay: number;        // clay content g/100g (%)
  latitude: number;
  longitude: number;
  fetchedAt: number;   // epoch ms
}

export interface SoilAdvisory {
  phStatus: 'low' | 'optimal' | 'high';
  phAdvice: string;
  generalAdvice: string;
}

import { LOCAL_SERVER_URL } from './config';

// Coffee prefers pH 6.0–6.5; cassava tolerates 5.5–6.5; beans 6.0–7.0
const COFFEE_PH_MIN = 6.0;
const COFFEE_PH_MAX = 6.5;

const BASE_URL = 'https://rest.soilgrids.org/query';

type SoilGridsResponse = {
  properties: {
    layers: Array<{
      name: string;
      depths: Array<{
        label: string;
        values: { mean: number | null };
      }>;
    }>;
  };
};

async function fetchFromLocalServer(lat: number, lon: number): Promise<SoilProfile | null> {
  if (!LOCAL_SERVER_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(
      `${LOCAL_SERVER_URL}/soil?lat=${lat}&lng=${lon}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (!data.ph) return null;
    return { ...data, fetchedAt: Date.now() } as SoilProfile;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export async function fetchSoilData(lat: number, lon: number): Promise<SoilProfile | null> {
  // Try local server first — it caches SoilGrids responses at 250 m resolution
  const cached = await fetchFromLocalServer(lat, lon);
  if (cached) return cached;

  const params = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    property: ['phh2o', 'nitrogen', 'soc', 'clay'].join(','),
    depth: '0-5cm',
    value: 'mean',
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    const res = await fetch(`${BASE_URL}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as SoilGridsResponse;
    const layers = data?.properties?.layers ?? [];

    function extractMean(name: string): number | null {
      const layer = layers.find(l => l.name === name);
      const depth = layer?.depths?.find(d => d.label === '0-5cm');
      return depth?.values?.mean ?? null;
    }

    const rawPh = extractMean('phh2o');
    if (rawPh === null) return null;

    // SoilGrids returns pH × 10 (e.g. 65 = pH 6.5)
    return {
      ph: rawPh / 10,
      nitrogen: (extractMean('nitrogen') ?? 0) / 100,
      carbon: (extractMean('soc') ?? 0) / 10,
      clay: (extractMean('clay') ?? 0) / 10,
      latitude: lat,
      longitude: lon,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function getSoilAdvisory(profile: SoilProfile): SoilAdvisory {
  const { ph } = profile;

  let phStatus: SoilAdvisory['phStatus'];
  let phAdvice: string;

  if (ph < COFFEE_PH_MIN) {
    phStatus = 'low';
    const deficit = (COFFEE_PH_MIN - ph).toFixed(1);
    phAdvice = `Soil pH is ${ph.toFixed(1)} — too acidic for coffee (ideal: 6.0–6.5). ` +
      `Apply agricultural lime at ~${Math.round(parseFloat(deficit) * 2)} t/ha to raise pH.`;
  } else if (ph > COFFEE_PH_MAX) {
    phStatus = 'high';
    phAdvice = `Soil pH is ${ph.toFixed(1)} — slightly alkaline. Add sulfur or acidifying fertiliser ` +
      `to lower pH toward 6.0–6.5.`;
  } else {
    phStatus = 'optimal';
    phAdvice = `Soil pH is ${ph.toFixed(1)} — optimal for coffee (6.0–6.5). No amendment needed.`;
  }

  const generalAdvice = profile.nitrogen < 1.5
    ? 'Nitrogen is low. Consider compost or urea top-dressing before the rainy season.'
    : 'Nitrogen level adequate.';

  return { phStatus, phAdvice, generalAdvice };
}
