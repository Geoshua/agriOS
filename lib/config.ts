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
