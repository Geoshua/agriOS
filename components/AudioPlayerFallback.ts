/**
 * Fallback TTS using expo-speech (on-device, no API key, works offline).
 * Swap this in if audio MP3s aren't generated yet.
 * Usage: import { playAdvisory, stopAll } from './AudioPlayerFallback'
 */

import * as Speech from 'expo-speech';
import diseasesData from '../assets/diseases.json';

export interface PlaybackHandlers {
  /** Called once speech finishes, is stopped, or fails. */
  onDone?: () => void;
}

export async function playAdvisory(diseaseId: string, handlers: PlaybackHandlers = {}): Promise<void> {
  const disease = (diseasesData.diseases as any)[diseaseId];
  if (!disease) return;

  await Speech.stop();

  const text = [
    disease.name + ' detected.',
    disease.description,
    'Do this now:',
    disease.immediateAction,
    disease.treatment ?? '',
  ].filter(Boolean).join(' ');

  Speech.speak(text, {
    language: 'en-US',
    rate: 0.9,
    pitch: 1.0,
    onDone: handlers.onDone,
    onStopped: handlers.onDone,
    onError: handlers.onDone,
  });
}

export async function stopAll(): Promise<void> {
  await Speech.stop();
}
