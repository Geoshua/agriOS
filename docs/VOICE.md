# Voice: decisions and roadmap

Decision record for how agriOS speaks to (and listens to) Noor — a smallholder
coffee farmer in East Africa with little or no connectivity, a low-end Android
phone, and possibly limited literacy (see `CLAUDE.md`).

_Last updated: 2026-10-04._

---

## Summary

| | Choice | Works offline? | Needs a GPU? |
|---|---|---|---|
| Hackathon languages | **Gĩkũyũ (Kikuyu)** + **English** | — | — |
| Spoken advice | Pre-generated **voice packs**, downloaded once | **Yes** | No |
| Gĩkũyũ voice | **Meta MMS-TTS** `facebook/mms-tts-kik` | Yes (pack) | No — generated on CPU |
| English voice | **ElevenLabs** (interim: MMS `mms-tts-eng`) | Yes (pack) | No |
| Pack delivery | Co-op hub over LAN → internet fallback | LAN only | No |
| Voice notes (speech → text) | HF Whisper large-v3, online; Gĩkũyũ speakers transcribed as **Swahili** | **No** | Only for the offline roadmap below |

Nothing in the voice stack is trained by us today. All models are used as
published (pretrained); the only thing we produce is audio clips.

---

## 1. Languages: Gĩkũyũ + English

- **Gĩkũyũ** is the language of Kenya's Central highlands (Kiambu, Nyeri,
  Murang'a, Kirinyaga) — the country's Arabica coffee heartland, where coffee
  leaf rust is endemic. It fits Noor's profile and our model's training data
  (BRACOL: Arabica, field conditions). It is "niche": no phone ships a Gĩkũyũ
  voice, and mainstream TTS/STT services don't cover it — exactly the gap a
  downloadable pack fills.
- **English** for the demo, judges and extension officers.
- **Default** is Gĩkũyũ (`lib/settings.ts`), per `CLAUDE.md` rule 3 ("never ship
  with English as the only option"). Until its pack is downloaded, advice falls
  back to English device speech.

Alternatives considered: Swahili (widely supported, not niche), Luganda
(Uganda — mostly Robusta country), Kinyarwanda (good fit; a candidate for the
next pack).

## 2. Voice packs instead of live speech

The field has no internet most of the time, so speech can't be generated or
fetched at the moment of advice.

- A **pack** = one MP3 per disease class (6 clips) + `manifest.json`
  (clip lengths, provider, review status). Built by
  `scripts/voice/build_packs.py` into `server/voice-packs/<code>/`.
- **Size:** ~0.6–0.7 MB per language (48 kbps mono MP3) — small enough to share
  over 2G or WhatsApp (`CLAUDE.md` rule 2 spirit).
- **Delivery order** (`lib/voicePacks.ts`):
  1. Co-op **hub** over Wi-Fi/LAN — `GET /voice-packs/<code>/…` on
     `server/server.mjs`. No internet needed.
  2. **Internet** fallback — the same files in this (public) repo via
     `VOICE_PACK_BASE_URL` in `lib/config.ts`.
- Downloads go to a staging folder and are swapped in only when complete, so a
  dropped connection never leaves a half-installed pack.
- **Playback chain** (`lib/voice.ts`), offline at every step:
  1. installed pack clip for the selected language →
  2. phone's own speech engine in that language (if the phone has a voice) →
  3. phone's speech engine in English.
- Only **fixed** advice can be pre-recorded (the scripts in
  `assets/voice-packs/scripts/`). Dynamic text (LLM advisory, notes) still uses
  device speech.

Users pick and download packs in **Settings → Voice & Language**.

## 3. Voice providers

### Gĩkũyũ → Meta MMS-TTS (`facebook/mms-tts-kik`)
- ElevenLabs and phone TTS engines don't support Gĩkũyũ; MMS is one of the few
  open models that does (1,100+ languages).
- Runs locally on CPU — the whole pack generated in ~2 minutes on the
  development laptop. No API key, no GPU.
- **Licence: CC-BY-NC 4.0 (non-commercial).** Fine for the hackathon and
  research pilots; a commercial deployment needs another voice (e.g. a VITS
  model trained on licensed native-speaker recordings — see §6).
- Quality is intelligible but robotic; MMS was trained largely on read
  religious text, so agronomy words may be mispronounced.

### English → ElevenLabs (`eleven_multilingual_v2`)
- Highest-quality, natural voice. Run with `ELEVENLABS_API_KEY` set; the key
  never ships in the app.
- **Interim:** the committed English pack was generated with MMS
  (`--provider mms`) because no ElevenLabs key was available on the build
  machine. Regenerate with:
  ```bash
  ELEVENLABS_API_KEY=... python scripts/voice/build_packs.py --langs en --force
  ```
- Check your ElevenLabs plan allows redistributing generated audio.

The Settings screen shows each installed pack's actual voice source, so the
interim English voice isn't misrepresented.

## 4. Voice notes (speech → text): online for now

- `components/SpeechInput.tsx` records with `expo-audio`; `lib/stt.ts` sends
  audio to **HF Whisper large-v3** (needs internet and `HF_API_KEY`). Offline,
  the farmer types instead.
- Whisper has **no Gĩkũyũ**. When the Gĩkũyũ pack is selected, notes default
  to **Swahili** recognition (most Gĩkũyũ speakers also speak Swahili) —
  `sttLanguage` in `assets/voice-packs/catalog.json`.
- Known gap: the selected language isn't yet passed to Whisper (it
  auto-detects), and the phone calls HF directly rather than the hub's
  `/transcribe`.

