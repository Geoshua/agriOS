/**
 * Tier 2: on-device TFLite classifier (MobileNetV2, INT8, trained by
 * scripts/model_training/train.py). Fully offline.
 *
 * Model files live in assets/model/ (gitignored). If they're missing, metro
 * resolves these requires to an empty module (see metro.config.js) and this
 * tier reports itself unavailable — the app falls through to the mock.
 *
 * Input:  [1, 224, 224, 3] RGB — float32 in [0, 1] (dynamic-range model, the
 *         default) or uint8 0–255 (full-INT8 model), per labels.json input_dtype.
 * Output: float32 [1, num_classes] softmax, index → id via labels.json.
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import type { TfliteModel } from 'react-native-fast-tflite';

/* eslint-disable @typescript-eslint/no-var-requires */
const MODEL_SOURCE: unknown = require('../assets/model/plant_disease.tflite');
const LABELS: { index_to_agrios_id?: Record<string, string>; input_size?: number; input_dtype?: 'float32' | 'uint8' } =
  require('../assets/model/labels.json');
/* eslint-enable @typescript-eslint/no-var-requires */

export const TFLITE_AVAILABLE = typeof MODEL_SOURCE === 'number' && !!LABELS?.index_to_agrios_id;

const SIZE = LABELS?.input_size ?? 224;

let model: TfliteModel | null = null;
let loading: Promise<TfliteModel | null> | null = null;

async function getModel(): Promise<TfliteModel | null> {
  if (!TFLITE_AVAILABLE) return null;
  if (model) return model;
  if (!loading) {
    loading = (async () => {
      try {
        const { loadTensorflowModel } = await import('react-native-fast-tflite');
        model = await loadTensorflowModel(MODEL_SOURCE as number, []); // [] = default CPU delegate
        return model;
      } catch (e) {
        console.warn('[tflite] load failed', e);
        return null;
      } finally {
        loading = null;
      }
    })();
  }
  return loading;
}

/**
 * Centre-crop to a square, resize to SIZE×SIZE and decode to packed RGB bytes.
 *
 * The crop matters: squashing a whole portrait camera frame into a square
 * distorts the leaf far more than training did (BRACOL photos are 2:1
 * landscape). Measured on an emulator frame of a rust leaf: whole frame →
 * rust 0.73; centre square → rust 0.96.
 */
async function toRgb(frameUri: string): Promise<Uint8Array> {
  const full = await ImageManipulator.manipulate(frameUri).renderAsync();
  const side = Math.min(full.width, full.height);
  const ref = await ImageManipulator.manipulate(full)
    .crop({ originX: Math.floor((full.width - side) / 2), originY: Math.floor((full.height - side) / 2), width: side, height: side })
    .resize({ width: SIZE, height: SIZE })
    .renderAsync();
  const small = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
  const file = new File(small.uri);
  const bytes = await file.bytes();
  try { file.delete(); } catch { /* temp file, best-effort */ }

  const { data, width, height } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return rgb;
}

/** Returns { diseaseId, confidence } or null if the tier is unavailable/failed. */
export async function classifyWithTflite(frameUri: string): Promise<{ diseaseId: string; confidence: number } | null> {
  const m = await getModel();
  if (!m) return null;
  try {
    const rgb = await toRgb(frameUri);
    const input = LABELS.input_dtype === 'uint8' ? rgb : Float32Array.from(rgb, (v) => v / 255);
    const [out] = await m.run([input.buffer as ArrayBuffer]);
    const probs = new Float32Array(out);
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
    return {
      diseaseId: LABELS.index_to_agrios_id?.[String(best)] ?? 'unknown',
      confidence: probs[best],
    };
  } catch (e) {
    console.warn('[tflite] inference failed', e);
    return null;
  }
}
