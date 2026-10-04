/**
 * Inference layer.
 *
 * Priority:
 *   0. Local agriOS server (LAN, fastest, no API key on phone)
 *      Run: HF_API_KEY=hf_xxx node server/server.mjs  — prints its LAN IPs on start
 *      Set LOCAL_SERVER_URL in lib/config.ts to one of those IPs.
 *   1. HuggingFace Qwen2-VL API (online, natural language output)
 *   2. TFLite MobileNetV2 on-device (offline, when model file present — see comments)
 *   3. Mock (always works, cycles through classes deterministically)
 *
 * To switch modes:
 *   - Local server (tier 0): set LOCAL_SERVER_URL in lib/config.ts
 *   - HF online (tier 1): set HF_API_KEY below
 *   - TFLite (tier 2): train (TRAINING.md), copy files into assets/model/ — auto-detected
 *   - Mock: default, no config needed
 */

import { File } from 'expo-file-system';
import diseasesData from '../assets/diseases.json';
import { LOCAL_SERVER_URL } from './config';
import { classifyWithTflite } from './tflite';

export interface InferenceResult {
  diseaseId: string;
  confidence: number;
  isMock: boolean;
  reasoning?: string;
  source?: 'local-server' | 'hf' | 'local-tflite' | 'mock';
  /**
   * Lesion locations for the AR overlay, normalised to the frame (0–1).
   * Only set by models that localise spots; classifiers leave it undefined.
   */
  spots?: Spot[];
}

export interface Spot {
  x: number;      // centre, 0–1 across the frame
  y: number;      // centre, 0–1 down the frame
  radius: number; // 0–1 relative to frame width
}

const DISEASE_CLASSES = diseasesData.classes;
const CONFIDENCE_THRESHOLD = diseasesData.confidenceThreshold;

// ── HF API CONFIG ────────────────────────────────────────────────────────────
// Get a free token: https://huggingface.co/settings/tokens → New token → Read
// Leave empty to skip online inference and use mock.
const HF_API_KEY = ''; // 'hf_your_token_here'
const HF_MODEL = 'Qwen/Qwen2-VL-7B-Instruct';
const HF_API_URL = 'https://api-inference.huggingface.co/v1/chat/completions';

const CLASSIFICATION_PROMPT = `You are an expert agronomist specialising in coffee crop disease.

Examine this image and classify it into EXACTLY one of these disease categories:
- coffee_leaf_rust (orange/yellow powdery spots, Hemileia vastatrix)
- coffee_leaf_miner (pale serpentine trails, Leucoptera coffeella)
- coffee_phoma (dark brown circular lesions, Phoma tarda)
- coffee_brown_eye (brown centre + yellow halo circles, Cercospora coffeicola)
- healthy (no visible disease)

Respond ONLY with this JSON, nothing else:
{"disease_id":"<id>","confidence":<0.0-1.0>,"reasoning":"<one sentence>"}`;

// ── TIER 0: Local LAN server ──────────────────────────────────────────────────

