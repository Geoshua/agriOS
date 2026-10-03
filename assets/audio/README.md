# Audio Assets

Generate these MP3 files by running:

```bash
ELEVENLABS_API_KEY=your_key npm run generate-audio
```

Required files (app will load silently if missing):
- coffee_leaf_rust.mp3
- coffee_leaf_miner.mp3
- coffee_phoma.mp3
- coffee_brown_eye.mp3
- healthy.mp3
- unknown.mp3

For offline-only use, you can also use expo-speech (device TTS) instead.
To switch, edit components/AudioPlayer.ts and replace Sound.createAsync with Speech.speak().
