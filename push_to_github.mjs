/**
 * Push all shamba files to GitHub via API
 * Strategy: use Contents API to init repo with first file, then blob/tree for the rest.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OWNER = 'Geoshua';
const REPO = 'agriOS';
const BASE = 'https://api.github.com';

async function api(method, endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GitHub ${method} ${endpoint} → ${res.status}: ${JSON.stringify(data).slice(0,300)}`);
  return data;
}

const GITIGNORE = `node_modules/
.expo/
dist/
.env
*.tflite
assets/audio/*.mp3
assets/model/
*.log
`;

const FILES = [
  'SETUP.md',
  'app.json',
  'babel.config.js',
  'metro.config.js',
  'package.json',
  'tsconfig.json',
  'app/_layout.tsx',
  'app/index.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/scan.tsx',
  'app/(tabs)/map.tsx',
  'app/(tabs)/report.tsx',
  'assets/diseases.json',
  'assets/audio/README.md',
  'components/AdvisorySheet.tsx',
  'components/AudioPlayer.ts',
  'components/AudioPlayerFallback.ts',
  'lib/db.ts',
  'lib/inference.ts',
  'lib/store.ts',
  'scripts/generate-audio.mjs',
  'scripts/download-model.mjs',
  'scripts/test_model_api.mjs',
  'scripts/test_hf_api.mjs',
  'scripts/model_training/train_colab.py',
  'lib/stt.ts',
  'lib/soil.ts',
  'components/SpeechInput.tsx',
];

console.log(`Initialising ${OWNER}/${REPO} and pushing ${FILES.length + 1} files...\n`);

// Step 1: Init repo via Contents API (creates the first commit)
const initContent = Buffer.from(GITIGNORE).toString('base64');
const initResult = await api('PUT', `/repos/${OWNER}/${REPO}/contents/.gitignore`, {
  message: 'Initial commit — agriOS app (World Bank Small AI Hackathon 2026)',
  content: initContent,
  branch: 'main',
});
const headSha = initResult.commit.sha;
const baseTreeSha = initResult.commit.tree.sha;
console.log('  ✓ .gitignore (repo initialised)');
console.log(`  HEAD: ${headSha}`);
console.log(`  base tree: ${baseTreeSha}\n`);

// Step 2: Upload remaining files as blobs in batches
const treeEntries = [];
for (let i = 0; i < FILES.length; i += 6) {
  const batch = FILES.slice(i, i + 6);
  const results = await Promise.all(batch.map(async (rel) => {
    const abs = path.join(__dirname, rel);
    const content = fs.readFileSync(abs).toString('base64');
    const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content,
      encoding: 'base64',
    });
    console.log(`  ✓ ${rel}`);
    return { path: rel, mode: '100644', type: 'blob', sha: blob.sha };
  }));
  treeEntries.push(...results);
}

// Step 3: Create tree (base = initial commit's tree, so .gitignore stays)
console.log('\nCreating tree...');
const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  base_tree: baseTreeSha,
  tree: treeEntries,
});

// Step 4: Create commit on top of init commit
console.log('Creating commit...');
const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: 'Add all agriOS source files',
  tree: tree.sha,
  parents: [headSha],
});

// Step 5: Update main branch
console.log('Updating main branch...');
await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/main`, {
  sha: commit.sha,
  force: false,
});

console.log('\n✓ Done!');
console.log('  https://github.com/Geoshua/agriOS');
