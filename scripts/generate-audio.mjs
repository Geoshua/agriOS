/**
 * Generates MP3 advisory clips for each disease using ElevenLabs API.
 * Run: node scripts/generate-audio.mjs
 * Requires: ELEVENLABS_API_KEY in env
 *
 * Output: assets/audio/{disease_id}.mp3
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'assets', 'audio');
const API_KEY = process.env.ELEVENLABS_API_KEY;
// ElevenLabs Multilingual v2 — good Swahili/English quality
const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // "Sarah" — clear, natural
const MODEL_ID = 'eleven_multilingual_v2';

if (!API_KEY) {
  console.error('Set ELEVENLABS_API_KEY env var first.');
  process.exit(1);
}

const SCRIPTS = {
  coffee_leaf_rust: `
    Coffee Leaf Rust detected. This is a serious fungal disease that spreads fast in wet weather.
    You should act within 3 days. Remove and burn the most affected branches — do not add them to compost.
    Then apply a copper-based fungicide such as Copper Oxychloride to all remaining leaves.
    Repeat every two weeks while the rainy season continues.
    If left untreated, this disease can reduce your harvest by up to 50 percent.
  `,
  coffee_leaf_miner: `
    Coffee Leaf Miner detected. Small caterpillars are tunneling inside your leaves.
    You have about one week before this spreads significantly.
    Remove and destroy the affected leaves now. Then apply a neem-based insecticide or pyrethroid spray early in the morning.
    Check the surrounding plants to see how far it has spread.
  `,
  coffee_phoma: `
    Phoma Leaf Spot detected. This is a fungal disease common after cold or rainy weather at high altitude.
    Remove the spotted leaves and improve airflow by pruning any dense areas of the canopy.
    Apply a copper-based or systemic fungicide. Avoid watering from above.
    Monitor for the next week and contact your extension officer if it spreads.
  `,
  coffee_brown_eye: `
    Brown Eye Spot detected. This is often a sign that your plant is stressed or lacking nutrients — particularly nitrogen or potassium.
    Check your soil and apply a balanced fertilizer first.
    If the spots continue to spread, apply a copper spray.
    This is less urgent than other diseases, but address the nutrition issue soon.
  `,
  healthy: `
    Your plant looks healthy — no disease detected.
    Continue your regular care: check leaves after rain, maintain fertilization, and keep the canopy well-pruned.
    Come back in a few days and scan again.
  `,
  unknown: `
    The image is not clear enough to make a confident diagnosis.
    Please take a closer photo in good natural light, ideally of a single leaf with spots visible.
    If the problem continues or looks severe, contact your extension officer before applying any treatment.
    Do not spray without a confirmed diagnosis.
  `,
};

async function generateClip(id, text) {
  const outPath = path.join(OUT_DIR, `${id}.mp3`);
  if (fs.existsSync(outPath)) {
    console.log(`  ✓ ${id}.mp3 already exists, skipping.`);
    return;
  }

  console.log(`  Generating ${id}.mp3...`);
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text.trim(),
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`  ✗ Failed ${id}: ${response.status} ${err}`);
    return;
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(buffer));
  console.log(`  ✓ Saved ${id}.mp3 (${Math.round(buffer.byteLength / 1024)}KB)`);

  // Rate limit: ElevenLabs allows ~3 req/sec on free tier
  await new Promise(r => setTimeout(r, 500));
}

console.log('Generating Shamba advisory audio clips...\n');
for (const [id, script] of Object.entries(SCRIPTS)) {
  await generateClip(id, script);
}
console.log('\nDone. Add expo-av playback in AdvisorySheet using these files.');
