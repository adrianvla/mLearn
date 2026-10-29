import { Tabs } from 'expo-router';

// Only these three bounded management views retain their presentation state.
// Activity workspaces keep the root Stack's existing resource lifetimes.
export default function ManagementLayout() {
  return <Tabs initialRouteName="index" backBehavior="history" tabBar={() => null}
    screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}>
    <Tabs.Screen name="index" />
    <Tabs.Screen name="knowledge" />
    <Tabs.Screen name="materials" />
  </Tabs>;
}
