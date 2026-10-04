/**
 * Shared runtime config.
 *
 * LOCAL_SERVER_URL — set to the LAN address printed when `node server/server.mjs` starts.
 * Example: 'http://192.168.1.42:7384'
 * Leave empty to skip local server and go straight to HF APIs.
 *
 * How to find the server's LAN IP:
 *   Linux/RPi:  hostname -I
 *   macOS:      ipconfig getifaddr en0
 *   Windows:    ipconfig
 */
export const LOCAL_SERVER_URL = ''; // e.g. 'http://192.168.1.42:7384'
export const CLOUD_SERVER_URL = ''; // e.g. 'https://agrios.example.com'

/**
 * Internet fallback for voice-pack downloads, used when the co-op hub isn't
 * reachable. Points at the packs committed under server/voice-packs/ in the
 * repo (works while the repository is public). Leave empty to download from
 * the hub only.
 */
export const VOICE_PACK_BASE_URL = 'https://raw.githubusercontent.com/Geoshua/agriOS/main/server/voice-packs';

/**
 * Demo mode: the whole app behaves as if the phone stands on Noor's farm in
 * Kiambu, Central Kenya — seeded history, the map, newly logged scans and soil
 * data all use DEMO_FARM instead of real GPS. Turn off for field use.
 * Keep DEMO_FARM in sync with scripts/soil/build_local_grid.py.
 */
export const DEMO_MODE = true;
export const DEMO_FARM = { lat: -1.1714, lng: 36.8356, name: 'Kiambu demo farm' };
