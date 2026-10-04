/**
 * Persisted user settings — a small JSON file in the app's document folder.
 * Local only (no accounts, CLAUDE.md "No logins").
 */

import { File, Paths } from 'expo-file-system';

export interface Settings {
  /** Language of the spoken advisory (voice pack code from assets/voice-packs/catalog.json). */
  voiceLanguage: string;
  /** Demo history version last seeded (lib/seed.ts SEED_VERSION). */
  seedVersion?: number;
  /** Random anonymous id sent with outcome stats so the hub can count farms. Never tied to a person. */
  farmId?: string;
}

// Deployment language for Noor (CLAUDE.md: never default to English only).
export const DEFAULT_SETTINGS: Settings = { voiceLanguage: 'kik' };

const settingsFile = () => new File(Paths.document, 'settings.json');

export async function loadSettings(): Promise<Settings> {
  try {
    const file = settingsFile();
    if (!file.exists) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await file.text()) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Writes are chained so concurrent saves (seed version, farm id, language)
// can't overwrite each other.
let writeChain: Promise<void> = Promise.resolve();

/** Merges `patch` into the saved settings (other keys are kept). */
export function saveSettings(patch: Partial<Settings>): Promise<void> {
  writeChain = writeChain.then(() => writeMerged(patch));
  return writeChain;
}

async function writeMerged(patch: Partial<Settings>): Promise<void> {
  try {
    const next = { ...(await loadSettings()), ...patch };
    const file = settingsFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(next));
  } catch {
    // Non-fatal: the choice just won't survive a restart.
  }
}
