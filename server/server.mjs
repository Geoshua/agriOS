/**
 * agriOS Inference Server
 * ========================
 * Two deployment modes via ROLE env var:
 *
 *   ROLE=hub (default) — runs at the agricultural co-op / community hotspot.
 *     • Serves farmers over LAN: /classify /advisory /transcribe /soil /voice-packs
 *     • Queues anonymised scan data; syncs to cloud when internet available
 *     • Offloads low-confidence cases to the cloud's larger model
 *     • Collects anonymous treatment outcomes; forwards them to the cloud
 *
 *   ROLE=cloud — runs on a remote VPS or community server.
 *     • Same classify/soil endpoints, larger model timeouts
 *     • Receives village data via POST /ingest
 *     • Exposes GET /heatmap — regional disease map across all villages
 *     • Aggregates outcome events from all hubs (POST /outcomes, GET /outcome-stats)
 *
 * Endpoints:
 *   GET  /health                 server status
 *   POST /classify               { image, mimeType?, lat?, lng? } → { diseaseId, confidence, source }
 *   POST /offload                hub → cloud classify proxy for low-confidence images
 *   POST /advisory               { diseaseId, confidence, soilPh?, notes?, language? } → { advice }
 *   POST /history-summary        { subject, health, trend, recurring[], recentScans[], actions[], soilPh? } → { summary }
 *   POST /transcribe             { audio, language? } → { text }
 *   GET  /soil?lat=&lng=         SoilGrids properties (disk-cached)
 *   GET  /voice-packs/<code>/<f> static voice pack files
 *   POST /outcomes               { events: [{ diseaseId, type, success }], farm? } → { accepted, ignored }
 *   GET  /outcome-stats          → { stats: { [diseaseId]: { [type]: { success, total } } }, farms, updatedAt, source }
 *   GET|POST /sync               sync queue status / force flush (hub)
 *   POST /ingest                 village scan batches (cloud)
 *   GET  /heatmap                regional disease map
 *
 * Environment variables:
 *   HF_API_KEY    HuggingFace token (classify + transcribe)
 *   MODEL_PATH    Path to plant_disease.tflite (optional, local Python inference)
 *   CLOUD_URL     Cloud server URL — hub mode only, e.g. https://agrios.example.com
 *   OLLAMA_URL    Ollama base URL (default: http://localhost:11434)
 *   OLLAMA_MODEL  Model name (default: qwen2.5:3b)
 *   PORT          HTTP port (default: 7384)
 *   ROLE          'hub' or 'cloud' (default: hub)
 *   OUTCOME_STATS_FILE  Outcome aggregate path (default: server/outcome-stats.json)
 *   SOIL_CACHE_FILE     Soil cache path (default: server/soil-cache.json)
 *
 * Run (hub):
 *   HF_API_KEY=hf_xxx CLOUD_URL=https://agrios.example.com node server.mjs
 *
 * Run (cloud, same binary):
 *   ROLE=cloud HF_API_KEY=hf_xxx node server.mjs
 */

import http from 'http';
import { URL, fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir, networkInterfaces } from 'os';
import { createHash } from 'crypto';
import { join, normalize, dirname, extname } from 'path';

const execFileAsync = promisify(execFile);

// ── Config ─────────────────────────────────────────────────────────────────────
const HF_API_KEY   = process.env.HF_API_KEY   ?? '';
const MODEL_PATH   = process.env.MODEL_PATH   ?? '';
const CLOUD_URL    = process.env.CLOUD_URL    ?? '';
const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b';
const PORT         = parseInt(process.env.PORT ?? '7384', 10);
const CORS_ORIGIN  = process.env.CORS_ORIGIN  ?? '*';
const ROLE         = process.env.ROLE         ?? 'hub'; // 'hub' | 'cloud'

// Stable village hub ID — random per process, production would persist to disk
const SERVER_ID = Math.random().toString(36).slice(2, 10);

const HF_CLASSIFY_URL = 'https://api-inference.huggingface.co/v1/chat/completions';
const HF_WHISPER_URL  = 'https://api-inference.huggingface.co/models/openai/whisper-large-v3';
const SOILGRIDS_URL   = 'https://rest.isric.org/soilgrids/v2.0/properties/query'; // v1 rest.soilgrids.org is retired
const CLASSIFY_MODEL  = 'Qwen/Qwen2-VL-7B-Instruct';

