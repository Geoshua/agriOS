"""
Build downloadable voice packs — one per language — for the agriOS advisory.

Each pack is a folder of audio clips (one per disease class) plus a manifest:

    server/voice-packs/<code>/manifest.json
    server/voice-packs/<code>/<disease_id>.mp3|.wav

The hub server serves this folder over the co-op LAN (GET /voice-packs/...), so
phones download a pack once without internet and play it fully offline. The
app's bundled catalog lives in assets/voice-packs/catalog.json; spoken text in
assets/voice-packs/scripts/<code>.json.

Providers (set per language in the catalog):
  elevenlabs — ElevenLabs API. Needs ELEVENLABS_API_KEY in the environment.
               Optional ELEVENLABS_VOICE_ID (default "Sarah"), ELEVENLABS_MODEL.
  mms        — Meta MMS-TTS (facebook/mms-tts-<code>), runs locally on CPU.
               Needs: pip install torch transformers  (no API key; model is
               downloaded once, ~150 MB). Licence: CC-BY-NC 4.0 (non-commercial).

Usage:
  python scripts/voice/build_packs.py                 # all languages
  python scripts/voice/build_packs.py --langs kik     # just Kikuyu
  python scripts/voice/build_packs.py --force         # regenerate existing clips
  python scripts/voice/build_packs.py --langs en --provider mms --force
                                                      # interim English pack without an ElevenLabs key

MMS output is compressed to MP3 (~6x smaller than WAV) when ffmpeg is on PATH
or `pip install imageio-ffmpeg` is installed; otherwise clips stay WAV.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "assets" / "voice-packs" / "catalog.json"
SCRIPTS = ROOT / "assets" / "voice-packs" / "scripts"
OUT = ROOT / "server" / "voice-packs"

ELEVEN_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_64"
ELEVEN_KBPS = 64
# MMS uses ISO 639-3 codes; map catalog codes that differ.
MMS_CODES = {"en": "eng", "sw": "swh"}
SENTENCE_GAP_S = 0.35


# ── ElevenLabs ─────────────────────────────────────────────────────────────────

def eleven_clip(text: str) -> tuple[bytes, str, float, str]:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY is not set (needed for ElevenLabs packs).")
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")
    model = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
    body = json.dumps({
        "text": text,
        "model_id": model,
        "voice_settings": {"stability": 0.6, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True},
    }).encode()
    req = urllib.request.Request(
        ELEVEN_URL.format(voice=voice),
        data=body,
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        audio = res.read()
    time.sleep(0.5)  # stay well inside free-tier rate limits
    return audio, "mp3", len(audio) * 8 / (ELEVEN_KBPS * 1000), f"elevenlabs:{model}:{voice}"


# ── Meta MMS-TTS (local) ───────────────────────────────────────────────────────

_mms_cache: dict[str, tuple[object, object]] = {}


def mms_clip(text: str, code: str) -> tuple[bytes, str, float, str]:
    try:
        import torch
        from transformers import AutoTokenizer, VitsModel
    except ImportError:
        sys.exit("MMS packs need: pip install torch transformers")

    model_id = f"facebook/mms-tts-{code}"
    if model_id not in _mms_cache:
        print(f"  loading {model_id} …")
        _mms_cache[model_id] = (VitsModel.from_pretrained(model_id), AutoTokenizer.from_pretrained(model_id))
    model, tokenizer = _mms_cache[model_id]
    rate = model.config.sampling_rate

    # Speak sentence by sentence (VITS is steadier on short inputs), with a short pause between.
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    torch.manual_seed(0)  # deterministic voice across rebuilds
    pieces = []
    for sentence in sentences:
        inputs = tokenizer(sentence, return_tensors="pt")
        with torch.no_grad():
            wav = model(**inputs).waveform[0]
        pieces.append(wav)
        pieces.append(torch.zeros(int(rate * SENTENCE_GAP_S)))
    audio = torch.cat(pieces[:-1]).clamp(-1, 1)
    pcm = (audio.numpy() * 32767).astype("<i2").tobytes()

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    duration = len(pcm) / 2 / rate

    mp3 = to_mp3(buf.getvalue())
    if mp3:
        return mp3, "mp3", duration, model_id
    return buf.getvalue(), "wav", duration, model_id


def find_ffmpeg() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:  # pip install imageio-ffmpeg ships a static ffmpeg binary
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def to_mp3(wav_bytes: bytes) -> bytes | None:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        return None
    proc = subprocess.run(
        [ffmpeg, "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-b:a", "48k", "-f", "mp3", "pipe:1"],
        input=wav_bytes,
        capture_output=True,
    )
    return proc.stdout if proc.returncode == 0 and proc.stdout else None


# ── Build ──────────────────────────────────────────────────────────────────────

def build(pack: dict, force: bool, provider: str | None = None) -> None:
    code = pack["code"]
    provider = provider or pack["provider"]
    texts = json.loads((SCRIPTS / f"{code}.json").read_text(encoding="utf8"))
    texts = {k: v for k, v in texts.items() if not k.startswith("_")}
    out_dir = OUT / code
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    previous = json.loads(manifest_path.read_text(encoding="utf8")) if manifest_path.exists() else {"clips": {}}

    print(f"\n{pack['name']} ({code}) — provider: {provider}")
    clips, voice = {}, previous.get("voice")
    for disease_id, text in texts.items():
        old = previous["clips"].get(disease_id)
        if old and not force and previous.get("provider") == provider and (out_dir / old["file"]).exists():
            print(f"  ✓ {disease_id} (kept)")
            clips[disease_id] = old
            continue
        if provider == "elevenlabs":
            audio, ext, duration, voice = eleven_clip(text)
        elif provider == "mms":
            audio, ext, duration, voice = mms_clip(text, MMS_CODES.get(code, code))
        else:
            sys.exit(f"Unknown provider {provider!r} for {code}")
        file = f"{disease_id}.{ext}"
        for stale in out_dir.glob(f"{disease_id}.*"):
            stale.unlink()
        (out_dir / file).write_bytes(audio)
        clips[disease_id] = {"file": file, "bytes": len(audio), "durationSec": round(duration, 2)}
        print(f"  ✓ {disease_id} → {file} ({len(audio) // 1024} KB, {duration:.1f}s)")

    manifest = {
        "code": code,
        "name": pack["name"],
        "nativeName": pack["nativeName"],
        "version": int(time.time()),
        "provider": provider,
        "voice": voice,
        "reviewed": pack.get("reviewed", False),
        "synthetic": True,
        "clips": clips,
        "totalBytes": sum(c["bytes"] for c in clips.values()),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"  manifest: {manifest_path.relative_to(ROOT)} ({manifest['totalBytes'] // 1024} KB total)")


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf8"))
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--langs", nargs="*", help="language codes to build (default: all in the catalog)")
    parser.add_argument("--force", action="store_true", help="regenerate clips that already exist")
    parser.add_argument("--provider", choices=["elevenlabs", "mms"], help="override the catalog's provider")
    args = parser.parse_args()

    packs = [p for p in catalog["packs"] if not args.langs or p["code"] in args.langs]
    if not packs:
        sys.exit(f"No catalog languages match {args.langs}")
    for pack in packs:
        build(pack, args.force, args.provider)


if __name__ == "__main__":
    main()
