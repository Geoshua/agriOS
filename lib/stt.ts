/**
 * Speech-to-text layer.
 *
 * Records audio via expo-audio, transcribes via HuggingFace Whisper large-v3.
 * Supports 99+ languages including East African and East Asian languages.
 * Falls back gracefully when offline or when API key is absent.
 *
 * Usage (expo-audio only exposes recorders through a hook):
 *   const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
 *   await startRecording(recorder);
 *   const transcript = await stopAndTranscribe(recorder, 'sw'); // Swahili
 */

import {
  AudioRecorder,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';

// Same key as inference.ts — set it once there, it's used here too.
const HF_API_KEY = ''; // 'hf_your_token_here'
const WHISPER_API_URL = 'https://api-inference.huggingface.co/models/openai/whisper-large-v3';

export interface SpeechResult {
  text: string;
  language: string;
  isFallback: boolean; // true when offline or key not set
}

// Languages supported by Whisper large-v3, filtered to those relevant to the app's regions.
// Key: Whisper language code. Value: display name shown in picker.
export const SUPPORTED_LANGUAGES: Record<string, string> = {
  // Sub-Saharan Africa (coffee + food crop regions)
  sw: 'Swahili',
  am: 'Amharic',
  ha: 'Hausa',
  yo: 'Yoruba',
  ig: 'Igbo',
  lg: 'Luganda',
  rw: 'Kinyarwanda',
  ny: 'Chichewa',
  sn: 'Shona',
  zu: 'Zulu',
  xh: 'Xhosa',
  af: 'Afrikaans',
  so: 'Somali',
  // East Asian
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  vi: 'Vietnamese',
  tl: 'Filipino',
  th: 'Thai',
  // International / common aid-sector languages
  en: 'English',
  fr: 'French',
  pt: 'Portuguese',
  es: 'Spanish',
  ar: 'Arabic',
  hi: 'Hindi',
};

export const DEFAULT_LANGUAGE = 'sw';

export async function requestMicPermission(): Promise<boolean> {
  const { status } = await requestRecordingPermissionsAsync();
  return status === 'granted';
}

export async function startRecording(recorder: AudioRecorder): Promise<void> {
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  await recorder.prepareToRecordAsync();
  recorder.record();
}

export async function stopAndTranscribe(
  recorder: AudioRecorder,
  language: string = DEFAULT_LANGUAGE,
): Promise<SpeechResult> {
  await recorder.stop();
  await setAudioModeAsync({ allowsRecording: false });

  const uri = recorder.uri;
  if (!uri) return { text: '', language, isFallback: true };

  if (!HF_API_KEY) {
    return { text: '', language, isFallback: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    // HF ASR endpoint expects raw audio bytes
    const response = await fetch(uri);
    const audioBlob = await response.blob();

    const hfResponse = await fetch(WHISPER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'audio/m4a',
        'X-Wait-For-Model': 'true',
      },
      body: audioBlob,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!hfResponse.ok) return { text: '', language, isFallback: true };

    const data = (await hfResponse.json()) as { text?: string };
    const text = data.text?.trim() ?? '';
    return { text, language, isFallback: false };
  } catch {
    return { text: '', language, isFallback: true };
  }
}
