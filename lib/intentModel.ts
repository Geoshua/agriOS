/**
 * On-device question-intent classifier (Small AI): maps a farmer's question,
 * in Swahili or English, to one of the fixed answer slots in
 * assets/advisory_responses.json — or to null, meaning "not sure, ask your
 * extension officer". It only chooses; it never writes text.
 *
 * Hashed word / bigram / char 3–5-gram features → multinomial logistic
 * regression, int8 weights (~86 KB JSON). Pure TypeScript: no native module,
 * runs offline in Expo Go and in builds. Trained by
 * scripts/intent_training/train_intent.py; feature code must match it exactly
 * (checked against scripts/intent_training/golden.json).
 */

import model from '../assets/intent_model.json';
import type { Intent } from './advisor';

const INTENTS = model.intents as Intent[];
const BUCKETS: number = model.buckets;
const K = INTENTS.length;
export const INTENT_THRESHOLD: number = model.threshold;

// Policy block-list (same as GUARD in train_intent.py): never answer these,
// whatever the model says — banned pesticides, and money/prices (the app has
// no price data).
const GUARD = new RegExp(
  '\\b(ddt|endosulfan|paraquat|lindane|aldrin|dieldrin|furadan|carbofuran|' +
    'price|prices|cost|costs|pay|paid|sell|selling|buyer|loan|money|mpesa|' +
    'bei|gharama|lipa|kulipa|atalipa|uza|kuuza|niuze|mnunuzi|mkopo|pesa)\\b',
);

let weights: Int8Array | null = null;
function getWeights(): Int8Array {
  if (!weights) {
    const bin = globalThis.atob(model.weights);
    weights = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) weights[i] = (bin.charCodeAt(i) << 24) >> 24;
  }
  return weights;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/’/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function features(text: string): number[] {
  const toks = normalize(text).split(' ').filter(Boolean);
  const set = new Set<number>();
  const add = (f: string) => set.add(fnv1a(f) % BUCKETS);
  for (const t of toks) {
    add('w:' + t);
    const p = ` ${t} `;
    for (const n of [3, 4, 5]) for (let i = 0; i + n <= p.length; i++) add('c:' + p.slice(i, i + n));
  }
  for (let i = 0; i + 1 < toks.length; i++) add(`b:${toks[i]}_${toks[i + 1]}`);
  return [...set].sort((a, b) => a - b);
}

/** Class probabilities, in INTENTS order. */
export function predictProbs(text: string): number[] {
  const W = getWeights();
  const idx = features(text);
  const v = idx.length ? 1 / Math.sqrt(idx.length) : 0;
  const z = model.bias.slice();
  for (const j of idx) for (let k = 0; k < K; k++) z[k] += W[j * K + k] * model.scale[k] * v;
  const max = Math.max(...z);
  const e = z.map((x) => Math.exp(x - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
}

export interface IntentPrediction {
  /** Answer slot, or null = defer to a person. */
  intent: Exclude<Intent, 'outOfScope'> | null;
  /** Top class and its probability, for transparency / debugging. */
  top: Intent;
  confidence: number;
  blocked: boolean;
}

export function classifyIntent(text: string): IntentPrediction {
  const blocked = GUARD.test(normalize(text));
  const p = predictProbs(text);
  let best = 0;
  for (let k = 1; k < K; k++) if (p[k] > p[best]) best = k;
  const top = INTENTS[best];
  const confident = p[best] >= INTENT_THRESHOLD;
  return {
    intent: !blocked && confident && top !== 'outOfScope' ? (top as Exclude<Intent, 'outOfScope'>) : null,
    top,
    confidence: p[best],
    blocked,
  };
}