const VALID_DISEASE_IDS = new Set([
  'coffee_leaf_rust', 'coffee_leaf_miner', 'coffee_phoma', 'coffee_brown_eye', 'healthy',
]);

// ── Soil cache ─────────────────────────────────────────────────────────────────
// Soil properties are static modelled values, so cache for weeks and persist to
// disk: after one fetch per area the hub answers soil queries with no internet,
// even across restarts. Keys are ~110 m buckets.
const SOIL_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const SOIL_CACHE_LIMIT = 2000;              // local area only — not a global mirror
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const SOIL_CACHE_FILE = process.env.SOIL_CACHE_FILE || join(SERVER_DIR, 'soil-cache.json');
const soilCache = new Map();
try {
  for (const [k, v] of Object.entries(JSON.parse(await readFile(SOIL_CACHE_FILE, 'utf8')))) soilCache.set(k, v);
} catch { /* first run — no cache yet */ }

function soilKey(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function saveSoilCache() {
  while (soilCache.size > SOIL_CACHE_LIMIT) soilCache.delete(soilCache.keys().next().value);
  writeFile(SOIL_CACHE_FILE, JSON.stringify(Object.fromEntries(soilCache))).catch(() => {});
}

// ── Data contribution: sync queue ──────────────────────────────────────────────
// Stores anonymised scan results. Flushed to CLOUD_URL/ingest when internet available.
// Production: replace with SQLite so queue survives restarts.
const syncQueue = [];
const MAX_QUEUE = 1000;

// Coarsen GPS to ~10 km grid for farmer privacy before syncing to cloud
function coarsen(coord) {
  return Math.round(coord * 10) / 10;
}

function queueScan({ diseaseId, confidence, lat, lng }) {
  if (syncQueue.length >= MAX_QUEUE) syncQueue.shift();
  syncQueue.push({
    type: 'scan',
    diseaseId,
    confidence: Math.round(confidence * 100) / 100,
    lat: lat != null ? coarsen(lat) : null,
    lng: lng != null ? coarsen(lng) : null,
    ts: Date.now(),
    serverId: SERVER_ID,
  });
}

async function flushSyncQueue() {
  if (!CLOUD_URL || syncQueue.length === 0) return 0;
  const batch = syncQueue.splice(0, 100);
  try {
    const res = await fetch(`${CLOUD_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch, serverId: SERVER_ID }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { syncQueue.unshift(...batch); return 0; }
    console.log(`[sync] pushed ${batch.length} scans to cloud`);
    return batch.length;
  } catch {
    syncQueue.unshift(...batch); // keep for next attempt
    return 0;
  }
}

// Try to sync every minute
if (ROLE === 'hub') {
  setInterval(() => flushSyncQueue().catch(() => {}), 60_000);
}

// ── Cloud: ingest store ────────────────────────────────────────────────────────
// Receives batches from multiple village hubs. Production: write to DB.
const ingestedScans = [];
const MAX_INGESTED = 50_000;

// ── Outcome learning: anonymous "did the treatment work?" tallies ─────────────
// Phones POST events { diseaseId, type, success } (no GPS, no photos). We keep
// only per-disease × per-treatment counters plus a capped set of HASHED farm
// ids (only to report how many farms contributed). Persisted to
// OUTCOME_STATS_FILE so tallies survive restarts.
//
// Hub → cloud propagation (ROLE=hub with CLOUD_URL set):
//   • Accepted events are counted locally AND appended to outcomeQueue (in
//     memory, capped). The queue is flushed to `${CLOUD_URL}/outcomes` right
//     away (fire-and-forget, 10 s timeout) and retried every minute. Queued,
//     unsent events are lost on restart (they stay in the local tally).
//   • GET /outcome-stats asks the cloud for the regional tally (4 s timeout).
//     A good answer is cached; when the cloud is unreachable the cached answer
//     is used. Events still waiting in the queue are added on top (the cloud
//     doesn't have them yet), and events flushed after the cache was taken are
//     folded into the cache, so nothing is counted twice. With no cloud answer
//     ever received, the hub's own local tally is returned (source: 'local').
// Cloud role (or hub without CLOUD_URL): just aggregates and serves its tally.

const OUTCOME_DISEASES = new Set(['coffee_leaf_rust', 'coffee_leaf_miner', 'coffee_phoma', 'coffee_brown_eye']);
const OUTCOME_TYPES = new Set(['sprayed', 'pruned', 'fertilised', 'removed_leaves']);
const MAX_OUTCOME_EVENTS = 500;   // per request
const MAX_FARM_ID_LEN = 64;
const MAX_FARMS = 10_000;         // distinct-farm counter cap
const MAX_OUTCOME_QUEUE = 200;    // pending forward batches (hub)
const OUTCOME_STATS_FILE = process.env.OUTCOME_STATS_FILE || join(SERVER_DIR, 'outcome-stats.json');

/** Strictly parses a stats object from an untrusted source (disk or cloud). */
function sanitizeStats(stats) {
  const out = {};
  if (!stats || typeof stats !== 'object') return out;
  for (const [d, byType] of Object.entries(stats)) {
    if (!OUTCOME_DISEASES.has(d) || !byType || typeof byType !== 'object') continue;
    for (const [t, c] of Object.entries(byType)) {
      if (!OUTCOME_TYPES.has(t) || !c || typeof c !== 'object') continue;
      const total = Math.max(0, Math.floor(Number(c.total) || 0));
      const success = Math.min(total, Math.max(0, Math.floor(Number(c.success) || 0)));
      if (total > 0) (out[d] ??= {})[t] = { success, total };
    }
  }
  return out;
}

const outcome = { stats: {}, farms: new Set(), updatedAt: 0 };
try {
  const saved = JSON.parse(await readFile(OUTCOME_STATS_FILE, 'utf8'));
  outcome.stats = sanitizeStats(saved?.stats);
  if (Array.isArray(saved?.farms)) {
    for (const f of saved.farms.slice(0, MAX_FARMS)) if (typeof f === 'string') outcome.farms.add(f);
  }
  outcome.updatedAt = Number(saved?.updatedAt) || 0;
} catch { /* first run — no stats yet */ }

let outcomeSaveTimer = null;
function saveOutcomeStats() {
  // Debounced so a burst of posts produces one write.
  if (outcomeSaveTimer) return;
  outcomeSaveTimer = setTimeout(() => {
    outcomeSaveTimer = null;
    const data = { stats: outcome.stats, farms: [...outcome.farms], updatedAt: outcome.updatedAt };
    writeFile(OUTCOME_STATS_FILE, JSON.stringify(data)).catch(e => console.error('[outcomes] save failed:', e.message));
  }, 200);
}

function hashFarm(id) {
  // Never store the raw id; a hash is enough to count distinct farms.
  return createHash('sha256').update(`agrios-farm:${id}`).digest('hex').slice(0, 24);
}

/** Returns only well-formed events, normalised; anything else is dropped. */
function validOutcomeEvents(events) {
  const out = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (!OUTCOME_DISEASES.has(e.diseaseId) || !OUTCOME_TYPES.has(e.type) || typeof e.success !== 'boolean') continue;
    out.push({ diseaseId: e.diseaseId, type: e.type, success: e.success });
  }
  return out;
}

function addToStats(stats, events) {
  for (const e of events) {
    const cell = ((stats[e.diseaseId] ??= {})[e.type] ??= { success: 0, total: 0 });
    cell.total++;
    if (e.success) cell.success++;
  }
}

// Hub only: batches waiting to be forwarded to the cloud.
const outcomeQueue = [];        // [{ events, farm? }] — farm is already hashed
let cloudOutcomeCache = null;   // { stats, farms, updatedAt, fetchedAt }
let outcomeFlushing = false;

async function flushOutcomeQueue() {
  if (!CLOUD_URL || outcomeFlushing || outcomeQueue.length === 0) return 0;
  outcomeFlushing = true;
  let sent = 0;
  try {
    while (outcomeQueue.length) {
      const batch = outcomeQueue[0];
      const res = await fetch(`${CLOUD_URL}/outcomes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) break;
      outcomeQueue.shift();
      // The cloud now has these: fold them into the cached regional tally so
      // the "cache + pending" view neither drops nor double-counts them.
      if (cloudOutcomeCache) addToStats(cloudOutcomeCache.stats, batch.events);
      sent += batch.events.length;
    }
    if (sent) console.log(`[outcomes] forwarded ${sent} events to cloud`);
  } catch { /* offline — retry on next tick */ }
  finally { outcomeFlushing = false; }
  return sent;
}

