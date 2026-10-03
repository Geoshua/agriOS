# Shamba — Setup Guide

## 1. Scaffold

```bash
npx create-expo-app@latest shamba --template blank-typescript
cd shamba
```

## 2. Install dependencies

```bash
npx expo install expo-camera expo-location expo-av expo-sqlite \
  react-native-maps zustand react-native-reanimated \
  react-native-gesture-handler expo-router @expo/vector-icons \
  expo-speech
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

If you skip this, the app uses on-device TTS via `expo-speech` (change the import in `AdvisorySheet.tsx`).

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

If ElevenLabs isn't set up, change AdvisorySheet.tsx line 7:
```ts
// from:
import { playAdvisory, stopAll } from './AudioPlayer';
// to:
import { playAdvisory, stopAll } from './AudioPlayerFallback';
```

## Google Maps API key

For the map screen on Android, add your key to `app.json`:
```json
"android": { "config": { "googleMaps": { "apiKey": "YOUR_KEY" } } }
```

Get one free at console.cloud.google.com → Maps SDK for Android.