## 5. Data honesty

- The **Gĩkũyũ advice text is a draft** written without a native speaker
  (`assets/voice-packs/scripts/kik.json`, `"reviewed": false`). It must be
  checked by a Gĩkũyũ-speaking agronomist before farmers rely on it — a wrong
  spray instruction is a real risk. The app marks it **Draft** in Settings.
  After review, set `"reviewed": true` in the catalog and rebuild the pack.
- All voices are **synthetic**; say so in the submission.
- No speech dataset was used for training. MMS and Whisper are third-party
  pretrained models; cite them as such (Data Grounding, `CLAUDE.md`).

## 6. Roadmap — work that needs a GPU

> **The development laptop has no usable GPU.** Everything in §1–5 runs on CPU.
> The items below require a CUDA GPU machine (or a cloud GPU) and are not done.

### 6a. Offline Gĩkũyũ speech recognition — on the hub (no training)
- **Model:** Meta **MMS-1B-all** ASR (`facebook/mms-1b-all`), which has a
  Gĩkũyũ adapter (`kik`) — no fine-tuning needed for a first version.
- **Where it runs:** the co-op hub, behind the existing `POST /transcribe`
  route. Phones stay on the LAN; no internet.
- **Hardware:** ~1B parameters. A GPU with **≥ 8 GB VRAM** (e.g. RTX 3060)
  transcribes a 10 s note in well under a second. CPU-only works but is slow
  (several seconds per note) — acceptable for a pilot, not at scale.
- Verify accuracy on real farmer recordings before relying on it.

### 6b. Offline speech recognition on the phone — fine-tuning (training)
- **Goal:** a small model (Whisper-tiny/base, ~40–150 MB) that recognises
  Gĩkũyũ (and Swahili) directly on the phone with no hub.
- **Training:** fine-tune `openai/whisper-small` or `-base` on Gĩkũyũ speech.
  Needs a GPU with **≥ 16 GB VRAM** (e.g. RTX 4080/A4000, or a cloud A10/A100);
  expect several hours per run.
- **Data (to verify licences and availability):** Mozilla Common Voice (check
  for a Gĩkũyũ subset), Google FLEURS (Swahili; check Gĩkũyũ), and — best —
  recordings from local farmers/extension officers collected with consent.
- **App side:** needs a native module (`whisper.rn`) → a custom dev build, not
  Expo Go.

### 6c. A natural Gĩkũyũ voice — TTS fine-tuning (training)
- **Goal:** replace the robotic, non-commercially-licensed MMS voice.
- **Training:** fine-tune a VITS / MMS-TTS model on 1–5 hours of clean,
  consented recordings from a native Gĩkũyũ speaker (ideally reading the actual
  advisory scripts). GPU with **≥ 12 GB VRAM**; roughly a day of training.
- Output plugs straight into `build_packs.py` as a new provider.

---

## How-to

**Rebuild packs**
```bash
# one-off setup (CPU is fine)
pip install torch transformers imageio-ffmpeg

python scripts/voice/build_packs.py                       # all languages
python scripts/voice/build_packs.py --langs kik --force   # just Gĩkũyũ
```
Commit `server/voice-packs/` so the internet fallback serves the new files; a
running hub serves them immediately.

**Add a language** (e.g. Kinyarwanda `kin`)
1. Add an entry to `assets/voice-packs/catalog.json` (provider, `deviceTts`,
   `sttLanguage`, `reviewed: false`).
2. Add `assets/voice-packs/scripts/kin.json` with one script per disease id,
   translated and reviewed by a native speaker.
3. Register the scripts in `lib/voice.ts` (`SCRIPTS` map).
4. `python scripts/voice/build_packs.py --langs kin` and commit the pack.