if (ROLE === 'hub' && CLOUD_URL) {
  setInterval(() => flushOutcomeQueue().catch(() => {}), 60_000);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readBody(req, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { chunks.length = 0; reject(new Error('body too large')); return; } // drain, don't buffer
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
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

// ── Classification ─────────────────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are an expert agronomist specialising in coffee crop disease.
Examine this image and classify it into EXACTLY one of these categories:
- coffee_leaf_rust (orange/yellow powdery spots, Hemileia vastatrix)
- coffee_leaf_miner (pale serpentine trails, Leucoptera coffeella)
- coffee_phoma (dark brown circular lesions, Phoma tarda)
- coffee_brown_eye (brown centre + yellow halo circles, Cercospora coffeicola)
- healthy (no visible disease)
Respond ONLY with this JSON, nothing else:
{"disease_id":"<id>","confidence":<0.0-1.0>,"reasoning":"<one sentence>"}`;

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
  const tmpImg = join(tmpdir(), `agrios_classify_${Date.now()}.jpg`);
  const tmpOut = join(tmpdir(), `agrios_result_${Date.now()}.json`);
  try {
    await writeFile(tmpImg, Buffer.from(imageBase64, 'base64'));
    const pythonScript = `
import sys, json, numpy as np
from pathlib import Path
try:
    import tflite_runtime.interpreter as tflite
except ImportError:
    import tensorflow as tf; tflite = tf.lite
import PIL.Image
img = PIL.Image.open(sys.argv[1]).convert('RGB').resize((224, 224))
arr = np.array(img, dtype=np.uint8)[np.newaxis]
interp = tflite.Interpreter(model_path=sys.argv[2])
interp.allocate_tensors()
inp = interp.get_input_details()[0]
out = interp.get_output_details()[0]
interp.set_tensor(inp['index'], arr)
interp.invoke()
scores = interp.get_tensor(out['index'])[0]
idx = int(np.argmax(scores))
conf = float(scores[idx])
labels = json.loads(Path(sys.argv[2]).parent.joinpath('labels.json').read_text())
disease_id = labels.get('index_to_agrios_id', {}).get(str(idx), 'unknown')
if conf < labels.get('confidence_threshold', 0.60): disease_id = 'unknown'
Path(sys.argv[3]).write_text(json.dumps({'disease_id': disease_id, 'confidence': conf}))
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

// ── Handlers ───────────────────────────────────────────────────────────────────

async function handleHealth(req, res) {
  json(res, 200, {
    ok: true,
    role: ROLE,
    serverId: SERVER_ID,
    modelPath: MODEL_PATH || null,
    hfKeySet: Boolean(HF_API_KEY),
    ollamaUrl: OLLAMA_URL,
    cloudUrl: CLOUD_URL || null,
    soilCacheEntries: soilCache.size,
    outcomeFarms: outcome.farms.size,
    outcomeQueueLength: outcomeQueue.length,
    syncQueueLength: syncQueue.length,
    ingestedTotal: ingestedScans.length,
    uptime: Math.round(process.uptime()),
  });
}

async function handleClassify(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }

  const { image, mimeType = 'image/jpeg', lat, lng } = body;
  if (!image) return json(res, 400, { error: 'image (base64) required' });

  const result = (await classifyViaLocalModel(image)) ?? (await classifyViaHF(image, mimeType));

  if (!result) {
    return json(res, 503, { error: 'no inference backend available', diseaseId: 'unknown', confidence: 0 });
  }

  // Queue anonymised data point for contribution to cloud (non-blocking)
  if (result.diseaseId !== 'unknown') {
    queueScan({ diseaseId: result.diseaseId, confidence: result.confidence, lat, lng });
  }

  json(res, 200, result);
}

async function handleOffload(req, res) {
  // Proxy low-confidence images to the cloud server's larger model.
  // Called by the phone when local tiers return 'unknown'.
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }

  if (!CLOUD_URL) {
    return json(res, 503, { error: 'no cloud server configured', tip: 'Set CLOUD_URL env var on the hub' });
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 35_000);
  try {
    const cloudRes = await fetch(`${CLOUD_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, offloaded: true }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!cloudRes.ok) return json(res, cloudRes.status, { error: 'cloud classify failed' });
    const data = await cloudRes.json();
    json(res, 200, { ...data, source: 'cloud' });
  } catch (e) {
    clearTimeout(t);
    json(res, 503, { error: 'cloud unreachable', detail: e.message });
  }
}

async function handleAdvisory(req, res) {
  // Generate personalised advice using a local LLM (Ollama) with HF as fallback.
  // Input: { diseaseId, confidence, soilPh?, notes?, language? }
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }

  const {
    diseaseId = 'unknown',
    confidence = 0,
    soilPh,
    notes = '',
    language = 'English',
  } = body;

  const prompt = [
    `You are an agricultural advisor helping a smallholder coffee farmer.`,
    ``,
    `Diagnosis: ${diseaseId.replace(/_/g, ' ')} (${Math.round(confidence * 100)}% confidence)`,
    soilPh != null ? `Soil pH: ${Number(soilPh).toFixed(1)}` : null,
    notes ? `Farmer's observation: "${notes}"` : null,
    ``,
    `Write a response in ${language}. Maximum 4 sentences. Use very simple language — the farmer may have limited literacy.`,
    `Structure: (1) What this disease is. (2) What to do immediately. (3) How to prevent it spreading.`,
    `If diagnosis is 'unknown', advise the farmer to photograph the leaf and consult their extension officer.`,
    `Do not use technical Latin names. Do not use bullet points.`,
  ].filter(Boolean).join('\n');

  // Try Ollama first (local LLM — no internet needed)
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30_000);
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (ollamaRes.ok) {
      const data = await ollamaRes.json();
      const advice = data.response?.trim();
      if (advice) return json(res, 200, { advice, source: 'local-llm', model: OLLAMA_MODEL });
    }
  } catch { /* Ollama not running — fall through to HF */ }

  // Fallback: HF chat completion (internet required)
  if (!HF_API_KEY) return json(res, 503, { error: 'no advisory backend available — run Ollama or set HF_API_KEY' });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20_000);
  try {
    const hfRes = await fetch(HF_CLASSIFY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!hfRes.ok) return json(res, 502, { error: 'HF advisory failed' });
    const data = await hfRes.json();
    const advice = data.choices?.[0]?.message?.content?.trim();
    if (!advice) return json(res, 502, { error: 'empty HF response' });
    json(res, 200, { advice, source: 'hf' });
  } catch (e) {
    clearTimeout(t);
    json(res, 503, { error: e.message });
  }
}

