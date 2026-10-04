import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { getAllIssues } from '../lib/db';
import { seedDemoDataIfEmpty } from '../lib/seed';
import { useShambaStore } from '../lib/store';

export default function RootLayout() {
  // First launch: fill an empty database with demo history, then let the
  // map and report (which reload on store changes) pick it up.
  useEffect(() => {
    seedDemoDataIfEmpty()
      .then(async (seeded) => {
        if (seeded) useShambaStore.getState().setIssues(await getAllIssues());
      })
      .catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
