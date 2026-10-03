/**
 * Inference layer.
 *
 * Priority:
 *   1. HuggingFace Qwen2-VL API (online, natural language output)
 *   2. TFLite MobileNetV2 on-device (offline, when model file present — see comments)
 *   3. Mock (always works, cycles through classes deterministically)
 *
 * To switch modes:
 *   - HF online: set HF_API_KEY below (free at huggingface.co/settings/tokens)
 *   - TFLite: uncomment the TFLITE section, place model in assets/model/
 *   - Mock: default, no config needed
 */

import { File } from 'expo-file-system';
import diseasesData from '../assets/diseases.json';

export interface InferenceResult {
  diseaseId: string;
  confidence: number;
  isMock: boolean;
  reasoning?: string;
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

// ── ONLINE: HF Qwen2-VL ───────────────────────────────────────────────────────

async function runHFInference(frameUri: string): Promise<InferenceResult | null> {
  if (!HF_API_KEY) return null;

  let base64: string;
  try {
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
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── MOCK IMPLEMENTATION ───────────────────────────────────────────────────────

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

// ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

export async function runInference(frameUri: string): Promise<InferenceResult> {
  // Try HF online inference first
  const hfResult = await runHFInference(frameUri);
  if (hfResult) return hfResult;

  // Fall back to mock
  return runMockInference();
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