// ── History summary (the LLM explains the numbers; it never decides) ─────────

const SUMMARY_DEADLINE_MS = 30_000;

function cleanText(v, max = 80) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\r\n\t]+/g, ' ').replace(/[^\p{L}\p{N}\s.,:;%()/'+_-]/gu, '').trim().slice(0, max);
}

async function handleHistorySummary(req, res) {
  // Input: { subject, health, trend, recurring: string[], recentScans: [{date, result}],
  //          actions: [{date, action}], soilPh? } → { summary, source }
  let raw;
  try { raw = await readBody(req, 64 * 1024); } catch { return json(res, 413, { error: 'body too large' }); }
  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid JSON' }); }
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'object body required' });

  const subject = cleanText(body.subject);
  if (!subject) return json(res, 400, { error: 'subject required' });
  const health = cleanText(body.health, 40) || 'not known';
  const trend = cleanText(body.trend, 40) || 'not known';
  const recurring = (Array.isArray(body.recurring) ? body.recurring : [])
    .map(r => cleanText(r, 40)).filter(Boolean).slice(0, 6);
  const listOf = (arr, key) => (Array.isArray(arr) ? arr : []).slice(0, 12)
    .filter(x => x && typeof x === 'object')
    .map(x => [cleanText(x.date, 20), cleanText(x[key], 40)])
    .filter(([, v]) => v)
    .map(([d, v]) => (d ? `${d}: ${v}` : v));
  const scans = listOf(body.recentScans, 'result');
  const actions = listOf(body.actions, 'action');
  const ph = Number(body.soilPh);
  const soilPh = body.soilPh != null && Number.isFinite(ph) && ph > 0 && ph < 14 ? ph : null;
  const words = s => s.replace(/_/g, ' ');

  const prompt = [
    `You are helping an agricultural extension officer explain a coffee tree's history to a smallholder farmer.`,
    ``,
    `FACTS (use only these):`,
    `Subject: ${subject}`,
    `Current health: ${health}`,
    `Trend: ${trend}`,
    `Problems that keep coming back: ${recurring.length ? words(recurring.join(', ')) : 'none'}`,
    `Recent scans: ${scans.length ? words(scans.join('; ')) : 'none'}`,
    `Actions taken: ${actions.length ? words(actions.join('; ')) : 'none'}`,
    soilPh != null ? `Soil pH: ${soilPh.toFixed(1)}` : null,
    ``,
    `Write a summary of at most 4 short sentences in very simple English. The farmer may have limited literacy.`,
    `Only use the facts above. Do not invent numbers, dates, diseases or treatments. Do not predict yield or harvest.`,
    `Do not use Latin names, bullet points or headings.`,
    `End with one gentle recommendation (for example "It may help to ..."), not a command.`,
  ].filter(v => v != null).join('\n');

  const deadline = Date.now() + SUMMARY_DEADLINE_MS;
  const remaining = () => Math.max(1, deadline - Date.now());
  const finish = text => text.replace(/\s+/g, ' ').trim().slice(0, 800);

  // Try Ollama first (local LLM — no internet needed). A closed port fails fast.
  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.2 } }),
      signal: AbortSignal.timeout(Math.min(remaining(), 25_000)),
    });
    if (ollamaRes.ok) {
      const data = await ollamaRes.json();
      const summary = data.response?.trim();
      if (summary) return json(res, 200, { summary: finish(summary), source: 'local-llm', model: OLLAMA_MODEL });
    }
  } catch { /* Ollama not running or too slow — fall through to HF */ }

  // Fallback: HF chat completion (internet required), within what's left of the deadline.
  if (!HF_API_KEY) return json(res, 503, { error: 'no summary backend available — run Ollama or set HF_API_KEY' });
  if (deadline - Date.now() < 2_000) return json(res, 504, { error: 'summary timed out' });

  try {
    const hfRes = await fetch(HF_CLASSIFY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(Math.min(remaining(), 20_000)),
    });
    if (!hfRes.ok) return json(res, 502, { error: 'HF summary failed' });
    const data = await hfRes.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) return json(res, 502, { error: 'empty HF response' });
    json(res, 200, { summary: finish(summary), source: 'hf' });
  } catch (e) {
    json(res, 503, { error: e.message });
  }
}

