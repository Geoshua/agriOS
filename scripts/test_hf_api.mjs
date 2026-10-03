/**
 * Shamba — HuggingFace VLM Classification Test
 * =============================================
 * Tests Qwen2-VL-7B-Instruct via HuggingFace Inference API for coffee leaf disease classification.
 * Run this BEFORE wiring the API into the app to validate it works.
 *
 * This uses the OpenAI-compatible HF endpoint:
 *   POST https://api-inference.huggingface.co/v1/chat/completions
 *
 * Setup:
 *   Get a free HuggingFace read token:
 *   → https://huggingface.co/settings/tokens → New token → Read → Copy
 *
 * Run:
 *   HF_API_KEY=hf_your_token node scripts/test_hf_api.mjs
 *
 * OR (from NanoClaw environment — proxy auto-injects HF credentials):
 *   node scripts/test_hf_api.mjs
 */

import https from 'https';

const HF_API_KEY = process.env.HF_API_KEY ?? 'onecli-managed';
const MODEL = 'Qwen/Qwen2-VL-7B-Instruct';
const API_URL = 'https://api-inference.huggingface.co/v1/chat/completions';

const CLASSIFICATION_PROMPT = `You are an expert agronomist specialising in coffee crop disease.

Examine this image of a coffee plant leaf and classify it into EXACTLY one of these categories:
- coffee_leaf_rust (orange/yellow powdery spots under leaf, caused by Hemileia vastatrix)
- coffee_leaf_miner (pale serpentine trails/blotches, caused by Leucoptera coffeella larva)
- coffee_phoma (dark brown circular lesions, caused by Phoma tarda)
- coffee_brown_eye (circular lesions with brown centre and yellow halo, caused by Cercospora coffeicola)
- healthy (no visible disease symptoms)

Respond in this EXACT JSON format and nothing else:
{
  "disease_id": "one of the five IDs above",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence"
}`;

// Disease class → human readable
const DISEASE_NAMES = {
  coffee_leaf_rust: 'Coffee Leaf Rust',
  coffee_leaf_miner: 'Coffee Leaf Miner',
  coffee_phoma: 'Coffee Phoma',
  coffee_brown_eye: 'Coffee Brown Eye Spot',
  healthy: 'Healthy',
};

const TEST_IMAGES = [
  {
    name: 'Coffee Leaf Rust',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Coffee_leaf_rust_Hemileia_vastatrix.jpg/640px-Coffee_leaf_rust_Hemileia_vastatrix.jpg',
    expected: 'coffee_leaf_rust',
  },
  {
    name: 'Healthy Coffee Leaf',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Coffee_Leaf.JPG/640px-Coffee_Leaf.JPG',
    expected: 'healthy',
  },
];

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, { headers: { 'User-Agent': 'Shamba-HF-Test/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function classifyImage({ name, url, expected }) {
  console.log(`\n─────────────────────────────────────`);
  console.log(`Test: ${name}`);

  let imageBuffer;
  try {
    imageBuffer = await downloadImage(url);
    console.log(`Downloaded: ${Math.round(imageBuffer.length / 1024)}KB`);
  } catch (e) {
    console.error(`  ✗ Download failed: ${e.message}`);
    return null;
  }

  const base64 = imageBuffer.toString('base64');
  const mimeType = url.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const payload = {
    model: MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: CLASSIFICATION_PROMPT },
      ],
    }],
    max_tokens: 200,
    temperature: 0.1,
  };

  let response;
  try {
    console.log(`Calling HF API (model: ${MODEL})...`);
    const start = performance.now();
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const elapsed = Math.round(performance.now() - start);
    console.log(`Response: HTTP ${response.status} (${elapsed}ms)`);
  } catch (e) {
    console.error(`  ✗ Request failed: ${e.message}`);
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    console.error(`  ✗ API error: ${text.slice(0, 300)}`);
    return null;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  console.log(`\nRaw response:\n${content}`);

  // Extract JSON from response
  let parsed;
  try {
    // Model sometimes wraps JSON in markdown code blocks
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error(`  ✗ JSON parse failed: ${e.message}`);
    return null;
  }

  const diseaseId = parsed.disease_id;
  const confidence = parsed.confidence;
  const reasoning = parsed.reasoning;
  const diseaseName = DISEASE_NAMES[diseaseId] ?? diseaseId;
  const correct = diseaseId === expected;

  console.log(`\nClassification: ${diseaseName} (${(confidence * 100).toFixed(1)}%)`);
  console.log(`Reasoning: ${reasoning}`);
  console.log(`Expected: ${expected} | ${correct ? '✓ CORRECT' : '✗ WRONG'}`);

  return { expected, got: diseaseId, confidence, correct, reasoning };
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log('\nShamba — HuggingFace VLM Classification Test');
console.log(`Model: ${MODEL}`);
console.log(`API: ${API_URL}`);

const results = [];
for (const img of TEST_IMAGES) {
  const r = await classifyImage(img);
  if (r) results.push(r);
}

console.log('\n═════════════════════════════════════');
console.log('SUMMARY');
const correct = results.filter(r => r.correct).length;
console.log(`${correct}/${results.length} tests passed`);

if (correct === results.length) {
  console.log('\n✓ HF VLM classification works.');
  console.log('  Next: wire this API call into lib/inference.ts (online mode).');
  console.log('  Get your free HF token: https://huggingface.co/settings/tokens');
} else {
  console.log('\n⚠ Some misclassifications. The model may need a better prompt.');
  console.log('  Try adjusting CLASSIFICATION_PROMPT or switching to a different model.');
  console.log('  Alternative: Qwen/Qwen2.5-VL-7B-Instruct or microsoft/Phi-3.5-vision-instruct');
}
