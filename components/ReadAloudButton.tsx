/**
 * ReadAloudButton — the speaker on every page. Tap it and the page is read out
 * in short, plain sentences, for farmers who can't read the text. Tap again
 * (or leave the page) to stop. Offline: uses the phone's speech engine.
 */

import React, { useCallback, useRef, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated';
import Glass from './glass/Glass';
import PressableScale from './glass/PressableScale';
import { Pause, Speaker } from './glass/Icons';
import { GlassTone, useTheme } from '../lib/theme';
import { speakText, stopAll } from '../lib/voice';

interface Props {
  /** What to say. A function is only evaluated on tap, so it always reads the latest data. */
  text: string | (() => string);
  /** Glass tone; follows the phone's appearance by default ('dark' over the camera). */
  tone?: GlassTone;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export default function ReadAloudButton({ text, tone, size = 48, style }: Props) {
  const { g, glass } = useToneColors(tone);
  const [playing, setPlaying] = useState(false);
  const run = useRef(0);

  function stop() {
    run.current++;
    stopAll();
    setPlaying(false);
  }

  function toggle() {
    if (playing) return stop();
    const said = (typeof text === 'function' ? text() : text).trim();
    if (!said) return;
    const id = ++run.current;
    setPlaying(true);
    speakText(said, { onDone: () => run.current === id && setPlaying(false) });
  }

  // Leaving the page stops the reading.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useFocusEffect(
    useCallback(
      () => () => {
        if (playingRef.current) stop();
      },
      [],
    ),
  );

  return (
    <PressableScale
      onPress={toggle}
      hitSlop={6}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Stop reading' : 'Read this page aloud'}
    >
      <Glass radius={size / 2} tone={glass} style={[styles.round, { width: size, height: size }]}>
        {playing && <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: g.playing }]} />}
        <Animated.View key={playing ? 'stop' : 'speak'} entering={ZoomIn.springify().damping(14).stiffness(320)} exiting={ZoomOut.duration(100)}>
          {playing ? <Pause size={20} color="#FFFFFF" /> : <Speaker size={24} color={g.icon} />}
        </Animated.View>
      </Glass>
    </PressableScale>
  );
}

function useToneColors(tone?: GlassTone) {
  const theme = useTheme();
  const t = tone ?? theme.tone;
  return {
    glass: tone,
    g: { icon: t === 'dark' ? '#FFFFFF' : '#1E7B3C', playing: '#1E7B3C' },
  };
}

const styles = StyleSheet.create({
  round: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
