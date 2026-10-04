import { Tabs } from 'expo-router';
import GlassTabBar from '../../components/glass/GlassTabBar';
import { colors } from '../../lib/theme';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="scan" options={{ title: 'Scan' }} />
      <Tabs.Screen name="map" options={{ title: 'Field Map' }} />
      <Tabs.Screen name="plants" options={{ title: 'My Plants' }} />
      <Tabs.Screen name="report" options={{ title: 'Report' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
