import { useVideoPlayer, VideoView } from 'expo-video';
import { Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export function AttachmentPlayer({ uri, label, height }: {
  readonly uri: string;
  readonly label: string;
  readonly height: number;
}) {
  const player = useVideoPlayer({ uri });
  // AVKit hides its controls in the compact audio height, leaving an inert preview.
  return <VideoView player={player} nativeControls contentFit="contain"
    style={styles.player(Platform.OS === 'ios' ? 200 : height)} accessibilityLabel={label} />;
}

const styles = StyleSheet.create(theme => ({
  player: (height: number) => ({ width: '100%', height, borderRadius: theme.radius, backgroundColor: theme.colors.background }),
}));
