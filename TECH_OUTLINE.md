# agriOS — Technical Outline

> World Bank "Small AI for Development" Hackathon — Oct 3–4, 2026

---

## Technical Features

### 1. Real-time coffee disease detection
- **What:** Live 1-fps camera loop classifies coffee leaf frames as the farmer points their phone
- **How:** `app/(tabs)/scan.tsx` fires an inference every 1.2 seconds using `expo-camera`; result drives the AR overlay and detection pill immediately

### 2. 4-tier inference cascade (offline-first)
- **Tier 0 — Hub server (LAN, ~100ms):** Raspberry Pi at the co-op runs a Python TFLite subprocess + Qwen2-VL-7B via HuggingFace; phone POSTs a JPEG, gets back a disease label
- **Tier 1 — HuggingFace Qwen2-VL-7B (online, ~5s):** Vision-language model used when hub is unreachable and phone has internet
- **Tier 2 — TFLite on-device (offline, <1s):** MobileNetV2 INT8 trained on BRACOL coffee disease dataset; model ≤8MB, sideloadable over 2G; currently commented out pending GPU training
- **Tier 3 — Mock cycling (always works):** Deterministic rotation of all classes; ensures blank screen never appears

### 3. Multilingual AI advisory (Ollama LLM)
- **What:** When the farmer opens the full advice sheet, a personalised advisory is fetched from the local Ollama instance (Qwen2.5-3B-Instruct)
- **How:** `components/advisory/AdvisorySheet.tsx` fires `fetchAdvisory({diseaseId, confidence, language})` on detent → 'full'; hub `/advisory` endpoint routes to Ollama → HF fallback; result displayed in "AI Advisory" section
- **Fallback:** If hub unreachable, section is hidden silently; static `diseases.json` text is always shown

### 4. Voice-first advisory playback (offline TTS)
- **What:** Farmer can hear the diagnosis read aloud — critical for low-literacy users
- **How:** `expo-speech` (on-device, free, 99+ languages); `VoiceBar` component in `components/advisory/parts.tsx`; language configurable in `lib/stt.ts`

### 5. Voice input / speech-to-text observations
- **What:** Farmer can dictate field notes in any language
- **How:** `expo-av` records audio → hub `/transcribe` → HuggingFace Whisper large-v3; falls back to text keyboard

### 6. GPS-tagged scans + anonymised data contribution
- **What:** Each scan is tagged with a coarsened (~10 km) GPS coordinate and contributed to a regional disease heatmap
- **How:** `lib/location.ts → getQuickLocation()` refreshed every 30s and cached in Zustand; passed as `{lat, lng}` to hub `/classify`; hub anonymises to 10 km grid and queues entry in memory; background task flushes to cloud `/ingest` every 60s

### 7. Queued cloud offload (async retry)
- **What:** When the user taps "Ask regional network" for an unknown disease, the photo is sent to a cloud server with a larger model; if the hub is unreachable, the request is saved locally and retried automatically
- **How:** `queueOffload()` in `lib/db.ts` writes to SQLite `pending_offloads` table; `useOffloadQueue` hook in `lib/useOffloadQueue.ts` listens for `AppState active` events and retries via `runCloudOffload()`

### 8. Plant-level issue tracking (SQLite)
- **What:** Logged scans are grouped to individual plants via GPS proximity (5 m Haversine); farmers build a per-plant disease history over time
- **How:** `lib/db.ts` — `issues` and `plants` tables; `lib/plants.ts → assignPlant()` finds the nearest plant or auto-creates one; `app/(tabs)/plants.tsx` renders a timeline

### 9. Soil data overlay (SoilGrids)
- **What:** Soil pH, nitrogen, clay % shown for the farmer's location — contextualises disease risk
- **How:** `lib/soil.ts` — tries hub `/soil` first (1-hour cache shared across all farmers on the LAN), then direct SoilGrids REST API; hub caches in-memory so 100 phones only make 1 upstream call per hour

