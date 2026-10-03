/**
 * agriOS Local Inference Server
 * ==============================
 * Runs on a LAN device (laptop, Raspberry Pi, community Wi-Fi hotspot).
 * The agriOS phone app connects to this server instead of calling HuggingFace
 * directly — so API keys stay server-side and inference works at LAN speed.
 *
 * Capabilities:
 *   POST /classify    — image base64 → disease classification (HF proxy or local model)
 *   POST /transcribe  — audio base64 → text transcript (HF Whisper proxy)
 *   GET  /soil        — lat/lng → soil properties (SoilGrids with 1-hour cache)
 *   GET  /health      — alive check + model status
 *
 * Run:
 *   HF_API_KEY=hf_xxx node server.mjs
 *
 * Optional — also run local Python model inference (requires trained model):
 *   MODEL_PATH=../assets/model/plant_disease.tflite node server.mjs
 *
 * Default port: 7384. Override with PORT=xxxx.
 *
 * Find this server's LAN IP: run `hostname -I` (Linux/RPi) or `ipconfig` (Windows).
 * Set that IP in agriOS/lib/inference.ts → LOCAL_SERVER_URL.
 */

import http from 'http';
import { URL } from 'url';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir, networkInterfaces } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

const HF_API_KEY   = process.env.HF_API_KEY   ?? '';
const MODEL_PATH   = process.env.MODEL_PATH    ?? '';   // optional: path to .tflite
const PORT         = parseInt(process.env.PORT ?? '7384', 10);
const CORS_ORIGIN  = process.env.CORS_ORIGIN   ?? '*';

const HF_CLASSIFY_URL  = 'https://api-inference.huggingface.co/v1/chat/completions';
const HF_WHISPER_URL   = 'https://api-inference.huggingface.co/models/openai/whisper-large-v3';
const SOILGRIDS_URL    = 'https://rest.soilgrids.org/query';

const CLASSIFY_MODEL   = 'Qwen/Qwen2-VL-7B-Instruct';

// ── Soil cache ─────────────────────────────────────────────────────────────────
// Keyed by "lat_3dp,lng_3dp" (250 m precision matches SoilGrids resolution).
const soilCache = new Map(); // key → { data, expiresAt }
const SOIL_TTL  = 60 * 60 * 1000; // 1 hour

function soilKey(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': CORS_ORIGIN,
  });
  res.end(payload);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Classification ──────────────────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are an expert agronomist specialising in coffee crop disease.
Examine this image and classify it into EXACTLY one of these categories:
- coffee_leaf_rust (orange/yellow powdery spots, Hemileia vastatrix)
- coffee_leaf_miner (pale serpentine trails, Leucoptera coffeella)
- coffee_phoma (dark brown circular lesions, Phoma tarda)
- coffee_brown_eye (brown centre + yellow halo circles, Cercospora coffeicola)
- healthy (no visible disease)
Respond ONLY with this JSON, nothing else:
{"disease_id":"<id>","confidence":<0.0-1.0>,"reasoning":"<one sentence>"}`;

const VALID_DISEASE_IDS = new Set([
  'coffee_leaf_rust', 'coffee_leaf_miner', 'coffee_phoma', 'coffee_brown_eye', 'healthy',
]);

async function classifyViaHF(imageBase64, mimeType = 'image/jpeg') {
  if (!HF_API_KEY) return null;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(HF_CLASSIFY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: 'text', text: CLASSIFICATION_PROMPT },
          ],
        }],
        max_tokens: 150,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const diseaseId = VALID_DISEASE_IDS.has(parsed.disease_id) ? parsed.disease_id : 'unknown';
    return { diseaseId, confidence: parsed.confidence ?? 0.7, reasoning: parsed.reasoning, source: 'hf' };
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function classifyViaLocalModel(imageBase64) {
  if (!MODEL_PATH) return null;
  // Write image to temp file, run Python inference script, read result.
  const tmpImg = join(tmpdir(), `agrios_classify_${Date.now()}.jpg`);
  const tmpOut = join(tmpdir(), `agrios_result_${Date.now()}.json`);
  try {
    await writeFile(tmpImg, Buffer.from(imageBase64, 'base64'));
    // Inline Python: loads TFLite model, infers, writes JSON result
    const pythonScript = `
import sys, json, numpy as np
from pathlib import Path

try:
    import tflite_runtime.interpreter as tflite
except ImportError:
    import tensorflow as tf
    tflite = tf.lite

import PIL.Image

img_path = sys.argv[1]
model_path = sys.argv[2]
out_path = sys.argv[3]

img = PIL.Image.open(img_path).convert('RGB').resize((224, 224))
arr = np.array(img, dtype=np.uint8)[np.newaxis]

interp = tflite.Interpreter(model_path=model_path)
interp.allocate_tensors()
inp = interp.get_input_details()[0]
out = interp.get_output_details()[0]
interp.set_tensor(inp['index'], arr)
interp.invoke()
scores = interp.get_tensor(out['index'])[0]
idx = int(np.argmax(scores))
conf = float(scores[idx])