// ── Outcome endpoints ──────────────────────────────────────────────────────────

async function handleOutcomes(req, res) {
  // Input: { events: [{ diseaseId, type, success }], farm? } → { accepted, ignored }
  let raw;
  try { raw = await readBody(req, 256 * 1024); } catch { return json(res, 413, { error: 'body too large' }); }
  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid JSON' }); }
  if (!body || typeof body !== 'object' || !Array.isArray(body.events)) {
    return json(res, 400, { error: 'events array required' });
  }
  if (body.events.length > MAX_OUTCOME_EVENTS) {
    return json(res, 400, { error: `max ${MAX_OUTCOME_EVENTS} events per request` });
  }
  if (body.farm != null && (typeof body.farm !== 'string' || !body.farm || body.farm.length > MAX_FARM_ID_LEN)) {
    return json(res, 400, { error: `farm must be a string of 1-${MAX_FARM_ID_LEN} characters` });
  }

  const events = validOutcomeEvents(body.events);
  const ignored = body.events.length - events.length;
  if (events.length) {
    addToStats(outcome.stats, events);
    const farm = body.farm ? hashFarm(body.farm) : null;
    if (farm && outcome.farms.size < MAX_FARMS) outcome.farms.add(farm);
    outcome.updatedAt = Date.now();
    saveOutcomeStats();

    if (ROLE === 'hub' && CLOUD_URL) {
      if (outcomeQueue.length >= MAX_OUTCOME_QUEUE) outcomeQueue.shift();
      outcomeQueue.push(farm ? { events, farm } : { events });
      flushOutcomeQueue().catch(() => {}); // fire-and-forget
    }
  }
  json(res, 200, { accepted: events.length, ignored });
}

