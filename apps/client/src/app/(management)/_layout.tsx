import { Tabs } from 'expo-router';

// Only these three bounded management views retain their presentation state.
// Activity workspaces keep the root Stack's existing resource lifetimes.
export default function ManagementLayout() {
  return <Tabs initialRouteName="index" backBehavior="history" tabBar={() => null}
    // Scenes are transparent so the native window material shows through; an unfocused scene is
    // therefore hidden (still mounted, keeping its state) rather than left beneath the focused one.
    screenOptions={({ navigation }) => ({ headerShown: false,
      sceneStyle: [{ backgroundColor: 'transparent' }, !navigation.isFocused() && { display: 'none' }] })}>
    <Tabs.Screen name="index" />
    <Tabs.Screen name="knowledge" />
    <Tabs.Screen name="materials" />
  </Tabs>;
}
