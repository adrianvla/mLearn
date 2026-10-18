// Specialist desktop media/input boundary. HTMLVideoElement owns playback;
// Rust owns saved position. Range inputs adapt desktop media controls, while
// ordinary actions use shared primitives. Native VideoView retains native input.
import { useRef, useEffect, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import type { MediaPlayerProps } from './MediaPlayer.types';
function timeLabel(seconds: number) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
export function MediaPlayer({ uri, initialPositionMs, paused, onProgress, onError, onController }: MediaPlayerProps) {
    const ref = useRef<HTMLVideoElement>(null);
    const { theme } = useUnistyles();
    const [controlHeight, setControlHeight] = useState(64);
    const [playback, setPlayback] = useState({
        position: initialPositionMs / 1000, duration: 0, playing: false, muted: false, volume: 1,
    });
    useEffect(() => { onController({
        subtitleBottomInset: controlHeight, pauseAndRead: () => { const v = ref.current; v?.pause(); return {
            positionMs: Math.round((v?.currentTime ?? 0) * 1000), durationMs: Math.round((v?.duration ?? 0) * 1000)
        }; }
    }); }, [controlHeight]);
    const callbacks = useRef({
        onProgress, onError
    });
    callbacks.current = {
        onProgress, onError
    };
    useEffect(() => {
        if (paused)
            ref.current?.pause();
    }, [paused]);
    useEffect(() => () => {
        const video = ref.current;
        if (video) {
            video.pause();
            callbacks.current.onProgress(video.currentTime * 1000, video.duration * 1000, true);
        }
    }, []);
    const progress = (checkpoint: boolean) => {
        const v = ref.current;
        if (v && Number.isFinite(v.duration)) {
            setPlayback({
                position: v.currentTime, duration: v.duration, playing: !v.paused,
                muted: v.muted, volume: v.volume,
            });
            callbacks.current.onProgress(Math.round(v.currentTime * 1000), Math.round(v.duration * 1000), checkpoint);
        }
    };
    return <View style={styles.player}><video
    ref={ref}
    src={uri}
    playsInline
    preload="metadata"
    aria-label="Local video player"
    style={{
        width: '100%', height: '100%', objectFit: 'contain', background: '#000'
    }}
    onLoadedMetadata={() => {
            if (ref.current) {
                ref.current.currentTime = Math.min(initialPositionMs / 1000, ref.current.duration);
                progress(false);
            }
        }}
    onTimeUpdate={() => progress(false)}
    onPlay={() => progress(false)}
    onVolumeChange={() => progress(false)}
    onSeeked={() => progress(true)}
    onPause={() => progress(true)}
    onEnded={() => progress(true)}
    onError={() => callbacks.current.onError(`This host could not decode the video (media error ${ref.current?.error?.code ?? 'unknown'}). Select a compatible local video; saved progress is preserved.`)}/>
    <View style={styles.controls} onLayout={event => setControlHeight(event.nativeEvent.layout.height)}>
        <Button label={playback.playing ? 'Ⅱ' : '▶'} accessibilityLabel={playback.playing ? 'Pause' : 'Play'}
            variant="media" size="compact" disabled={!playback.duration}
            onPress={() => {
                const video = ref.current;
                if (video) {
                    if (video.paused) {
                        void video.play().catch(error => callbacks.current.onError(String(error)));
                    } else {
                        video.pause();
                    }
                }
            }} />
        <input type="range" aria-label="Playback position" min={0} max={playback.duration} step="any"
            value={playback.position} disabled={!playback.duration}
            aria-valuetext={`${timeLabel(playback.position)} of ${timeLabel(playback.duration)}`}
            onChange={event => { if (ref.current) ref.current.currentTime = Number(event.currentTarget.value); }}
            style={{ flex: 1, minWidth: 100, accentColor: theme.media.text, cursor: 'pointer' }} />
        <Text tone="media" variant="caption">{timeLabel(playback.position)} / {timeLabel(playback.duration)}</Text>
        <Button label={playback.muted ? 'Unmute' : 'Mute'} accessibilityLabel={playback.muted ? 'Unmute' : 'Mute'}
            variant="media" size="compact"
            onPress={() => { if (ref.current) ref.current.muted = !ref.current.muted; }} />
        <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={playback.volume}
            onChange={event => { if (ref.current) ref.current.volume = Number(event.currentTarget.value); }}
            style={{ width: 72, accentColor: theme.media.text, cursor: 'pointer' }} />
    </View></View>;
}
const styles = StyleSheet.create(theme => ({
    player: { flex: 1, minHeight: 0 },
    controls: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12,
        paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.media.chrome,
    },
}));