async function handleOutcomeStats(req, res) {
  const local = { stats: outcome.stats, farms: outcome.farms.size, updatedAt: outcome.updatedAt, source: 'local' };
  if (ROLE !== 'hub' || !CLOUD_URL) return json(res, 200, local);

  try {
    const cloudRes = await fetch(`${CLOUD_URL}/outcome-stats`, { signal: AbortSignal.timeout(4_000) });
    if (cloudRes.ok) {
      const data = await cloudRes.json();
      cloudOutcomeCache = {
        stats: sanitizeStats(data?.stats),
        farms: Math.max(0, Math.floor(Number(data?.farms) || 0)),
        updatedAt: Number(data?.updatedAt) || Date.now(),
        fetchedAt: Date.now(),
      };
    }
  } catch { /* cloud unreachable — use the cached answer */ }

  if (!cloudOutcomeCache) return json(res, 200, local);

  const merged = sanitizeStats(cloudOutcomeCache.stats); // deep copy
  for (const batch of outcomeQueue) addToStats(merged, batch.events);
  json(res, 200, {
    stats: merged,
    // Hub and cloud farm sets overlap; max() never over-reports.
    farms: Math.max(cloudOutcomeCache.farms, outcome.farms.size),
    updatedAt: Math.max(cloudOutcomeCache.updatedAt, outcome.updatedAt),
    source: Date.now() - cloudOutcomeCache.fetchedAt < 5_000 ? 'cloud' : 'cloud-cached',
  });
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
    const hfRes = await fetch(HF_WHISPER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'audio/m4a',
        'X-Wait-For-Model': 'true',
      },
      body: Buffer.from(audio, 'base64'),
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

  // v2 needs one `property=` per property (a comma list returns HTTP 500).
  const params = new URLSearchParams({ lon: String(lng), lat: String(lat), depth: '0-5cm', value: 'mean' });
  for (const p of ['phh2o', 'nitrogen', 'soc', 'clay']) params.append('property', p);
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
    if (!rawPh) return json(res, 502, { error: 'SoilGrids returned no pH data (masked area?)' });

    const data = {
      ph: rawPh / 10,
      nitrogen: (extractMean('nitrogen') ?? 0) / 100,
      carbon: (extractMean('soc') ?? 0) / 10,
      clay: (extractMean('clay') ?? 0) / 10,
      latitude: lat,
      longitude: lng,
    };

    soilCache.set(key, { data, expiresAt: Date.now() + SOIL_TTL });
    saveSoilCache();
    json(res, 200, { ...data, cached: false });
  } catch (e) {
    clearTimeout(t);
    json(res, 503, { error: e.message });
  }
}

