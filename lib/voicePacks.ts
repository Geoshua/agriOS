/**
 * Voice packs — downloadable, per-language spoken advisories that play offline.
 *
 * A pack is a manifest plus one audio clip per disease class, built by
 * scripts/voice/build_packs.py and served by the hub (GET /voice-packs/...).
 * Download order: co-op hub over LAN first (works with no internet), then the
 * public repo as an internet fallback. Installed packs live in
 * <documents>/voice-packs/<code>/ and survive restarts.
 */

import { Directory, File, Paths } from 'expo-file-system';
import catalogData from '../assets/voice-packs/catalog.json';
import { LOCAL_SERVER_URL, VOICE_PACK_BASE_URL } from './config';

export interface VoicePackInfo {
  code: string;
  name: string;
  nativeName: string;
  region: string;
  provider: string;
  /** Language tag for the phone's own speech engine, or null when phones have no voice for it. */
  deviceTts: string | null;
  /** Whisper language used for voice notes while this pack is selected. */
  sttLanguage: string;
  approxSizeKb: number;
  /** False while a translation awaits native-speaker review. */
  reviewed: boolean;
}

export interface PackClip {
  file: string;
  bytes: number;
  durationSec: number;
}

export interface PackManifest {
  code: string;
  name: string;
  version: number;
  provider: string;
  voice: string | null;
  reviewed: boolean;
  synthetic: boolean;
  clips: Record<string, PackClip>;
  totalBytes: number;
}

export const VOICE_PACKS: VoicePackInfo[] = catalogData.packs;

export function getPackInfo(code: string): VoicePackInfo | undefined {
  return VOICE_PACKS.find((p) => p.code === code);
}

const packsRoot = () => new Directory(Paths.document, 'voice-packs');
const packDir = (code: string) => new Directory(packsRoot(), code);
const manifestFile = (code: string) => new File(packDir(code), 'manifest.json');

// Manifests are read often (every advisory playback) — keep them in memory.
const manifestCache = new Map<string, PackManifest | null>();

export async function getInstalledManifest(code: string): Promise<PackManifest | null> {
  if (manifestCache.has(code)) return manifestCache.get(code) ?? null;
  let manifest: PackManifest | null = null;
  try {
    const file = manifestFile(code);
    if (file.exists) manifest = JSON.parse(await file.text());
  } catch {
    manifest = null;
  }
  manifestCache.set(code, manifest);
  return manifest;
}

/** Local file URI for a disease clip in an installed pack, or null. */
export async function getClip(code: string, diseaseId: string): Promise<(PackClip & { uri: string }) | null> {
  const manifest = await getInstalledManifest(code);
  const clip = manifest?.clips[diseaseId];
  if (!clip) return null;
  const file = new File(packDir(code), clip.file);
  return file.exists ? { ...clip, uri: file.uri } : null;
}

/** Download sources in priority order: hub over LAN (offline-friendly), then internet. */
function sources(): { label: 'hub' | 'internet'; base: string; timeoutMs: number }[] {
  const list: { label: 'hub' | 'internet'; base: string; timeoutMs: number }[] = [];
  if (LOCAL_SERVER_URL) list.push({ label: 'hub', base: `${LOCAL_SERVER_URL}/voice-packs`, timeoutMs: 4000 });
  if (VOICE_PACK_BASE_URL) list.push({ label: 'internet', base: VOICE_PACK_BASE_URL, timeoutMs: 15000 });
  return list;
}

async function fetchManifest(base: string, code: string, timeoutMs: number): Promise<PackManifest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/${code}/manifest.json`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = (await res.json()) as PackManifest;
    if (!manifest?.clips || manifest.code !== code) throw new Error('Bad manifest');
    return manifest;
  } finally {
    clearTimeout(timer);
  }
}

export type DownloadProgress = { done: number; total: number; source: 'hub' | 'internet' };

/**
 * Downloads and installs a pack. Clips go to a staging folder first and are
 * swapped in only when every file arrived, so a dropped connection never
 * leaves a half-installed pack.
 */
export async function downloadPack(code: string, onProgress?: (p: DownloadProgress) => void): Promise<PackManifest> {
  const tried: string[] = [];
  for (const source of sources()) {
    let manifest: PackManifest;
    try {
      manifest = await fetchManifest(source.base, code, source.timeoutMs);
    } catch (e) {
      tried.push(`${source.label}: ${(e as Error).message}`);
      continue;
    }

    const clips = Object.values(manifest.clips);
    const staging = new Directory(packsRoot(), `${code}.partial`);
    if (staging.exists) staging.delete();
    staging.create({ intermediates: true });
    onProgress?.({ done: 0, total: clips.length, source: source.label });

    try {
      for (let i = 0; i < clips.length; i++) {
        await File.downloadFileAsync(`${source.base}/${code}/${clips[i].file}`, new File(staging, clips[i].file), { idempotent: true });
        onProgress?.({ done: i + 1, total: clips.length, source: source.label });
      }
      const manifestOut = new File(staging, 'manifest.json');
      manifestOut.create();
      manifestOut.write(JSON.stringify(manifest));
    } catch (e) {
      staging.delete();
      tried.push(`${source.label}: ${(e as Error).message}`);
      continue;
    }

    const target = packDir(code);
    if (target.exists) target.delete();
    staging.rename(code);
    manifestCache.set(code, manifest);
    return manifest;
  }
  throw new Error(tried.length ? `Couldn't download the pack (${tried.join('; ')})` : 'No download source configured');
}

export function removePack(code: string): void {
  const dir = packDir(code);
  if (dir.exists) dir.delete();
  manifestCache.set(code, null);
}

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