async function runLocalServerInference(
  frameUri: string,
  location?: { lat: number; lng: number },
): Promise<InferenceResult | null> {
  if (!LOCAL_SERVER_URL) return null;

  let base64: string;
  try {
    // SDK 57: the legacy readAsStringAsync throws at runtime — use the File API.
    base64 = await new File(frameUri).base64();
  } catch {
    return null;
  }

  const controller = new AbortController();
  // 3-second timeout — LAN should respond fast; miss it and fall through to HF
  const timeout = setTimeout(() => controller.abort(), 3_000);

  try {
    const body: Record<string, unknown> = { image: base64, mimeType: 'image/jpeg' };
    if (location) { body.lat = location.lat; body.lng = location.lng; }

    const response = await fetch(`${LOCAL_SERVER_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json() as any;

    const diseaseId = DISEASE_CLASSES.includes(data.diseaseId)
      ? (data.confidence >= CONFIDENCE_THRESHOLD ? data.diseaseId : 'unknown')
      : 'unknown';

    return {
      diseaseId,
      confidence: data.confidence ?? 0.7,
      isMock: false,
      reasoning: data.reasoning,
      source: 'local-server',
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── TIER 1: HF Qwen2-VL (online) ─────────────────────────────────────────────

async function runHFInference(frameUri: string): Promise<InferenceResult | null> {
  if (!HF_API_KEY) return null;

  let base64: string;
  try {
    // SDK 57: the legacy readAsStringAsync throws at runtime — use the File API.
    base64 = await new File(frameUri).base64();
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: HF_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            { type: 'text', text: CLASSIFICATION_PROMPT },
          ],
        }],
        max_tokens: 150,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json() as any;
    const content: string = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      disease_id: string;
      confidence: number;
      reasoning: string;
    };

    const diseaseId = DISEASE_CLASSES.includes(parsed.disease_id)
      ? (parsed.confidence >= CONFIDENCE_THRESHOLD ? parsed.disease_id : 'unknown')
      : 'unknown';

    return {
      diseaseId,
      confidence: parsed.confidence ?? 0.7,
      isMock: false,
      reasoning: parsed.reasoning,
      source: 'hf',
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── TIER 3: Mock cycling ──────────────────────────────────────────────────────

// Never includes 'other_disease' / 'no_leaf' — those only come from a real model.
const MOCK_DISTRIBUTION: Record<string, number> = {
  coffee_leaf_rust: 0.30,
  coffee_leaf_miner: 0.20,
  coffee_phoma: 0.15,
  coffee_brown_eye: 0.10,
  healthy: 0.20,
  unknown: 0.05,
};

let mockIndex = 0;

async function runMockInference(): Promise<InferenceResult> {
  const classes = Object.keys(MOCK_DISTRIBUTION);
  const diseaseId = classes[mockIndex % classes.length];
  mockIndex++;
  const baseConfidence = MOCK_DISTRIBUTION[diseaseId];
  const confidence = Math.min(0.99, baseConfidence + (Math.random() * 0.3 - 0.1));
  await new Promise(res => setTimeout(res, 80));
  const finalId = confidence < CONFIDENCE_THRESHOLD ? 'unknown' : diseaseId;
  return {
    diseaseId: finalId,
    confidence,
    isMock: true,
    source: 'mock',
    spots: finalId === 'healthy' || finalId === 'unknown' ? [] : mockSpots(),
  };
}

// Clustered lesions around the centre of the frame, like the design's AR view.
function mockSpots(): Spot[] {
  const count = 3 + Math.floor(Math.random() * 4);
  const cx = 0.5 + (Math.random() - 0.5) * 0.1;
  const cy = 0.52 + (Math.random() - 0.5) * 0.1;
  return Array.from({ length: count }, () => ({
    x: cx + (Math.random() - 0.5) * 0.4,
    y: cy + (Math.random() - 0.5) * 0.36,
    radius: 0.035 + Math.random() * 0.05,
  }));
}

// ── Tier 2: Cloud offload (via local server proxy) ────────────────────────────
// Called when the result is 'unknown' and user taps "Ask regional network".
// The local server proxies to the cloud's larger model — phone never needs cloud credentials.
// Long timeout (35s) — only triggered by explicit user action, not the auto-inference loop.

export async function runCloudOffload(frameUri: string): Promise<InferenceResult | null> {
  if (!LOCAL_SERVER_URL) return null;

  let base64: string;
  try {
    // SDK 57: the legacy readAsStringAsync throws at runtime — use the File API.
    base64 = await new File(frameUri).base64();
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  try {
    const response = await fetch(`${LOCAL_SERVER_URL}/offload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mimeType: 'image/jpeg' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json() as any;

    const diseaseId = DISEASE_CLASSES.includes(data.diseaseId)
      ? (data.confidence >= CONFIDENCE_THRESHOLD ? data.diseaseId : 'unknown')
      : 'unknown';

    return {
      diseaseId,
      confidence: data.confidence ?? 0.5,
      isMock: false,
      reasoning: data.reasoning,
      source: 'local-server', // came through local server proxy → cloud
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── Advisory: fetch LLM-generated advice from server ─────────────────────────
// Calls server /advisory (Ollama local LLM → HF fallback).
// Returns null if server unavailable — caller falls back to diseases.json text.

export async function fetchAdvisory(params: {
  diseaseId: string;
  confidence: number;
  soilPh?: number;
  notes?: string;
  language?: string;
}): Promise<string | null> {
  if (!LOCAL_SERVER_URL) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  try {
    const response = await fetch(`${LOCAL_SERVER_URL}/advisory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json() as any;
    return data.advice ?? null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

export async function runInference(
  frameUri: string,
  location?: { lat: number; lng: number },
): Promise<InferenceResult> {
  // Tier 0: Local LAN server (fastest, keeps API key off the phone)
  const localResult = await runLocalServerInference(frameUri, location);
  if (localResult) return localResult;

  // Tier 1: HF online inference
  const hfResult = await runHFInference(frameUri);
  if (hfResult) return hfResult;

  // Tier 2: TFLite on-device (offline). Same threshold rule as every tier.
  const tflite = await classifyWithTflite(frameUri);
  if (tflite) {
    const confident = tflite.confidence >= CONFIDENCE_THRESHOLD && DISEASE_CLASSES.includes(tflite.diseaseId);
    return {
      diseaseId: confident ? tflite.diseaseId : 'unknown',
      confidence: tflite.confidence,
      isMock: false,
      source: 'local-tflite',
    };
  }

  // Tier 3: Mock cycling (always works)
  return runMockInference();

  // NOTE: Cloud offload (Tier 2) is NOT in this loop — it's slow (35s) and
  // should only be triggered by explicit user action ("Ask regional network")
  // from AdvisorySheet when the result is 'unknown'. Call runCloudOffload() there.
}

// ── REAL TFLITE IMPLEMENTATION ────────────────────────────────────────────────
// Uncomment when plant_disease.tflite + labels.json are in assets/model/
// Run train_colab.py in Google Colab first to generate the model.
//
// Install deps: npx expo install @tensorflow/tfjs @tensorflow/tfjs-react-native
//
// import * as tf from '@tensorflow/tfjs';
// import '@tensorflow/tfjs-react-native';
// import labelsData from '../assets/model/labels.json';
//
// type LabelsJson = {
//   index_to_agrios_id: Record<string, string>;
//   input_size: number;
//   confidence_threshold: number;
// };
//
// let interpreter: tf.GraphModel | null = null;
// let ready: Promise<tf.GraphModel> | null = null;
// const labels = labelsData as LabelsJson;
//
// async function loadModel(): Promise<tf.GraphModel> {
//   if (interpreter) return interpreter;
//   if (!ready) {
//     ready = (async () => {
//       await tf.ready();
//       const m = await tf.loadGraphModel(require('../assets/model/plant_disease.tflite'));
//       interpreter = m;
//       return m;
//     })();
//   }
//   return ready;
// }
//
// async function runTFLiteInference(frameUri: string): Promise<InferenceResult> {
//   const model = await loadModel();
//   const imgSize = labels.input_size ?? 224;
//   const threshold = labels.confidence_threshold ?? CONFIDENCE_THRESHOLD;
//   const indexMap = labels.index_to_agrios_id;
//
//   const b64 = await FileSystem.readAsStringAsync(frameUri, { encoding: FileSystem.EncodingType.Base64 });
//   const raw = tf.util.encodeString(b64, 'base64') as Uint8Array;
//   const decoded = tf.node.decodeImage(raw, 3) as tf.Tensor3D;
//   const resized = tf.image.resizeBilinear(decoded, [imgSize, imgSize]);
//   const batched = resized.expandDims(0);
//   const input = batched.cast('int32');
//
//   const predictions = model.predict(input) as tf.Tensor2D;
//   const scores = await predictions.data() as Float32Array;
//   tf.dispose([decoded, resized, batched, input, predictions]);
//
//   const maxIdx = scores.indexOf(Math.max(...scores));
//   const confidence = scores[maxIdx];
//   const diseaseId = indexMap[String(maxIdx)] ?? 'unknown';
//
//   return {
//     diseaseId: confidence < threshold ? 'unknown' : diseaseId,
//     confidence,
//     isMock: false,
//   };
// }

export function getDisease(diseaseId: string) {
  return (diseasesData.diseases as any)[diseaseId] ?? diseasesData.diseases.unknown;
}