// ── Cloud-side: data ingestion + heatmap ───────────────────────────────────────

async function handleIngest(req, res) {
  // Receives batches of anonymised scan data from village hubs.
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }

  const { batch = [], serverId } = body;
  const valid = batch.filter(s => s.type === 'scan' && s.diseaseId);

  ingestedScans.push(...valid);
  // Cap memory (production: write to DB instead)
  if (ingestedScans.length > MAX_INGESTED) {
    ingestedScans.splice(0, ingestedScans.length - MAX_INGESTED);
  }

  console.log(`[ingest] ${valid.length} scans from ${serverId ?? 'unknown'} — total: ${ingestedScans.length}`);
  json(res, 200, { received: valid.length, total: ingestedScans.length });
}

async function handleHeatmap(req, res) {
  // Hub mode: include scans queued locally (not yet flushed to cloud).
  // Cloud mode: use data ingested from all village hubs.
  const source = ROLE === 'hub'
    ? [...ingestedScans, ...syncQueue.filter(s => s.type === 'scan')]
    : ingestedScans;

  // Aggregate disease counts by ~10 km grid cell across all contributing villages.
  const byRegion = {};
  for (const scan of source) {
    if (scan.lat == null) continue;
    const key = `${scan.lat},${scan.lng}`;
    if (!byRegion[key]) {
      byRegion[key] = { lat: scan.lat, lng: scan.lng, counts: {}, total: 0 };
    }
    byRegion[key].counts[scan.diseaseId] = (byRegion[key].counts[scan.diseaseId] ?? 0) + 1;
    byRegion[key].total++;
  }

  // Most prevalent disease per cell
  const regions = Object.values(byRegion).map(r => ({
    ...r,
    dominant: Object.entries(r.counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown',
  }));

  json(res, 200, {
    regions,
    total: source.length,
    villages: new Set(source.map(s => s.serverId).filter(Boolean)).size,
  });
}

async function handleSync(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      role: ROLE,
      queued: syncQueue.length,
      cloudUrl: CLOUD_URL || null,
      serverId: SERVER_ID,
    });
  }
  // POST: force-flush queue now
  const flushed = await flushSyncQueue();
  json(res, 200, { flushed, remaining: syncQueue.length });
}

