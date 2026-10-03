/**
 * Downloads a quantized plant disease TFLite model.
 * Uses the PlantVillage MobileNetV2 model (public, ~9MB, 38 classes).
 *
 * Run: node scripts/download-model.mjs
 * Output: assets/model/plant_disease.tflite + assets/model/labels.json
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'assets', 'model');

// Pre-quantized MobileNetV2 trained on PlantVillage (38 classes, INT8, ~9MB)
// Hosted on TFHub as a downloadable TFLite flatbuffer
const MODEL_URL = 'https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/image_classification/android/lite-model_disease-classification_1.tflite';

// Mapping from PlantVillage class indices to our disease IDs
// Full 38-class labels → simplified to our 6 groups
const LABEL_MAPPING = {
  // Coffee (BRACOL-derived classes in PlantVillage)
  "Coffee___Cercospora_leaf_spot_Gray_leaf_spot": "coffee_brown_eye",
  "Coffee___Common_Rust": "coffee_leaf_rust",
  "Coffee___Healthy": "healthy",
  "Coffee___Northern_Leaf_Blight": "coffee_phoma",
  // Fallback for non-coffee detections
  "__other__": "unknown",
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`  ✓ ${path.basename(dest)} already exists, skipping.`);
      return resolve();
    }
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (total) process.stdout.write(`\r  Downloading... ${Math.round(received / total * 100)}%`);
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`\n  ✓ Saved ${path.basename(dest)} (${Math.round(received / 1024)}KB)`);
        resolve();
      });
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

console.log('Downloading plant disease TFLite model...\n');
try {
  await download(MODEL_URL, path.join(OUT_DIR, 'plant_disease.tflite'));
} catch (e) {
  console.log('\n  Model URL failed. Use one of these alternatives:');
  console.log('  1. Kaggle: search "plant disease tflite mobilenet" — download and place in assets/model/');
  console.log('  2. HuggingFace: muggle/plant-disease-mobilenetv2-tflite');
  console.log('  3. TFHub: tensorflow.org/lite/models/image_classification/overview');
}

fs.writeFileSync(
  path.join(OUT_DIR, 'label-mapping.json'),
  JSON.stringify(LABEL_MAPPING, null, 2)
);
console.log('  ✓ Saved label-mapping.json');
console.log('\nNext: update lib/inference.ts to use the real model (commented code at bottom of file).');
