# agriOS — Setup Guide

## 1. Scaffold

```bash
npx create-expo-app@latest agriOS --template blank-typescript
cd agriOS
```

## 2. Install dependencies

```bash
npx expo install expo-camera expo-location expo-audio expo-asset expo-sqlite \
  expo-file-system expo-image zustand react-native-reanimated \
  react-native-worklets react-native-gesture-handler expo-router @expo/vector-icons \
  expo-speech expo-blur react-native-svg expo-splash-screen
```

## 3. Copy files

Replace the generated files with those in this repo:
- `app/` folder
- `components/` folder
- `lib/` folder
- `assets/diseases.json`
- `babel.config.js`
- `metro.config.js`
- `tsconfig.json`
- `app.json`

## 4. Voice packs (optional — already committed)

Spoken advice comes from per-language voice packs in `server/voice-packs/`
(Gĩkũyũ and English are committed). To rebuild them:

```bash
pip install torch transformers imageio-ffmpeg   # CPU is fine
npm run build-voice-packs                        # ELEVENLABS_API_KEY=... for ElevenLabs voices
```

Phones download packs in **Settings → Voice & Language** (from the hub over
LAN, else the internet). Without a pack, the app uses on-device speech. Full
details: `docs/VOICE.md`.

## 5. Run

```bash
npx expo start
```

Scan the QR code with Expo Go on your phone.

## 6. TFLite model (swap in when ready)

```bash
npm run download-model
```

Then uncomment the real inference code in `lib/inference.ts`.

## Map tiles

The Field Map draws OpenStreetMap tiles itself (`components/map/TileMap.tsx`),
so no Google Maps API key is needed. Tiles are disk-cached for offline use.
Follow the OSM tile usage policy (https://operations.osmfoundation.org/policies/tiles/);
for heavy use, point `TILE_URL` at your own or a commercial tile server.