// ── Voice packs (static) ───────────────────────────────────────────────────────
// Serves server/voice-packs/<code>/{manifest.json,*.mp3,*.wav} so phones can
// download a language pack once over the co-op LAN and play it offline.
// Build packs with: python scripts/voice/build_packs.py

const VOICE_PACK_DIR = join(dirname(fileURLToPath(import.meta.url)), 'voice-packs');
const VOICE_PACK_TYPES = { '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

async function handleVoicePack(req, res, url) {
  const rel = decodeURIComponent(url.pathname.slice('/voice-packs/'.length));
  // Only <code>/<file> with a known extension; never escape the pack folder.
  if (!/^[a-z]{2,3}\/[\w.-]+$/.test(rel)) return json(res, 404, { error: 'not found' });
  const type = VOICE_PACK_TYPES[extname(rel)];
  const path = normalize(join(VOICE_PACK_DIR, rel));
  if (!type || !path.startsWith(VOICE_PACK_DIR)) return json(res, 404, { error: 'not found' });
  try {
    const data = await readFile(path);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(data);
  } catch {
    json(res, 404, { error: 'voice pack file not found' });
  }
}

// ── Router ─────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    // All roles
    if (route === 'GET /health')       return await handleHealth(req, res);
    if (route === 'POST /classify')    return await handleClassify(req, res);
    if (route === 'POST /transcribe')  return await handleTranscribe(req, res);
    if (route === 'GET /soil')         return await handleSoil(req, res, url);
    if (req.method === 'GET' && url.pathname.startsWith('/voice-packs/')) return await handleVoicePack(req, res, url);

    // Hub-only routes
    if (route === 'POST /advisory')    return await handleAdvisory(req, res);
    if (route === 'POST /offload')     return await handleOffload(req, res);
    if (route === 'POST /history-summary') return await handleHistorySummary(req, res);
    if (route === 'GET /sync')         return await handleSync(req, res);
    if (route === 'POST /sync')        return await handleSync(req, res);

    // Cloud-only routes
    if (route === 'POST /ingest')      return await handleIngest(req, res);

    // All roles: outcome learning (hub counts + forwards to cloud; cloud aggregates)
    if (route === 'POST /outcomes')       return await handleOutcomes(req, res);
    if (route === 'GET /outcome-stats')   return await handleOutcomeStats(req, res);

    // All roles: heatmap (hub returns its local queue; cloud returns all ingested data)
    if (route === 'GET /heatmap')      return await handleHeatmap(req, res);

    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(route, e);
    json(res, 500, { error: 'internal server error' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const lanIPs = Object.values(nets).flat()
    .filter(n => n.family === 'IPv4' && !n.internal)
    .map(n => n.address);

  console.log(`\nagriOS Server [${ROLE.toUpperCase()}] — port ${PORT}`);
  console.log(`ID:          ${SERVER_ID}`);
  console.log(`HF key:      ${HF_API_KEY ? 'set ✓' : 'not set'}`);
  console.log(`Local model: ${MODEL_PATH || 'not set'}`);
  console.log(`Ollama:      ${OLLAMA_URL} / ${OLLAMA_MODEL}`);
  console.log(`Cloud:       ${CLOUD_URL || 'not configured'}`);

  if (ROLE === 'hub') {
    console.log(`\nSet one of these in agriOS/lib/config.ts → LOCAL_SERVER_URL:`);
    lanIPs.forEach(ip => console.log(`  http://${ip}:${PORT}`));
    console.log(`\nFarmers connect to this hub. Hub syncs data to cloud when internet is available.`);
  } else {
    console.log(`\nCloud mode — receiving data from village hubs.`);
    console.log(`  GET  /heatmap  → regional disease map`);
    console.log(`  POST /ingest   → village data ingestion`);
  }
  console.log();
});
