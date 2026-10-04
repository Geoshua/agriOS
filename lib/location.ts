import * as Location from 'expo-location';
import { DEMO_MODE } from './config';
import { demoPositionInBlock } from './demoFarm';
import { useShambaStore } from './store';

/**
 * Best-effort position for tagging a logged issue, without stalling the UI.
 * Uses a recent last-known fix when available, otherwise a fresh fix capped
 * at `timeoutMs`. Resolves null when permission is denied or no fix arrives.
 *
 * Demo mode: returns a point inside the selected block of the Kiambu demo farm
 * instead of real GPS, so new scans land next to the demo history.
 */
export async function getQuickLocation(timeoutMs = 8000): Promise<Location.LocationObject | null> {
  if (DEMO_MODE) return demoLocation();

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;

  const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 }).catch(() => null);
  if (last) return last;

  return Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

function demoLocation(): Location.LocationObject {
  const { lat, lng } = demoPositionInBlock(useShambaStore.getState().activeBlock);
  return {
    timestamp: Date.now(),
    mocked: true,
    coords: { latitude: lat, longitude: lng, altitude: null, accuracy: 5, altitudeAccuracy: null, heading: null, speed: null },
  };
}
