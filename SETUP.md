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

## 4. Generate audio (optional but recommended)

```bash
ELEVENLABS_API_KEY=your_key npm run generate-audio
```

If you skip this, the app uses on-device TTS via `expo-speech` (see *Audio fallback* below).

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

## Audio fallback

The advisory sheet uses on-device TTS by default. Once the ElevenLabs MP3s are
generated, switch the import in `components/advisory/parts.tsx`:
```ts
// from:
import { playAdvisory, stopAll } from '../AudioPlayerFallback';
// to:
import { playAdvisory, stopAll } from '../AudioPlayer';
```

## Map tiles

The Field Map draws OpenStreetMap tiles itself (`components/map/TileMap.tsx`),
so no Google Maps API key is needed. Tiles are disk-cached for offline use.
Follow the OSM tile usage policy (https://operations.osmfoundation.org/policies/tiles/);
for heavy use, point `TILE_URL` at your own or a commercial tile server.
