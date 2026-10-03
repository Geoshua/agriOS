import * as Location from 'expo-location';

/**
 * Best-effort position for tagging a logged issue, without stalling the UI.
 * Uses a recent last-known fix when available, otherwise a fresh fix capped
 * at `timeoutMs`. Resolves null when permission is denied or no fix arrives.
 */
export async function getQuickLocation(timeoutMs = 8000): Promise<Location.LocationObject | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;

  const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 }).catch(() => null);
  if (last) return last;

  return Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}
