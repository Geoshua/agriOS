import { Audio } from 'expo-av';

const soundCache: Record<string, Audio.Sound> = {};

// Map disease IDs to bundled audio assets
const AUDIO_ASSETS: Record<string, any> = {
  coffee_leaf_rust: require('../assets/audio/coffee_leaf_rust.mp3'),
  coffee_leaf_miner: require('../assets/audio/coffee_leaf_miner.mp3'),
  coffee_phoma: require('../assets/audio/coffee_phoma.mp3'),
  coffee_brown_eye: require('../assets/audio/coffee_brown_eye.mp3'),
  healthy: require('../assets/audio/healthy.mp3'),
  unknown: require('../assets/audio/unknown.mp3'),
};

export async function playAdvisory(diseaseId: string): Promise<void> {
  const asset = AUDIO_ASSETS[diseaseId];
  if (!asset) return;

  // Stop anything currently playing
  await stopAll();

  try {
    if (soundCache[diseaseId]) {
      await soundCache[diseaseId].replayAsync();
      return;
    }
    const { sound } = await Audio.Sound.createAsync(asset, { shouldPlay: true });
    soundCache[diseaseId] = sound;
    sound.setOnPlaybackStatusUpdate(status => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
        delete soundCache[diseaseId];
      }
    });
  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}

export async function stopAll(): Promise<void> {
  for (const [id, sound] of Object.entries(soundCache)) {
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch (_) {}
    delete soundCache[id];
  }
}
