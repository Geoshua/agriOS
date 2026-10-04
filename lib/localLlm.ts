/**
 * On-device LLM (Qwen3-0.6B, GGUF Q4_0, via llama.rn) used ONLY as a question
 * router for lib/advisor.ts — it picks which pre-written answer fits a
 * farmer's free-text question. It never writes advice.
 *
 * The model (~382 MB) is NOT bundled with the app. It's an optional,
 * user-initiated download kept in the app's document directory; everything
 * else works without it. Gated by ON_DEVICE_LLM_ROUTER in lib/config.ts —
 * off by default, because in testing it added more wrong answers than right
 * ones (see TRAINING.md → "On-device LLM").
 */

import { Directory, File, Paths } from 'expo-file-system';
import type { LlamaContext } from 'llama.rn';
import type { Intent } from './advisor';

export const LLM_MODEL_FILE = 'Qwen3-0.6B-Q4_0.gguf';
export const LLM_MODEL_URL =
  'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf';
export const LLM_MODEL_BYTES = 382_000_000;

const INTENTS: Intent[] = ['summary', 'doNow', 'treatment', 'prevention', 'spread', 'safety', 'getHelp', 'outOfScope'];

// Same prompts that were evaluated on desktop (Ollama, same model + quant).
const NUMBER_PROMPT = `Classify the farmer's question about a sick coffee leaf. Answer with the number only.
1 = what is it, which disease
2 = what to do now, first step
3 = which spray, medicine, fertiliser, how often
4 = prevent it coming back in future
5 = does it spread to other trees
6 = is spraying dangerous, children, animals
7 = who to ask for help
8 = other topic`;

const JSON_PROMPT =
  'Pick the topic of the coffee farmer question: summary (what disease), doNow (first step), treatment (spray/medicine), prevention (future), spread (other trees), safety (danger), getHelp (who to ask), outOfScope (anything else).';

function modelFile(): File {
  return new File(new Directory(Paths.document, 'llm'), LLM_MODEL_FILE);
}

export function isLocalLlmDownloaded(): boolean {
  const f = modelFile();
  return f.exists && (f.size ?? 0) > LLM_MODEL_BYTES * 0.9;
}

/** User-initiated download. Never called automatically. */
export async function downloadLocalLlm(): Promise<void> {
  const dir = new Directory(Paths.document, 'llm');
  if (!dir.exists) dir.create();
  const f = modelFile();
  if (f.exists) f.delete();
  await File.downloadFileAsync(LLM_MODEL_URL, f);
}

let ctx: LlamaContext | null = null;
let loading: Promise<LlamaContext | null> | null = null;

async function getContext(): Promise<LlamaContext | null> {
  if (ctx) return ctx;
  if (!isLocalLlmDownloaded()) return null;
  if (!loading) {
    loading = (async () => {
      try {
        const { initLlama } = await import('llama.rn');
        // Small context + mmap keeps RAM low on 2–3 GB phones.
        ctx = await initLlama({ model: modelFile().uri, n_ctx: 512, n_threads: 4, use_mmap: true, n_gpu_layers: 0 });
        return ctx;
      } catch {
        return null;
      } finally {
        loading = null;
      }
    })();
  }
  return loading;
}

/** Free the model's memory (call when the advisory sheet closes). */
export async function releaseLocalLlm(): Promise<void> {
  const c = ctx;
  ctx = null;
  await c?.release().catch(() => {});
}

async function complete(c: LlamaContext, system: string, question: string, extra: object): Promise<string> {
  const res = await c.completion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
    temperature: 0,
    enable_thinking: false,
    ...extra,
  });
  return res.text ?? '';
}

/**
 * Route a question to an intent. Self-consistency gate: two differently
 * worded prompts must agree, otherwise null (→ "ask your extension officer").
 * Each call has a hard timeout so a slow phone never blocks the sheet.
 */
export async function routeWithLocalLlm(question: string, timeoutMs = 8000): Promise<Intent | null> {
  const c = await getContext();
  if (!c) return null;

  const work = (async () => {
    const a = await complete(c, NUMBER_PROMPT, question, { n_predict: 3 });
    const n = parseInt(a.match(/[1-8]/)?.[0] ?? '0', 10);
    const byNumber = INTENTS[n - 1] ?? null;
    if (!byNumber) return null;

    const b = await complete(c, JSON_PROMPT, question, {
      n_predict: 16,
      response_format: {
        type: 'json_schema',
        json_schema: {
          schema: { type: 'object', properties: { intent: { type: 'string', enum: INTENTS } }, required: ['intent'] },
        },
      },
    });
    let byJson: Intent | null = null;
    try { byJson = JSON.parse(b).intent ?? null; } catch { /* unparseable → disagree */ }

    return byNumber === byJson ? byNumber : null;
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((res) => { timer = setTimeout(() => { c.stopCompletion().catch(() => {}); res(null); }, timeoutMs); });
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
