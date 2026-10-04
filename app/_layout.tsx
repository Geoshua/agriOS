import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { getAllIssues } from '../lib/db';
import { seedDemoDataIfEmpty } from '../lib/seed';
import { loadSettings } from '../lib/settings';
import { syncOutcomes } from '../lib/outcomes';
import { useShambaStore } from '../lib/store';

// Deep links into /plant/… or /block/… still get the tabs underneath, so Back works.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  // First launch: fill an empty database with demo history, then let the
  // map and report (which reload on store changes) pick it up.
  useEffect(() => {
    loadSettings().then((s) => useShambaStore.getState().setVoiceLanguage(s.voiceLanguage));
    seedDemoDataIfEmpty()
      .then(async (seeded) => {
        if (seeded) {
          useShambaStore.getState().setIssues(await getAllIssues());
          useShambaStore.getState().bumpData();
        }
      })
      .catch(() => {});

    // Learning loop: share new outcomes with the co-op hub and refresh regional
    // stats on launch and whenever the app comes back (silent no-op offline).
    syncOutcomes().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncOutcomes().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </GestureHandlerRootView>
  );
}
