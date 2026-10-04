# agriOS — AI Design Constraints

## Who this app is for

**Noor** — a smallholder coffee farmer in East Africa. Every design decision must be evaluated against her reality:

- **Connectivity**: 2G or no signal in the field. Network requests time out without warning. The app must be fully usable offline. Online features are enhancements, never requirements.
- **Hardware**: Low-end Android phones (2–3 GB RAM, ARM Cortex-A53 or equivalent). No guaranteed camera autofocus. Slow storage I/O. Battery is scarce.
- **Literacy**: Noor may have limited reading ability. She may not read English at all. Prefer icons + colour coding over text. Any text should be short, plain, and translated or speakable.

---

## Hard constraints — never break these

### 1. Core feature works offline
The scan → classify → advise loop must complete without any network call. This means:
- TFLite model is bundled in `assets/model/` (not fetched at runtime)
- Disease advisory text comes from `assets/diseases.json` (not an API)
- Spoken advice plays from downloaded **voice packs** (pre-generated clips, offline); `expo-speech` (on-device) is the fallback. See `docs/VOICE.md`

When HF API is unavailable, the TFLite path runs. When TFLite is unavailable, the mock cycles. The app never shows a blank screen or "connect to the internet" error in the scan flow.

### 2. Model files stay small
Target: `plant_disease.tflite` ≤ 8 MB. Noor may need to receive an update over a shared WhatsApp group at 2G. Use INT8 quantisation. Do not add new model files without justification.

### 3. One interaction in local language
Voice packs (Settings → Voice & Language) with `expo-speech` as fallback. The default spoken language is set in `lib/settings.ts` (currently Gĩkũyũ `kik` for the hackathon); voice-note recognition follows the pack's `sttLanguage` in `assets/voice-packs/catalog.json`. Never ship with English as the only option. Decisions and GPU roadmap: `docs/VOICE.md`.

### 4. Human in the loop — inform, never act
The app shows a diagnosis and a recommendation. It **never** automatically orders inputs, contacts an agronomist, or takes any action on Noor's behalf. All logging is user-initiated (the "Log this issue" button). Advisory text ends with a recommendation, not a command.

### 5. No confident wrong answers
If `confidence < confidenceThreshold` (default 0.60), always return `diseaseId: 'unknown'` and show the expert-consult advisory. Do not lower this threshold to make the UI feel more decisive. A wrong confident answer is worse than an honest "unsure".

---

## Performance rules

- Inference loop: ≤ 1 fps (`setInterval` at 1000 ms in `scan.tsx`). Do not increase.
- Camera frames: captured via `expo-camera` at low resolution. Never request high-res unless the user explicitly taps to capture.
- SQLite: use the promise-lock pattern already in `lib/db.ts`. Never open multiple concurrent transactions.
- Network: always wrap in `AbortController` with a timeout (10 s for classification, 8 s for soil data, 30 s for STT transcription).
- Bundle size: audit any new dependency. Avoid polyfills, large icon packs, or charting libraries.

---

## UI / UX rules

- **Large touch targets**: buttons must be at least 44 × 44 dp. Noor may be wearing gloves or have rough hands.
- **High contrast**: use the existing green `#2D6A4F` palette. Do not introduce low-contrast text.
- **Icons over text**: status and severity are always shown with both a colour and an icon, never colour alone (accounts for colour blindness).
- **Progressive disclosure**: show the most critical info first (disease name + "Do this now"). Detailed treatment and soil data are below the fold.
- **No onboarding**: assume zero training. The UI must be self-evident from first open.
- **No logins**: no accounts, no registration, no email. All data is local.

---

## Data honesty rules (hackathon scoring: Data Grounding 15%)

When submitting to judges:
- Acknowledge PlantVillage's studio-image bias explicitly in the submission write-up.
- State that BRACOL images are field-condition coffee leaf photos (directly matches scenario).
- State that SoilGrids data is gridded at ~250 m resolution and may not reflect micro-scale field variation.
- State confidence thresholds and what "unknown" means in the UI.

Do not claim higher accuracy than what validation set shows. If val accuracy is 85%, say 85%.

---

## Datasets in use

| Dataset | What it covers | Offline? |
|---|---|---|
| BRACOL | Coffee leaf disease (4 classes + healthy) | Yes — baked into TFLite model |
| assets/diseases.json | Advisory text per disease | Yes — bundled |
| SoilGrids (ISRIC) | Soil pH + N + C + clay by GPS coord (~250 m) | Yes for the farm area — bundled grid `assets/soil/local-grid.json`; elsewhere hub → online, cached on phone |
| HF Whisper large-v3 | STT for 99 languages (no Gĩkũyũ — Swahili used) | No — falls back to text input |
| Meta MMS-TTS (`mms-tts-kik`, `mms-tts-eng`) | Pretrained voices for voice packs (CC-BY-NC 4.0) | Yes — clips pre-generated |
| ElevenLabs | English voice-pack clips (build time only) | Yes — clips pre-generated |
| HF Qwen2-VL-7B | VLM classification (online mode) | No — falls back to TFLite |

---

## Architecture summary