# Load labels
labels_path = str(Path(model_path).parent / 'labels.json')
labels = json.loads(Path(labels_path).read_text())
disease_id = labels.get('index_to_agrios_id', {}).get(str(idx), 'unknown')
threshold = labels.get('confidence_threshold', 0.60)
if conf < threshold:
    disease_id = 'unknown'

Path(out_path).write_text(json.dumps({'disease_id': disease_id, 'confidence': conf}))
`;
    const scriptPath = join(tmpdir(), `agrios_infer_${Date.now()}.py`);
    await writeFile(scriptPath, pythonScript);
    await execFileAsync('python3', [scriptPath, tmpImg, MODEL_PATH, tmpOut], { timeout: 10_000 });
    const result = JSON.parse(await readFile(tmpOut, 'utf8'));
    return { diseaseId: result.disease_id, confidence: result.confidence, source: 'local-tflite' };
  } catch {
    return null;
  } finally {
    unlink(tmpImg).catch(() => {});
    unlink(tmpOut).catch(() => {});
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleHealth(req, res) {
  json(res, 200, {
    ok: true,
    modelPath: MODEL_PATH || null,
    hfKeySet: Boolean(HF_API_KEY),
    soilCacheEntries: soilCache.size,
    uptime: Math.round(process.uptime()),
  });
}

async function handleClassify(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }

  const { image, mimeType = 'image/jpeg' } = body;
  if (!image) return json(res, 400, { error: 'image (base64) required' });

  // Try local model first (fast, no internet), then HF
  const result = (await classifyViaLocalModel(image)) ?? (await classifyViaHF(image, mimeType));

  if (!result) {
    return json(res, 503, { error: 'no inference backend available', diseaseId: 'unknown', confidence: 0 });
  }

  json(res, 200, result);
}

async function handleTranscribe(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }

  const { audio, language = 'sw' } = body;
  if (!audio) return json(res, 400, { error: 'audio (base64) required' });
  if (!HF_API_KEY) return json(res, 503, { error: 'HF_API_KEY not set' });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30_000);
  try {
    const audioBuffer = Buffer.from(audio, 'base64');
    const hfRes = await fetch(HF_WHISPER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'audio/m4a',
        'X-Wait-For-Model': 'true',
      },
      body: audioBuffer,
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!hfRes.ok) return json(res, 502, { error: 'HF Whisper error', status: hfRes.status });
    const data = await hfRes.json();
    json(res, 200, { text: data.text?.trim() ?? '', language });
  } catch (e) {
    clearTimeout(t);
    json(res, 503, { error: e.message });
  }
}

async function handleSoil(req, res, url) {
  const lat = parseFloat(url.searchParams.get('lat') ?? '');
  const lng = parseFloat(url.searchParams.get('lng') ?? '');
  if (isNaN(lat) || isNaN(lng)) return json(res, 400, { error: 'lat and lng required' });

  const key = soilKey(lat, lng);
  const cached = soilCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return json(res, 200, { ...cached.data, cached: true });
  }

  const params = new URLSearchParams({
    lon: String(lng), lat: String(lat),
    property: 'phh2o,nitrogen,soc,clay', depth: '0-5cm', value: 'mean',
  });
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8_000);
  try {
    const sgRes = await fetch(`${SOILGRIDS_URL}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!sgRes.ok) return json(res, 502, { error: 'SoilGrids error', status: sgRes.status });
    const raw = await sgRes.json();

    function extractMean(name) {
      const layer = raw?.properties?.layers?.find(l => l.name === name);
      const depth = layer?.depths?.find(d => d.label === '0-5cm');
      return depth?.values?.mean ?? null;
    }

    const rawPh = extractMean('phh2o');
    if (rawPh === null) return json(res, 502, { error: 'SoilGrids returned no pH data' });

    const data = {
      ph: rawPh / 10,
      nitrogen: (extractMean('nitrogen') ?? 0) / 100,
      carbon: (extractMean('soc') ?? 0) / 10,
      clay: (extractMean('clay') ?? 0) / 10,
      latitude: lat,
      longitude: lng,
    };

    soilCache.set(key, { data, expiresAt: Date.now() + SOIL_TTL });
    json(res, 200, { ...data, cached: false });
  } catch (e) {
    clearTimeout(t);
    json(res, 503, { error: e.message });
  }
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === 'GET /health')       return await handleHealth(req, res);
    if (route === 'POST /classify')    return await handleClassify(req, res);
    if (route === 'POST /transcribe')  return await handleTranscribe(req, res);
    if (route === 'GET /soil')         return await handleSoil(req, res, url);
    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(route, e);
    json(res, 500, { error: 'internal server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const lanIPs = Object.values(nets).flat()
    .filter(n => n.family === 'IPv4' && !n.internal)
    .map(n => n.address);

  console.log(`\nagriOS Local Server running on port ${PORT}`);
  console.log(`HF key:     ${HF_API_KEY ? 'set ✓' : 'not set — classify will use local model only'}`);
  console.log(`Local model: ${MODEL_PATH || 'not set — will proxy to HF'}`);
  console.log(`\nLAN addresses (set one of these in agriOS/lib/inference.ts → LOCAL_SERVER_URL):`);
  lanIPs.forEach(ip => console.log(`  http://${ip}:${PORT}`));
  console.log();
});
