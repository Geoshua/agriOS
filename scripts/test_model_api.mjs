/**
 * Shamba — BRACOL Model API Test
 * ================================
 * Tests the Roboflow BRACOL-VALIDADO model (coffee leaf disease detection)
 * against real coffee leaf images before integrating TFLite into the app.
 *
 * Model: jonatan-fragoso/bracol-validado
 * Classes: Rust, Miner, Cercospora, Phoma (+ healthy = no detections)
 * API: Roboflow Serverless Inference
 *
 * Setup:
 *   1. Get a free API key: https://roboflow.com → sign up → Settings → API Keys
 *   2. Run: ROBOFLOW_API_KEY=your_key node scripts/test_model_api.mjs
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.ROBOFLOW_API_KEY;

if (!API_KEY) {
  console.error('\nMissing ROBOFLOW_API_KEY.');
  console.error('Get a free key at https://roboflow.com → Settings → API Keys');
  console.error('Then run: ROBOFLOW_API_KEY=your_key node scripts/test_model_api.mjs\n');
  process.exit(1);
}

// BRACOL-VALIDADO model on Roboflow
// Object detection model — 4 classes matching our disease knowledge base
const MODEL_ID = 'jonatan-fragoso/bracol-validado/1';
const API_URL = `https://serverless.roboflow.com/${MODEL_ID}`;

// Our disease ID mapping (Roboflow class name → Shamba disease ID)
const CLASS_TO_SHAMBA = {
  'Rust': 'coffee_leaf_rust',
  'rust': 'coffee_leaf_rust',
  'Miner': 'coffee_leaf_miner',
  'miner': 'coffee_leaf_miner',
  'Cercospora': 'coffee_brown_eye',
  'cercospora': 'coffee_brown_eye',
  'Phoma': 'coffee_phoma',
  'phoma': 'coffee_phoma',
};

// Public domain coffee leaf disease images for testing
// Sources: Wikimedia Commons, published research papers (CC licensed)
const TEST_IMAGES = [
  {
    name: 'Coffee Leaf Rust (expected: Rust)',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Coffee_leaf_rust_Hemileia_vastatrix.jpg/640px-Coffee_leaf_rust_Hemileia_vastatrix.jpg',
    expectedClass: 'coffee_leaf_rust',
  },
  {
    name: 'Healthy Coffee Leaf (expected: no detections)',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Coffee_Leaf.JPG/640px-Coffee_Leaf.JPG',
    expectedClass: 'healthy',
  },
];

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, { headers: { 'User-Agent': 'Shamba-Model-Test/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function testImage({ name, url, expectedClass }) {
  console.log(`\n─────────────────────────────────────`);
  console.log(`Test: ${name}`);
  console.log(`URL:  ${url}`);

  // Download image
  let imageBuffer;
  try {
    imageBuffer = await downloadImage(url);
    console.log(`Downloaded: ${Math.round(imageBuffer.length / 1024)}KB`);
  } catch (e) {
    console.error(`  ✗ Download failed: ${e.message}`);
    return null;
  }

  // Base64 encode and send to Roboflow
  const base64 = imageBuffer.toString('base64');
  const endpoint = `${API_URL}?api_key=${API_KEY}`;

  let result;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: base64,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`  ✗ API error ${response.status}: ${text}`);
      return null;
    }

    result = await response.json();
  } catch (e) {
    console.error(`  ✗ Request failed: ${e.message}`);
    return null;
  }

  // Parse detections
  const detections = result.predictions ?? [];
  console.log(`\nDetections found: ${detections.length}`);

  if (detections.length === 0) {
    const shambaId = 'healthy';
    const correct = expectedClass === 'healthy';
    console.log(`  → No disease detected (mapped to: healthy)`);
    console.log(`  Expected: ${expectedClass} | ${correct ? '✓ CORRECT' : '✗ WRONG'}`);
    return { expected: expectedClass, got: shambaId, correct };
  }

  // Sort by confidence
  const sorted = detections.sort((a, b) => b.confidence - a.confidence);
  for (const d of sorted) {
    const shambaId = CLASS_TO_SHAMBA[d.class] ?? 'unknown';
    console.log(`  ${d.class.padEnd(12)} ${(d.confidence * 100).toFixed(1)}% → ${shambaId}`);
  }

  const topClass = sorted[0].class;
  const topShamba = CLASS_TO_SHAMBA[topClass] ?? 'unknown';
  const topConf = sorted[0].confidence;
  const correct = topShamba === expectedClass;

  console.log(`\n  Top result: ${topClass} (${(topConf * 100).toFixed(1)}%) → ${topShamba}`);
  console.log(`  Expected:   ${expectedClass} | ${correct ? '✓ CORRECT' : '✗ WRONG'}`);

  if (topConf < 0.6) {
    console.log(`  ⚠ Confidence below 60% threshold — would show "Not sure" in app`);
  }

  return {
    expected: expectedClass,
    got: topShamba,
    confidence: topConf,
    allDetections: sorted.map(d => ({
      class: d.class,
      shamba: CLASS_TO_SHAMBA[d.class] ?? 'unknown',
      confidence: d.confidence,
      bbox: { x: d.x, y: d.y, width: d.width, height: d.height },
    })),
    correct,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log('\nShamba — BRACOL Model API Test');
console.log('Model: jonatan-fragoso/bracol-validado/1');
console.log('Classes: Rust, Miner, Cercospora, Phoma');
console.log('Confidence threshold: 60%');

const results = [];
for (const img of TEST_IMAGES) {
  const r = await testImage(img);
  if (r) results.push(r);
}

// Summary
console.log('\n═════════════════════════════════════');
console.log('SUMMARY');
const correct = results.filter(r => r.correct).length;
console.log(`${correct}/${results.length} tests passed`);

if (correct === results.length) {
  console.log('\n✓ Model works for our use case.');
  console.log('  Next: run training notebook for fine-tuned TFLite version.');
  console.log('  Or: use Roboflow API directly in the app (cloud mode, not offline).');
} else {
  console.log('\n⚠ Some tests failed. Check images and model version.');
  console.log('  Try testing with images directly from the BRACOL dataset:');
  console.log('  https://data.mendeley.com/datasets/yy2k5y8mxg/1');
}
