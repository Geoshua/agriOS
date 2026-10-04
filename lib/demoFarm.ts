/**
 * Layout of the demo farm (DEMO_FARM in lib/config.ts): four coffee blocks
 * around the farm centre. Used by the seeder and, in demo mode, to place newly
 * logged scans inside the block the farmer selected instead of at real GPS.
 */

import { DEMO_FARM } from './config';

/** Block centres as metre offsets east/north of the farm centre. */
export const BLOCK_LAYOUT: Record<string, { east: number; north: number }> = {
  A: { east: -80, north: 65 },
  B: { east: 80, north: 70 },
  C: { east: -75, north: -70 },
  D: { east: 85, north: -65 },
};
export const BLOCK_RADIUS_M = 45;

/** Converts a metre offset from `center` into lat/lng. */
export function offsetToLatLng(center: { lat: number; lng: number }, east: number, north: number) {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  return { lat: center.lat + north / mPerDegLat, lng: center.lng + east / mPerDegLng };
}

/** A random spot inside `block` on the demo farm (falls back to the farm centre area). */
export function demoPositionInBlock(block: string, rand: () => number = Math.random) {
  const b = BLOCK_LAYOUT[block] ?? { east: 0, north: 0 };
  const angle = rand() * Math.PI * 2;
  const dist = Math.sqrt(rand()) * BLOCK_RADIUS_M;
  return offsetToLatLng(DEMO_FARM, b.east + Math.cos(angle) * dist, b.north + Math.sin(angle) * dist);
}

/** Rough distance in km — enough to tell "on the demo farm" from "somewhere else". */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (a.lat - b.lat) * 111.32;
  const dLng = (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}
