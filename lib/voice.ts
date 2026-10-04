/**
 * Spoken advisory playback — offline in every path.
 *
 *   1. Installed voice pack for the selected language (pre-recorded clip)
 *   2. Phone's own speech engine in that language, if the phone has a voice for it
 *   3. Phone's speech engine in English (always available)
 *
 * Kikuyu has no phone voice anywhere, so without its pack it falls to (3).
 */

import * as Speech from 'expo-speech';
import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import enScripts from '../assets/voice-packs/scripts/en.json';
import kikScripts from '../assets/voice-packs/scripts/kik.json';
import { getClip, getPackInfo } from './voicePacks';
import { useShambaStore } from './store';

const SCRIPTS: Record<string, Record<string, string>> = { en: enScripts, kik: kikScripts };

export interface PlaybackHandlers {
  /** Called once playback finishes, is stopped, or fails. */
  onDone?: () => void;
}

export interface PlaybackInfo {
  source: 'pack' | 'device';
  /** Language actually spoken (may be 'en' when falling back). */
  language: string;
  /** Exact clip length for packs; null for device speech (unknown ahead of time). */
  durationSec: number | null;
}

let player: AudioPlayer | null = null;
let deviceVoices: Promise<Speech.Voice[]> | null = null;

async function hasDeviceVoice(tag: string): Promise<boolean> {
  deviceVoices ??= Speech.getAvailableVoicesAsync().catch(() => []);
  const prefix = tag.split('-')[0].toLowerCase();
  return (await deviceVoices).some((v) => v.language.toLowerCase().startsWith(prefix));
}

/** Speaks the advisory for `diseaseId` in the selected language (or `languageOverride`, e.g. a settings preview). */
export async function playAdvisory(diseaseId: string, handlers: PlaybackHandlers = {}, languageOverride?: string): Promise<PlaybackInfo> {
  await stopAll();
  const language = languageOverride ?? useShambaStore.getState().voiceLanguage;

  // 1. Pre-recorded pack clip
  const clip = await getClip(language, diseaseId).catch(() => null);
  if (clip) {
    try {
      const p = createAudioPlayer({ uri: clip.uri });
      player = p;
      const sub = p.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          sub.remove();
          p.remove();
          if (player === p) player = null;
          handlers.onDone?.();
        }
      });
      p.play();
      return { source: 'pack', language, durationSec: clip.durationSec };
    } catch {
      // Corrupt clip — fall through to device speech.
    }
  }

  // 2 / 3. Phone speech engine
  const info = getPackInfo(language);
  const native = !!info?.deviceTts && (await hasDeviceVoice(info.deviceTts));
  const spoken = native ? language : 'en';
  const text = SCRIPTS[spoken]?.[diseaseId] ?? SCRIPTS.en[diseaseId] ?? SCRIPTS.en.unknown;
  Speech.speak(text, {
    language: native ? info!.deviceTts! : 'en-US',
    rate: 0.9,
    onDone: handlers.onDone,
    onStopped: handlers.onDone,
    onError: handlers.onDone,
  });
  return { source: 'device', language: spoken, durationSec: null };
}

export async function stopAll(): Promise<void> {
  if (player) {
    try {
      player.pause();
      player.remove();
    } catch {}
    player = null;
  }
  await Speech.stop();
}

/** Text that will be spoken for a disease in a language (for word-count timing estimates). */
export function scriptFor(language: string, diseaseId: string): string {
  return SCRIPTS[language]?.[diseaseId] ?? SCRIPTS.en[diseaseId] ?? '';
}
