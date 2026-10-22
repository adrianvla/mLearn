import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export type AttachmentPlaybackEvent =
  | { readonly kind: 'started' | 'completed' | 'interrupted' }
  | { readonly kind: 'failed'; readonly message: string };

export function AttachmentPlayer({ uri, label, height, disabled = false, onPlaybackEvent }: {
  readonly uri: string;
  readonly label: string;
  readonly height: number;
  readonly disabled?: boolean;
  readonly onPlaybackEvent?: (event: AttachmentPlaybackEvent) => void;
}) {
  const player = useVideoPlayer({ uri });
  const callback = useRef(onPlaybackEvent);
  callback.current = onPlaybackEvent;
  // Stop before useVideoPlayer's passive cleanup releases its native object.
  useLayoutEffect(() => () => { player.pause(); }, [player]);
  useEffect(() => {
    const playing = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) callback.current?.({ kind: 'started' });
      // Native/web players can emit paused just before their end event.
      else if (player.duration === 0 || player.currentTime < player.duration) {
        callback.current?.({ kind: 'interrupted' });
      }
    });
    const ended = player.addListener('playToEnd', () => callback.current?.({ kind: 'completed' }));
    const status = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') callback.current?.({ kind: 'failed', message: error?.message ?? 'Audio playback failed.' });
    });
    if (player.status === 'error') callback.current?.({ kind: 'failed', message: 'Media could not be loaded.' });
    return () => {
      playing.remove(); ended.remove(); status.remove();
    };
  }, [player]);
  // AVKit hides its controls in the compact audio height, leaving an inert preview.
  return <VideoView player={player} nativeControls={!disabled} contentFit="contain"
    style={styles.player(Platform.OS === 'ios' ? 200 : height)} accessibilityLabel={label} />;
}

const styles = StyleSheet.create(theme => ({
  player: (height: number) => ({ width: '100%', height, borderRadius: theme.radius, backgroundColor: theme.colors.background }),
}));