### 10. Hub/cloud dual-mode server
- **What:** Same `server/server.mjs` binary runs as a village hub (Pi/laptop at co-op) or cloud aggregation node; mode set by `ROLE=hub` / `ROLE=cloud` env var
- **How:** Hub mode: runs classify/advisory/soil/offload/sync; background `flushSyncQueue()` batches anonymised data to cloud; Cloud mode: exposes `/ingest` (receives batches) and `/heatmap` (disease aggregation by region)

### 11. Liquid Glass UI
- **What:** Two-detent advisory sheet (medium = glass blur, full = opaque paper) with spring physics and camera parallax effect
- **How:** `react-native-reanimated` + `react-native-gesture-handler`; single `SharedValue<number>` drives sheet geometry, material, and camera scale simultaneously

### 12. Responsible AI safeguards
- **What:** No confident wrong answers; app never acts autonomously
- **How:** Confidence threshold 0.60 — any result below returns `diseaseId: 'unknown'`; all logging is user-initiated; advisory text ends with a recommendation, not a command; data contribution is anonymised (GPS coarsened, no images sent to cloud)

---

## How the Components Connect

```
┌─────────────────────────────────────────────────────────────┐
│                    PHONE (React Native / Expo)               │
│                                                             │
│  app/(tabs)/scan.tsx                                        │
│  ├─ CameraView (1fps loop)                                  │
│  ├─ runInference(frameUri, {lat,lng})  ←── lib/inference.ts │
│  │   Tier 0: POST hub/classify  ──────────────────────┐    │
│  │   Tier 1: HF Qwen2-VL                              │    │
│  │   Tier 3: Mock                                      │    │
│  ├─ setLastFrameUri / setLastKnownLocation             │    │
│  │   (Zustand store — lib/store.ts)                    │    │
│  └─ useOffloadQueue()  ←── lib/useOffloadQueue.ts      │    │
│       AppState.active → retry pending_offloads (SQLite) │    │
│                                                             │
│  components/advisory/AdvisorySheet.tsx                      │
│  ├─ detent: closed → medium → full                          │
│  ├─ fetchAdvisory()  ←── lib/inference.ts                   │
│  │   POST hub/advisory → Ollama → HF fallback              │
│  ├─ runCloudOffload()  ←── lib/inference.ts                 │
│  │   POST hub/offload → cloud (35s timeout)                 │
│  │   on fail → queueOffload()  ←── lib/db.ts (SQLite)      │
│  ├─ VoiceBar + expo-speech (offline TTS)                    │
│  └─ SpeechInput → hub/transcribe → HF Whisper              │
│                                                             │
│  lib/db.ts  (expo-sqlite)                                   │
│  ├─ issues table        ← logIssue()                        │
│  ├─ plants table        ← createPlant() / findNearestPlant()│
│  └─ pending_offloads    ← queueOffload() / resolveOffload() │
│                                                             │
│  lib/store.ts  (Zustand)                                    │
│  ├─ currentDetection                                        │
│  ├─ lastFrameUri        → AdvisorySheet offload             │
│  └─ lastKnownLocation   → /classify body (GPS tag)         │
└──────────────────────┬──────────────────────────────────────┘
                       │ LAN (Wi-Fi at co-op)
┌──────────────────────▼──────────────────────────────────────┐
│              HUB SERVER  (Raspberry Pi / laptop)             │
│              server/server.mjs  ROLE=hub                     │
│                                                             │
│  POST /classify   → TFLite Python subprocess                │
│                     → HF Qwen2-VL-7B (fallback)            │
│                     → queueScan() anonymises GPS, queues    │
│  POST /advisory   → Ollama Qwen2.5-3B-Instruct              │
│                     → HF Qwen2-VL text (fallback)           │
│  GET  /soil       → SoilGrids REST (1h in-memory cache)     │
│  POST /offload    → proxies to cloud /classify (35s)        │
│  POST /transcribe → HF Whisper large-v3                     │
│  background       → flushSyncQueue() every 60s              │
│                     batch POST to cloud /ingest             │
└──────────────────────┬──────────────────────────────────────┘
                       │ Internet (occasional)
┌──────────────────────▼──────────────────────────────────────┐
│              CLOUD SERVER  (VPS / shared community server)   │
│              server/server.mjs  ROLE=cloud                   │
│                                                             │
│  POST /classify   → larger HF model (longer timeout)        │
│  POST /ingest     → stores anonymised scan batches          │
│  GET  /heatmap    → aggregated disease map by ~10km region  │
│                     (for extension officers / ministries)   │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow Summary

| Event | Path | Offline? |
|---|---|---|
| Farmer scans leaf | Camera → runInference → hub or HF or mock | Tier 3 always works |
| Disease name + severity shown | diseases.json → UI | Yes |
| "Do This Now" steps | diseases.json → UI | Yes |
| AI Advisory text | hub /advisory → Ollama | No — silent fallback |
| Voice playback | expo-speech (on-device TTS) | Yes |
| Voice input (notes) | expo-av → hub /transcribe → HF Whisper | No — text fallback |
| Log to map | GPS → findNearestPlant → SQLite | Yes |
| Soil card | hub /soil (cached) → SoilGrids | No — skipped offline |
| "Ask regional network" | hub /offload → cloud — OR queued to SQLite | Queued if offline |
| Data contribution | Anonymised GPS scan → hub queue → cloud /ingest | Batched on reconnect |
| Regional heatmap | Cloud /heatmap → extension officer dashboard | Cloud only |

---

## Key Technical Choices

| Decision | Rationale |
|---|---|
| React Native / Expo SDK 57 | Cross-platform (Android + iOS) from one codebase; Noor likely has Android |
| Offline-first architecture | 2G or no signal is the default, not the exception |
| Hub server at co-op (not cloud) | Sub-100ms LAN latency vs 5–10s cloud; works without internet |
| Ollama local LLM (Qwen2.5-3B) | No API cost; runs on a Pi 5 or laptop; personalised advisory in local language |
| TFLite INT8 ≤8MB | Fits in a WhatsApp message; sideloadable over 2G; no App Store required |
| SQLite queue for offloads | Reliable retry without a message broker; survives app restarts |
| GPS coarsened to 10km | Anonymisation before contributing data; farmer privacy preserved |
| Confidence threshold 0.60 | Responsible AI: "unknown" is better than a confident wrong answer |
| expo-speech (not ElevenLabs) | Free, offline, 99+ languages; no API key required on the phone |

---

## File Map

| File | Role |
|---|---|
| `app/(tabs)/scan.tsx` | Camera loop, mode rail, advisory sheet host |
| `app/(tabs)/map.tsx` | Disease pins + soil card |
| `app/(tabs)/plants.tsx` | Per-plant history timeline |
| `app/(tabs)/report.tsx` | Daily summary stats |
| `components/advisory/AdvisorySheet.tsx` | Two-detent glass advisory sheet |
| `components/advisory/parts.tsx` | VoiceBar, LogButton, Checklist, NumberedList |
| `lib/inference.ts` | 4-tier inference + fetchAdvisory + runCloudOffload |
| `lib/db.ts` | SQLite: issues, plants, pending_offloads |
| `lib/store.ts` | Zustand: currentDetection, lastFrameUri, lastKnownLocation |
| `lib/location.ts` | getQuickLocation() (expo-location) |
| `lib/useOffloadQueue.ts` | AppState-driven retry hook for pending cloud offloads |
| `lib/soil.ts` | SoilGrids + hub /soil proxy |
| `lib/stt.ts` | STT recording + HF Whisper |
| `lib/config.ts` | LOCAL_SERVER_URL (hub IP, set by operator) |
| `assets/diseases.json` | Offline disease knowledge base (5 diseases + unknown) |
| `assets/model/` | TFLite model + labels (gitignored, GPU-trained) |
| `server/server.mjs` | Hub + cloud server (all endpoints) |
| `scripts/model_training/train.py` | BRACOL → TFLite training script |
