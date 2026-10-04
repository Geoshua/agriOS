/**
 * Tree tagging. Tagging is optional: every scan belongs to its block; a scan
 * can additionally be tied to a tagged tree ("Tree 7"), now or later.
 * GPS on budget phones drifts 5–15 m, so it only *suggests* the nearest tagged
 * tree — the farmer confirms.
 */

import { createPlant, getAllPlants, nextTagNumber, PlantRecord, setIssuePlant } from './db';
import { useShambaStore } from './store';

/** Tagged trees within this distance are offered as "nearest". */
export const SUGGEST_RADIUS_M = 25;

export function plantLabel(plant: Pick<PlantRecord, 'tag' | 'name'>): string {
  return plant.tag != null ? `Tree ${plant.tag}` : plant.name;
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface TreeSuggestion {
  plant: PlantRecord;
  distanceM: number | null;
  /** Within SUGGEST_RADIUS_M — offered first as "nearest". */
  near: boolean;
}

/** Tagged trees in the block, nearest first (all block trees, so a GPS miss is one tap away). */
export async function suggestTrees(block: string | null, lat: number, lng: number): Promise<TreeSuggestion[]> {
  const hasFix = lat !== 0 || lng !== 0;
  const trees = (await getAllPlants()).filter((p) => !block || p.block === block || p.block == null);
  return trees
    .map((plant) => {
      const d = hasFix ? distanceM({ lat, lng }, plant) : null;
      return { plant, distanceM: d, near: d != null && d <= SUGGEST_RADIUS_M };
    })
    .sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9) || (a.plant.tag ?? 0) - (b.plant.tag ?? 0));
}

function markTagged(issueId: number, label: string | null) {
  const store = useShambaStore.getState();
  const pending = store.pendingTag;
  if (pending?.issueId === issueId) store.setPendingTag({ ...pending, taggedAs: label });
  store.bumpData();
}

/** Tie a scan to an existing tree. */
export async function tagScan(issueId: number, plant: PlantRecord): Promise<void> {
  await setIssuePlant(issueId, plant.id);
  markTagged(issueId, plantLabel(plant));
}

/** Create the next numbered tree at the scan's position and tie the scan to it. */
export async function tagScanAsNewTree(issueId: number, block: string | null, lat: number, lng: number): Promise<PlantRecord> {
  // Tags are unique; retry with the next number if another tap took this one.
  for (let attempt = 0; ; attempt++) {
    const tag = await nextTagNumber();
    const name = `Tree ${tag}`;
    try {
      const id = await createPlant(name, lat, lng, { tag, block });
      await setIssuePlant(issueId, id);
      const plant: PlantRecord = { id, name, tag, block, lat, lng, createdAt: Date.now(), source: 'user' };
      useShambaStore.getState().addPlant(plant);
      markTagged(issueId, name);
      return plant;
    } catch (e) {
      // Retry only when another tap took this tag number (unique index).
      if (attempt >= 3 || !/UNIQUE/i.test(String((e as Error)?.message ?? e))) throw e;
    }
  }
}

export async function untagScan(issueId: number): Promise<void> {
  await setIssuePlant(issueId, null);
  markTagged(issueId, null);
}
