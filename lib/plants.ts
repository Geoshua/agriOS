import { createPlant, findNearestPlant, getAllPlants, nextPlantName } from './db';
import { useShambaStore } from './store';

/** Scans within 5 m of a known plant are grouped with it. */
export const PLANT_MATCH_RADIUS_M = 5;

/**
 * Resolves which tracked plant a scan at (lat, lng) belongs to, creating a new
 * one ("Plant A", "Plant B", …) when none is within range. Returns nulls when
 * there's no GPS fix, since a plant can't be identified without a location.
 */
export async function assignPlant(lat: number, lng: number): Promise<{ plantId: number | null; plantName: string | null }> {
  if (lat === 0 && lng === 0) return { plantId: null, plantName: null };

  const nearest = await findNearestPlant(lat, lng, PLANT_MATCH_RADIUS_M);
  if (nearest) return { plantId: nearest.id, plantName: nearest.name };

  const name = nextPlantName((await getAllPlants()).length);
  const plantId = await createPlant(name, lat, lng);
  useShambaStore.getState().addPlant({ id: plantId, name, lat, lng, createdAt: Date.now() });
  return { plantId, plantName: name };
}
