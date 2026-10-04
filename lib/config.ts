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
 * ON_DEVICE_LLM_ROUTER — let the on-device Qwen3-0.6B route free-text
 * questions the keyword matcher can't place (lib/advisor.ts, lib/localLlm.ts).
 * Off by default: on an unseen test set it added 1 correct answer but 2 wrong
 * ones (TRAINING.md → "On-device LLM"). Turn on to experiment; the model is an
 * opt-in ~382 MB download either way.
 */
export const ON_DEVICE_LLM_ROUTER = false;
