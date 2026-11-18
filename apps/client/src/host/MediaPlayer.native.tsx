import { AppState } from 'react-native';
import { useEffect, useRef } from 'react';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { MediaPlayerProps } from './MediaPlayer.types';
export function MediaPlayer({ uri, initialPositionMs, paused, playbackRate = 1, audioTrack, onAudioTracks, onProgress, onError, onController }: MediaPlayerProps) {
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
            subtitleBottomInset: 128,
            seekTo: positionMs => {
                player.currentTime = Math.max(0, Math.min(positionMs / 1000, player.duration > 0 ? player.duration : Infinity));
            },
            pauseAndRead: () => { player.pause(); lastProgress.current = {
                positionMs: Math.round(player.currentTime * 1000), durationMs: Math.round(player.duration * 1000)
            }; return lastProgress.current; }
        });
    }, [player]);
    useEffect(() => {
        const wasPlaying = player.playing;
        player.playbackRate = playbackRate;
        // Expo's iOS setter also assigns AVPlayer.rate, including on a paused
        // initial source. Changing speed must not start playback.
        if (!wasPlaying) player.pause();
    }, [player, playbackRate]);
    useEffect(() => {
        if (paused)
            player.pause();
    }, [paused, player]);
    useEffect(() => {
        const apply = () => {
            const tracks = player.availableAudioTracks;
            onAudioTracks?.(tracks.length);
            if (audioTrack != null && audioTrack < tracks.length) player.audioTrack = tracks[audioTrack];
        };
        apply();
        const subscription = player.addListener('availableAudioTracksChange', apply);
        return () => subscription.remove();
    }, [player, audioTrack]);
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
                callbacks.current.onError('This video can’t be played here. Your place is kept; choose another copy of the video.', error?.message);
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
    // iOS 27's AVVisualAnalysisView consumes the paused video's first tap.
    // Keep playback input with AVKit and language inspection with our captions.
    // Remove when the native Watch touch/skip flow passes with Live Text enabled.
    allowsVideoFrameAnalysis={false}
    contentFit="contain"
    style={{
        width: '100%', height: '100%'
    }}
    accessibilityLabel="Local video player"/>;
}