```
PHONE (offline-first)
├── Scan tab (1fps loop)
│     └── runInference(frameUri)
│           Tier 0: Hub server /classify  (LAN, 3s timeout)
│           Tier 1: HF Qwen2-VL           (online, 10s timeout)
│           Tier 2: TFLite on-device      (offline, uncomment when trained)
│           Tier 3: Mock cycling          (always works)
│
├── AdvisorySheet (components/advisory/)
│     ├── fetchAdvisory() → Hub /advisory → Ollama LLM → HF fallback
│     ├── Static fallback: diseases.json (offline)
│     ├── Voice pack clips (offline) → expo-speech fallback
│     ├── SpeechInput → Hub /transcribe → HF Whisper
│     ├── "Ask regional network" button → runCloudOffload() when unknown
│     └── handleLog → findNearestPlant (5m GPS) → SQLite
│
├── Map tab
│     ├── Disease pins from SQLite (offline)
│     └── Soil card → local grid → phone cache → Hub /soil (disk cache) → SoilGrids v2
│
├── Plants tab — per-plant history + trend (offline)
└── Report tab — summary stats (offline)

HUB SERVER (Pi / laptop at co-op, LAN)
├── /classify   → TFLite Python → HF Qwen2-VL
├── /advisory   → Ollama Qwen2.5-3B → HF fallback (personalised, multilingual)
├── /transcribe → HF Whisper proxy
├── /soil       → SoilGrids with 1-hour cache (shared across all farmers)
├── /offload    → proxy to cloud server (hard cases)
├── /sync       → anonymised scan data queue status + manual flush
└── background  → flushSyncQueue() every 60s when internet available

CLOUD SERVER (VPS or shared community server, internet)
├── Same classify/soil endpoints, larger model timeouts
├── /ingest  → receives anonymised scan batches from village hubs
└── /heatmap → aggregated disease map across all contributing villages

Data flow (when internet available):
  Hub anonymises GPS to ~10km, strips images, queues scan results
  → batch POST /ingest to cloud every 60s
  → cloud aggregates regional disease hotspots
  → extension officers / ministries query /heatmap for outbreak alerts
```

---

## File map (quick reference for new Claude Code instances)

| File | Role |
|---|---|
| `lib/config.ts` | Single source for `LOCAL_SERVER_URL` (hub server address) |
| `lib/inference.ts` | 4-tier inference + `runCloudOffload()` + `fetchAdvisory()` |
| `lib/db.ts` | SQLite: issues table + plants table, migrations |
| `lib/store.ts` | Zustand: in-memory mirror of DB, current detection |
| `lib/stt.ts` | STT: expo-audio recording + HF Whisper API |
| `lib/soil.ts` | Soil data: bundled local grid → phone cache → hub → SoilGrids v2; advisory text |
| `scripts/soil/build_local_grid.py` | Builds the offline soil grid for the farm area |
| `lib/config.ts` (`DEMO_MODE`, `DEMO_FARM`) | Demo farm in Kiambu: seed, map, logged scans and soil use it instead of GPS |
| `assets/diseases.json` | Offline disease knowledge base |
| `assets/model/` | TFLite model + labels.json (gitignored, must be trained) |
| `components/advisory/AdvisorySheet.tsx` | Disease detail sheet (medium/full detents), log-to-map |
| `lib/useLogIssue.ts`, `lib/plants.ts` | User-initiated logging + GPS plant association (5 m) |
| `lib/theme.ts`, `components/glass/` | Liquid Glass design system, light/dark palettes, motion tokens |
| `components/SpeechInput.tsx` | Voice input UI, language picker |
| `lib/voice.ts`, `lib/voicePacks.ts` | Advisory playback chain; voice-pack download/install |
| `app/(tabs)/settings.tsx` | Settings: voice & language packs |
| `scripts/voice/build_packs.py` | Builds voice packs into `server/voice-packs/` |
| `docs/VOICE.md` | Voice decisions, data honesty, GPU roadmap |
| `lib/insights.ts` | Pure insight engine: health, pentagon axes, suggestions, outcomes (tested) |
| `lib/useSubjectInsight.ts`, `components/insights/` | Tree/block report pages (`app/plant/[id]`, `app/block/[block]`), diagram, pentagon, history with photos, tagging |
| `lib/watering.ts`, `lib/tasks.ts`, `app/tasks.tsx`, `components/tasks/` | Watering plans/status and the To Do list |
| `lib/outcomes.ts` | "What worked" stats; hub sync (`POST /outcomes`, `GET /outcome-stats`) |
| `docs/INSIGHTS.md` | How insights, learning loop, watering and tasks work |
| `tests/` | `npm test` — Node's built-in runner, TS via type stripping |
| `app/(tabs)/scan.tsx` | Camera + 1fps inference loop |
| `app/(tabs)/map.tsx` | Disease pins + soil card |
| `app/(tabs)/plants.tsx` | Plant tracking + scan history timeline |
| `app/(tabs)/report.tsx` | Daily summary stats |
| `server/server.mjs` | Hub + cloud server (classify, advisory, offload, sync, ingest, heatmap) |
| `scripts/model_training/train.py` | Local GPU training script (BRACOL → TFLite) |
| `TRAINING.md` | Full training guide for GPU PC |
