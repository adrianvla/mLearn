// Specialist desktop media/input boundary. HTMLVideoElement owns playback;
// Rust owns saved position. Range inputs adapt desktop media controls, while
// ordinary actions use shared primitives. Native VideoView retains native input.
import { useRef, useEffect, useState, useCallback } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import type { MediaPlayerProps } from './MediaPlayer.types';
function timeLabel(seconds: number) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
/** Keep the native range's keyboard and pointer semantics, with media-owned visuals. */
function MediaRange({ label, value, maximum, onChange, valueText, compact = false }: {
    readonly label: string;
    readonly value: number;
    readonly maximum: number;
    readonly onChange: (value: number) => void;
    readonly valueText?: string;
    readonly compact?: boolean;
}) {
    const [focused, setFocused] = useState(false);
    const ratio = maximum ? Math.min(1, Math.max(0, value / maximum)) : 0;
    return <View style={[styles.range(compact), focused && styles.rangeFocus]}>
        <View style={styles.track(compact)}><View style={[styles.filledTrack(compact), { width: `${ratio * 100}%` }]} /></View>
        <View pointerEvents="none" style={[styles.thumb(compact), { left: `${ratio * 100}%` }]} />
        <input type="range" aria-label={label} min={0} max={maximum} step="any"
            value={value} disabled={!maximum} aria-valuetext={valueText}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onChange={event => onChange(Number(event.currentTarget.value))}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                margin: 0, opacity: 0, cursor: 'pointer' }} />
    </View>;
}
export function MediaPlayer({ uri, initialPositionMs, paused, playbackRate = 1, controls, onProgress, onError, onController }: MediaPlayerProps) {
    const ref = useRef<HTMLVideoElement>(null);
    const pendingPositionMs = useRef(initialPositionMs);
    const [controlHeight, setControlHeight] = useState(64);
    const [fullscreen, setFullscreen] = useState(false);
    const [playback, setPlayback] = useState({
        position: initialPositionMs / 1000, duration: 0, playing: false, muted: false, volume: 1,
    });
    const seekTo = useCallback((positionMs: number) => {
        pendingPositionMs.current = Math.max(0, positionMs);
        const video = ref.current;
        if (video && video.readyState >= 1) {
            video.currentTime = Math.min(pendingPositionMs.current / 1000, video.duration);
        }
    }, []);
    useEffect(() => { onController({
        subtitleBottomInset: controlHeight, seekTo, pauseAndRead: () => { const v = ref.current; v?.pause(); return {
            positionMs: Math.round((v?.currentTime ?? 0) * 1000), durationMs: Math.round((v?.duration ?? 0) * 1000)
        }; }
    }); }, [controlHeight, seekTo]);
    const callbacks = useRef({
        onProgress, onError, paused
    });
    callbacks.current = {
        onProgress, onError, paused
    };
    const togglePlayback = useCallback(() => {
        const video = ref.current;
        if (!video || callbacks.current.paused)
            return;
        if (video.paused)
            void video.play().catch(error => callbacks.current.onError(String(error)));
        else
            video.pause();
    }, []);
    const toggleFullscreen = useCallback(() => {
        const doc = ref.current?.ownerDocument;
        if (!doc)
            return;
        // Include source controls, subtitles and portaled Inspector UI, not video alone.
        if (!doc.fullscreenEnabled || !doc.documentElement.requestFullscreen || !doc.exitFullscreen) {
            callbacks.current.onError('Fullscreen with source and Inspector overlays is unavailable on this host.');
            return;
        }
        const request = doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen();
        void request.catch(error => callbacks.current.onError(`Fullscreen failed: ${String(error)}`));
    }, []);
    useEffect(() => {
        const video = ref.current;
        if (!video)
            return;
        const doc = video.ownerDocument;
        let composing = false;
        const compositionStart = () => { composing = true; };
        const compositionEnd = () => { composing = false; };
        const fullscreenChange = () => setFullscreen(doc.fullscreenElement === doc.documentElement);
        const keydown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || composing || event.keyCode === 229 ||
                event.altKey || event.ctrlKey || event.metaKey || event.repeat || callbacks.current.paused ||
                !video.isConnected || !video.getClientRects().length)
                return;
            const target = event.target;
            if (target instanceof Element && (
                target.closest('input, textarea, select, button, [role="button"], [role="textbox"], [role="combobox"], [role="listbox"], dialog, [role="dialog"], [role="alertdialog"]') ||
                target instanceof HTMLElement && target.isContentEditable))
                return;
            if (Array.from(doc.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'))
                .some(dialog => dialog.getClientRects().length > 0))
                return;
            if (event.shiftKey && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                return;
            switch (event.key) {
                case ' ':
                    togglePlayback();
                    break;
                case 'ArrowLeft':
                case 'ArrowRight':
                    seekTo(video.currentTime * 1000 + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10000 : 5000));
                    break;
                case 'm':
                case 'M':
                    video.muted = !video.muted;
                    break;
                case 'f':
                case 'F':
                    toggleFullscreen();
                    break;
                default:
                    return;
            }
            event.preventDefault();
        };
        fullscreenChange();
        doc.addEventListener('keydown', keydown);
        doc.addEventListener('compositionstart', compositionStart);
        doc.addEventListener('compositionend', compositionEnd);
        doc.addEventListener('fullscreenchange', fullscreenChange);
        return () => {
            doc.removeEventListener('keydown', keydown);
            doc.removeEventListener('compositionstart', compositionStart);
            doc.removeEventListener('compositionend', compositionEnd);
            doc.removeEventListener('fullscreenchange', fullscreenChange);
        };
    }, [seekTo, togglePlayback, toggleFullscreen]);
    useEffect(() => {
        if (ref.current)
            ref.current.playbackRate = playbackRate;
    }, [playbackRate, uri]);
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
                seekTo(pendingPositionMs.current);
                ref.current.playbackRate = playbackRate;
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
    <View testID="media-controls" style={styles.controls} onLayout={event => setControlHeight(event.nativeEvent.layout.height)}>
        <MediaRange label="Playback position" value={playback.position} maximum={playback.duration}
            valueText={`${timeLabel(playback.position)} of ${timeLabel(playback.duration)}`}
            onChange={value => seekTo(value * 1000)} />
        <View style={styles.controlRow}>
            <Button label={playback.playing ? 'Pause' : 'Play'} icon={playback.playing ? 'pause' : 'play'}
                iconOnly variant="media" size="compact" disabled={!playback.duration} onPress={togglePlayback} />
            <Button label={playback.muted ? 'Unmute' : 'Mute'} icon={playback.muted ? 'volumeOff' : 'volume'}
                iconOnly variant="media" size="compact"
                onPress={() => { if (ref.current) ref.current.muted = !ref.current.muted; }} />
            <MediaRange label="Volume" compact value={playback.volume} maximum={1}
                onChange={value => { if (ref.current) ref.current.volume = value; }} />
            <Text tone="media" variant="mediaTitle">{timeLabel(playback.position)} / {timeLabel(playback.duration)}</Text>
            <View style={styles.spacer} />
            {controls}
            <Button label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} icon={fullscreen ? 'shrink' : 'expand'}
                iconOnly variant="media" size="compact" onPress={toggleFullscreen} />
        </View>
    </View></View>;
}
const styles = StyleSheet.create(theme => ({
    player: { flex: 1, minHeight: 0 },
    controls: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        gap: 0, paddingBottom: 4, backgroundColor: theme.media.chrome,
    },
    controlRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
    spacer: { flex: 1 },
    range: (compact: boolean) => ({ height: compact ? 32 : 12, width: compact ? 80 : '100%',
        justifyContent: 'center', paddingHorizontal: 3, marginRight: compact ? 8 : 0 }),
    rangeFocus: { borderRadius: 3, borderWidth: 1, borderColor: theme.media.text },
    track: (compact: boolean) => ({ height: compact ? 26 : 4, borderWidth: 1, borderColor: theme.media.border,
        borderRadius: compact ? 9 : 0, padding: compact ? 3 : 0,
        backgroundColor: compact ? 'transparent' : theme.media.badge }),
    filledTrack: (compact: boolean) => ({ height: '100%', borderRadius: compact ? 5 : 0,
        backgroundColor: compact ? theme.media.badge : theme.media.muted }),
    thumb: (compact: boolean) => ({ position: 'absolute', width: compact ? 10 : 4, height: compact ? 30 : 6,
        marginLeft: compact ? -5 : -3, borderWidth: 1, borderColor: theme.media.muted, backgroundColor: theme.media.badge,
        borderRadius: compact ? 5 : 1 }),
}));
