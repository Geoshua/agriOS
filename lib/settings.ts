/**
 * Persisted user settings — a small JSON file in the app's document folder.
 * Local only (no accounts, CLAUDE.md "No logins").
 */

import { File, Paths } from 'expo-file-system';

export interface Settings {
  /** Language of the spoken advisory (voice pack code from assets/voice-packs/catalog.json). */
  voiceLanguage: string;
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

export function saveSettings(settings: Settings): void {
  try {
    const file = settingsFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(settings));
  } catch {
    // Non-fatal: the choice just won't survive a restart.
  }
}
