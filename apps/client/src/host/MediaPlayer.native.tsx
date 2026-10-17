import { AppState } from 'react-native';
import { useEffect, useRef } from 'react';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { MediaPlayerProps } from './MediaPlayer.types';
export function MediaPlayer({ uri, initialPositionMs, paused, onProgress, onError, onController }: MediaPlayerProps) {
    const lastProgress = useRef({
        positionMs: initialPositionMs, durationMs: 0
    });
    const callbacks = useRef({
        onProgress, onError
    });
    callbacks.current = {
        onProgress, onError
    };
    const player = useVideoPlayer({
        uri
    }, p => { p.timeUpdateEventInterval = 0.25; p.currentTime = initialPositionMs / 1000; });
    useEffect(() => {
        // targets above both; the web renderer owns its smaller control inset separately.
        onController({
            subtitleBottomInset: 128, pauseAndRead: () => { player.pause(); lastProgress.current = {
                positionMs: Math.round(player.currentTime * 1000), durationMs: Math.round(player.duration * 1000)
            }; return lastProgress.current; }
        });
    }, [player]);
    useEffect(() => {
        if (paused)
            player.pause();
    }, [paused, player]);
    useEffect(() => {
        const report = (checkpoint: boolean) => {
            if (Number.isFinite(player.duration) && player.duration > 0) {
                lastProgress.current = {
                    positionMs: Math.round(player.currentTime * 1000), durationMs: Math.round(player.duration * 1000)
                };
                callbacks.current.onProgress(lastProgress.current.positionMs, lastProgress.current.durationMs, checkpoint);
            }
        };
        const appState = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                player.pause();
                report(true);
            }
        });
        const time = player.addListener('timeUpdate', () => report(false));
        const playing = player.addListener('playingChange', ({ isPlaying }) => {
            if (!isPlaying)
                report(true);
        });
        const status = player.addListener('statusChange', ({ status, error }) => {
            if (status === 'error')
                callbacks.current.onError(error?.message ?? 'Video unavailable. Reselect a compatible local file.');
        });
        return () => {
            // Expo releases the shared player in its earlier hook cleanup. Never read it here.
            appState.remove();
            time.remove();
            playing.remove();
            status.remove();
            callbacks.current.onProgress(lastProgress.current.positionMs, lastProgress.current.durationMs, true);
        };
    }, [player]);
    return <VideoView
    player={player}
    nativeControls
    contentFit="contain"
    style={{
        width: '100%', height: '100%'
    }}
    accessibilityLabel="Local video player"/>;
}
