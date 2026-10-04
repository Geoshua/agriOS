/// <reference types="node" />
/**
 * Integration tests for the hub server (server/server.mjs). Spawns real server
 * processes on free ports with no LLM backends and stats files in a temp dir,
 * so nothing in the repo is touched. Run: npm test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'server.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'agrios-server-test-'));
const children: ChildProcess[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(env: Record<string, string>): Promise<string> {
  const port = await freePort();
  const deadPort = await freePort(); // nothing listens here → Ollama fails fast
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      OLLAMA_URL: `http://127.0.0.1:${deadPort}`,
      HF_API_KEY: '',
      CLOUD_URL: '',
      SOIL_CACHE_FILE: join(TMP, `soil-${port}.json`),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return base;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  return { status: res.status, data: (await res.json()) as any };
}

async function getJson(base: string, path: string) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
  return { status: res.status, data: (await res.json()) as any };
}

async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

let hub = '';
const STATS_FILE = join(TMP, 'outcome-stats.json');

before(async () => {
  hub = await startServer({ OUTCOME_STATS_FILE: STATS_FILE });
});

after(() => {
  for (const c of children) c.kill();
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

test('POST /outcomes rejects malformed bodies with 400', async () => {
  assert.equal((await post(hub, '/outcomes', 'not json{')).status, 400);
  assert.equal((await post(hub, '/outcomes', {})).status, 400);
  assert.equal((await post(hub, '/outcomes', { events: 'nope' })).status, 400);
  assert.equal((await post(hub, '/outcomes', [1, 2])).status, 400);
  assert.equal((await post(hub, '/outcomes', null)).status, 400);
  const tooMany = Array.from({ length: 501 }, () => ({ diseaseId: 'coffee_phoma', type: 'pruned', success: true }));
  assert.equal((await post(hub, '/outcomes', { events: tooMany })).status, 400);
  assert.equal((await post(hub, '/outcomes', { events: [], farm: 'x'.repeat(65) })).status, 400);
  assert.equal((await post(hub, '/outcomes', { events: [], farm: 42 })).status, 400);
  // Nothing counted by the rejected requests.
  const { data } = await getJson(hub, '/outcome-stats');
  assert.deepEqual(data.stats, {});
});

test('POST /outcomes aggregates valid events, ignores invalid ones, counts farms', async () => {
  const first = await post(hub, '/outcomes', {
    farm: 'farm-a',
    events: [
      { diseaseId: 'coffee_leaf_rust', type: 'sprayed', success: true },
      { diseaseId: 'coffee_leaf_rust', type: 'sprayed', success: false },
      { diseaseId: 'coffee_leaf_rust', type: 'pruned', success: true },
      { diseaseId: 'healthy', type: 'sprayed', success: true },        // healthy rejected
      { diseaseId: 'unknown', type: 'sprayed', success: true },        // unknown rejected
      { diseaseId: 'coffee_leaf_rust', type: 'watered', success: true }, // bad type
      { diseaseId: 'coffee_leaf_rust', type: 'sprayed', success: 'yes' }, // bad success
      null,
      'junk',
      { diseaseId: '__proto__', type: 'sprayed', success: true },
    ],
  });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data, { accepted: 3, ignored: 7 });

  const second = await post(hub, '/outcomes', {
    farm: 'farm-b',
    events: [
      { diseaseId: 'coffee_leaf_rust', type: 'sprayed', success: true },
      { diseaseId: 'coffee_brown_eye', type: 'removed_leaves', success: false },
    ],
  });
  assert.deepEqual(second.data, { accepted: 2, ignored: 0 });

  // Same farm again + an anonymous post: neither adds a farm.
  await post(hub, '/outcomes', { farm: 'farm-a', events: [{ diseaseId: 'coffee_phoma', type: 'fertilised', success: true }] });
  await post(hub, '/outcomes', { events: [{ diseaseId: 'coffee_leaf_miner', type: 'sprayed', success: false }] });

  const { status, data } = await getJson(hub, '/outcome-stats');
  assert.equal(status, 200);
  assert.deepEqual(data.stats, {
    coffee_leaf_rust: { sprayed: { success: 2, total: 3 }, pruned: { success: 1, total: 1 } },
    coffee_brown_eye: { removed_leaves: { success: 0, total: 1 } },
    coffee_phoma: { fertilised: { success: 1, total: 1 } },
    coffee_leaf_miner: { sprayed: { success: 0, total: 1 } },
  });
  assert.equal(data.farms, 2);
  assert.equal(typeof data.updatedAt, 'number');
  assert.ok(data.updatedAt > 0);
});

test('outcome stats are persisted to OUTCOME_STATS_FILE without raw farm ids', async () => {
  const saved = await waitFor(() => {
    if (!existsSync(STATS_FILE)) return undefined;
    try {
      const s = JSON.parse(readFileSync(STATS_FILE, 'utf8'));
      return s.stats?.coffee_leaf_miner ? s : undefined;
    } catch { return undefined; }
  });
  assert.deepEqual(saved.stats.coffee_leaf_rust.sprayed, { success: 2, total: 3 });
  assert.equal(saved.farms.length, 2);
  assert.ok(!saved.farms.includes('farm-a'), 'farm ids must be hashed');
});

test('POST /history-summary fails fast with a JSON error when no LLM is available', async () => {
  const t0 = Date.now();
  const { status, data } = await post(hub, '/history-summary', {
    subject: 'Tree 12',
    health: 'fair',
    trend: 'improving',
    recurring: ['coffee_leaf_rust'],
    recentScans: [{ date: '2026-09-20', result: 'coffee_leaf_rust' }],
    actions: [{ date: '2026-09-21', action: 'sprayed' }],
    soilPh: 5.6,
  });
  assert.notEqual(status, 200);
  assert.equal(typeof data.error, 'string');
  assert.ok(Date.now() - t0 < 10_000, 'should not hang when Ollama is unreachable');

  assert.equal((await post(hub, '/history-summary', 'nope')).status, 400);
  assert.equal((await post(hub, '/history-summary', { health: 'good' })).status, 400);
});

test('voice-pack path traversal is still rejected', async () => {
  const res = await fetch(`${hub}/voice-packs/..%2F..%2Fpackage.json`, { signal: AbortSignal.timeout(5000) });
  assert.equal(res.status, 404);
  await res.body?.cancel();
});

test('hub forwards outcomes to the cloud and serves regional stats', async () => {
  const cloud = await startServer({ ROLE: 'cloud', OUTCOME_STATS_FILE: join(TMP, 'cloud-stats.json') });
  // Another village already contributed to the cloud.
  await post(cloud, '/outcomes', { farm: 'elsewhere', events: [{ diseaseId: 'coffee_phoma', type: 'pruned', success: true }] });

  const hub2 = await startServer({ CLOUD_URL: cloud, OUTCOME_STATS_FILE: join(TMP, 'hub2-stats.json') });
  await post(hub2, '/outcomes', { farm: 'farm-z', events: [{ diseaseId: 'coffee_phoma', type: 'pruned', success: false }] });

  // Forwarded (fire-and-forget) — wait until the cloud has it.
  const deadline = Date.now() + 5000;
  let cloudStats: any;
  do {
    cloudStats = (await getJson(cloud, '/outcome-stats')).data;
    if (cloudStats.stats.coffee_phoma?.pruned?.total === 2) break;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < deadline);
  assert.deepEqual(cloudStats.stats.coffee_phoma.pruned, { success: 1, total: 2 });
  assert.equal(cloudStats.farms, 2);

  const { data } = await getJson(hub2, '/outcome-stats');
  assert.equal(data.source, 'cloud');
  assert.deepEqual(data.stats.coffee_phoma.pruned, { success: 1, total: 2 });
  assert.equal(data.farms, 2);
});
