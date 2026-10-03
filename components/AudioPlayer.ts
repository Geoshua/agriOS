import { AudioPlayer, createAudioPlayer } from 'expo-audio';

// Map disease IDs to bundled audio assets
const AUDIO_ASSETS: Record<string, any> = {
  coffee_leaf_rust: require('../assets/audio/coffee_leaf_rust.mp3'),
  coffee_leaf_miner: require('../assets/audio/coffee_leaf_miner.mp3'),
  coffee_phoma: require('../assets/audio/coffee_phoma.mp3'),
  coffee_brown_eye: require('../assets/audio/coffee_brown_eye.mp3'),
  healthy: require('../assets/audio/healthy.mp3'),
  unknown: require('../assets/audio/unknown.mp3'),
};

export interface PlaybackHandlers {
  /** Called once the clip finishes or fails to play. */
  onDone?: () => void;
}

let current: AudioPlayer | null = null;

export async function playAdvisory(diseaseId: string, handlers: PlaybackHandlers = {}): Promise<void> {
  const asset = AUDIO_ASSETS[diseaseId];
  if (!asset) return handlers.onDone?.();

  // Stop anything currently playing
  await stopAll();

  try {
    const player = createAudioPlayer(asset);
    current = player;
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        subscription.remove();
        player.remove();
        if (current === player) current = null;
        handlers.onDone?.();
      }
    });
    player.play();
  } catch (e) {
    console.warn('Audio playback failed:', e);
    handlers.onDone?.();
  }
}

export async function stopAll(): Promise<void> {
  if (!current) return;
  try {
    current.pause();
    current.remove();
  } catch (_) {}
  current = null;
}
