/**
 * Video Controls Component
 * Control bar for video player using the component system
 */

import { Component, Show, createSignal, createMemo } from 'solid-js';
import type { useVideo, useSubtitles } from '../../hooks';
import { useSettings, useLocalization } from '../../context';
import { useIPC } from '../../hooks';
import { Panel, IconBtn, RangeInput, Select, ProgressBar } from '../common';
import type { SelectOption } from '../common/Select/Select';
import './VideoControls.css';

// ============ Icon Components ============

interface VolumeIconProps {
    level: 'high' | 'low' | 'muted';
}

const VolumeIcon: Component<VolumeIconProps> = (props) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        <Show when={props.level === 'high'}>
            <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />
        </Show>
        <Show when={props.level === 'low'}>
            <path d="M15.54 8.46a5 5 0 010 7.07" />
        </Show>
        <Show when={props.level === 'muted'}>
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
        </Show>
    </svg>
);

interface FullscreenIconProps {
    isFullscreen: boolean;
}

const FullscreenIcon: Component<FullscreenIconProps> = (props) => (
    <Show
        when={props.isFullscreen}
        fallback={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
            </svg>
        }
    >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3" />
        </svg>
    </Show>
);

const PiPIcon: Component = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <rect x="11" y="9" width="9" height="6" rx="1" ry="1" fill="currentColor" />
    </svg>
);

const WordListIcon: Component = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
);

// ============ Main Component ============

export interface DetectedTrack {
    index: number;
    label: string;
    language: string | null;
}

export interface VideoControlsProps {
    /** Video hook instance */
    video: ReturnType<typeof useVideo>;
    /** Subtitles hook instance */
    subtitles: ReturnType<typeof useSubtitles>;
    /** Reference to the player container for fullscreen */
    containerRef?: HTMLDivElement;
    /** Whether controls should be visible (from cursor visibility hook) */
    isControlsVisible?: boolean;
    /** Whether the word sidebar is shown */
    showWordSidebar?: boolean;
    /** Toggle word sidebar visibility */
    onToggleWordSidebar?: () => void;
    /** Whether the user has provided external subtitles */
    hasExternalSubtitles?: boolean;
    /** Audio tracks detected via ffmpeg */
    detectedAudioTracks?: DetectedTrack[];
    /** Subtitle tracks detected via ffmpeg */
    detectedSubtitleTracks?: DetectedTrack[];
    /** Currently active detected subtitle track index */
    activeDetectedSubtitleTrack?: number | null;
    /** Callback when user selects a detected subtitle track */
    onSelectDetectedSubtitleTrack?: (index: number | null) => void;
}

// Speed options for playback rate menu
const SPEED_OPTIONS: SelectOption[] = [
    { value: '0.5', label: '0.5x' },
    { value: '0.75', label: '0.75x' },
    { value: '1', label: '1x' },
    { value: '1.25', label: '1.25x' },
    { value: '1.5', label: '1.5x' },
    { value: '1.75', label: '1.75x' },
    { value: '2', label: '2x' },
];

export const VideoControls: Component<VideoControlsProps> = (props) => {
    const { settings, updateSettings } = useSettings();
    const { t } = useLocalization();
    const { isTethered } = useIPC();

    const [isHovered, setIsHovered] = createSignal(false);
    const [isDragging, setIsDragging] = createSignal(false);

    const state = props.video.state;

    const shouldShowControls = () => {
        return (props.isControlsVisible ?? true) || isHovered() || !state.isPlaying;
    };

    const volumeIconLevel = createMemo((): 'high' | 'low' | 'muted' => {
        if (state.isMuted || state.volume === 0) return 'muted';
        if (state.volume < 0.5) return 'low';
        return 'high';
    });

    const handleProgressDrag = (e: MouseEvent) => {
        if (!isDragging()) return;
        const bar = e.currentTarget as HTMLDivElement;
        const rect = bar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const newTime = percent * state.duration;
        props.video.seek(newTime);
    };

    const controlsClass = () => {
        const classes = ['video-controls'];
        if (shouldShowControls()) {
            classes.push('visible');
        } else {
            classes.push('hidden');
        }
        return classes.join(' ');
    };

    return (
        <div
            class={controlsClass()}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <Panel variant="default" rounded="none" padding="none" border={false}>
                {/* Progress bar */}
                <ProgressBar
                    value={props.video.progress()}
                    size="md"
                    variant="default"
                    interactive
                    trackClass="video-progress-bar"
                    fillClass={`video-progress-fill ${isDragging() ? 'dragging' : ''}`}
                    onClick={(percent) => props.video.seek((percent / 100) * state.duration)}
                    onMouseDown={() => setIsDragging(true)}
                    onMouseUp={() => setIsDragging(false)}
                    onMouseMove={handleProgressDrag}
                    onMouseLeave={() => setIsDragging(false)}
                    rounded={false}
                />

                {/* Control buttons */}
                <div class="video-controls-bar">
                    {/* Left controls */}
                    <div class="video-controls-left">
                        {/* Play/Pause */}
                        <IconBtn
                            variant="ghost"
                            onClick={() => props.video.togglePlay()}
                            aria-label={state.isPlaying ? t('mlearn.Global.Aria.Pause') : t('mlearn.Global.Aria.Play')}
                            icon={state.isPlaying ? 'pause' : 'play'}
                        />

                        {/* Volume */}
                        <div class="video-volume-control">
                            <IconBtn
                                variant="ghost"
                                onClick={() => props.video.toggleMute()}
                                aria-label={state.isMuted ? t('mlearn.Video.Controls.Unmute') : t('mlearn.Video.Controls.Mute')}
                            >
                                <VolumeIcon level={volumeIconLevel()} />
                            </IconBtn>
                            <RangeInput
                                min={0}
                                max={1}
                                step={0.05}
                                value={state.isMuted ? 0 : state.volume}
                                onChange={(value) => props.video.setVolume(value)}
                                class="video-volume-slider"
                                tabIndex={-1}
                            />
                        </div>

                        {/* Time display */}
                        <span class="video-time-display">
              {props.video.formattedCurrentTime()} / {props.video.formattedDuration()}
            </span>
                    </div>

                    {/* Right controls */}
                    <div class="video-controls-right">
                        {/* Playback speed */}
                        <Select
                            class="video-speed-select"
                            options={SPEED_OPTIONS}
                            value={String(state.playbackRate)}
                            onChange={(e) => props.video.setPlaybackRate(parseFloat(e.currentTarget.value))}
                            aria-label={t('mlearn.Video.Controls.PlaybackSpeed')}
                        />

                        <Show when={state.textTracks.length > 0 || props.detectedSubtitleTracks?.length || props.hasExternalSubtitles}>
                            <Show when={state.textTracks.length === 0 && !props.detectedSubtitleTracks?.length && props.hasExternalSubtitles}>
                                <IconBtn
                                    variant="ghost"
                                    active={settings.showSubtitles && props.subtitles.subtitles().length > 0}
                                    class={settings.showSubtitles && props.subtitles.subtitles().length > 0 ? '' : 'inactive'}
                                    onClick={() => {
                                        const enabled = settings.showSubtitles && props.subtitles.subtitles().length > 0;
                                        if (enabled) {
                                            updateSettings({ showSubtitles: false });
                                            props.video.disableTextTracks();
                                            props.onSelectDetectedSubtitleTrack?.(null);
                                        } else {
                                            updateSettings({ showSubtitles: true });
                                            props.video.disableTextTracks();
                                            props.onSelectDetectedSubtitleTrack?.(null);
                                        }
                                    }}
                                    aria-label={t('mlearn.Video.Controls.SubtitleTrack')}
                                    icon="subtitles"
                                />
                            </Show>

                            <Show when={state.textTracks.length > 0 || props.detectedSubtitleTracks?.length}>
                                <Select
                                    class="video-track-select video-subtitle-select"
                                    options={[
                                        { value: 'off', label: t('mlearn.Video.Controls.SubtitleNone') },
                                        ...(props.hasExternalSubtitles ? [{ value: 'external', label: t('mlearn.Video.Controls.SubtitleExternal') }] : []),
                                        ...state.textTracks.map((track, i) => ({
                                            value: `browser:${i}`,
                                            label: track.label || track.language || `Track ${i + 1}`,
                                        })),
                                        ...(props.detectedSubtitleTracks || []).map((track, i) => ({
                                            value: `detected:${i}`,
                                            label: track.label || track.language || `Track ${i + 1}`,
                                        })),
                                    ]}
                                    value={(() => {
                                        if (!settings.showSubtitles) return 'off';
                                        if (props.hasExternalSubtitles && props.subtitles.subtitles().length > 0) return 'external';
                                        const activeBrowser = state.textTracks.findIndex(t => t.mode === 'showing');
                                        if (activeBrowser >= 0) return `browser:${activeBrowser}`;
                                        if (props.activeDetectedSubtitleTrack != null) return `detected:${props.activeDetectedSubtitleTrack}`;
                                        return 'off';
                                    })()}
                                    onChange={(e) => {
                                        const val = e.currentTarget.value;
                                        if (val === 'off') {
                                            updateSettings({ showSubtitles: false });
                                            props.video.disableTextTracks();
                                            props.onSelectDetectedSubtitleTrack?.(null);
                                        } else if (val === 'external') {
                                            updateSettings({ showSubtitles: true });
                                            props.video.disableTextTracks();
                                            props.onSelectDetectedSubtitleTrack?.(null);
                                        } else if (val.startsWith('browser:')) {
                                            updateSettings({ showSubtitles: true });
                                            props.video.setTextTrack(parseInt(val.slice(8), 10));
                                            props.onSelectDetectedSubtitleTrack?.(null);
                                        } else if (val.startsWith('detected:')) {
                                            updateSettings({ showSubtitles: true });
                                            props.video.disableTextTracks();
                                            props.onSelectDetectedSubtitleTrack?.(parseInt(val.slice(9), 10));
                                        }
                                    }}
                                    aria-label={t('mlearn.Video.Controls.SubtitleTrack')}
                                />
                            </Show>
                        </Show>

                        <Show when={state.audioTracks.length > 1 || (props.detectedAudioTracks && props.detectedAudioTracks.length > 1)}>
                            <Select
                                class="video-track-select video-audio-select"
                                options={state.audioTracks.length > 0
                                    ? state.audioTracks.map((track, i) => ({
                                        value: String(i),
                                        label: track.label || track.language || `Track ${i + 1}`,
                                    }))
                                    : (props.detectedAudioTracks || []).map((track, i) => ({
                                        value: String(i),
                                        label: track.label || track.language || `Track ${i + 1}`,
                                    }))}
                                value={(() => {
                                    if (state.audioTracks.length > 0) {
                                        const active = state.audioTracks.findIndex(t => t.enabled);
                                        return active >= 0 ? String(active) : '0';
                                    }
                                    return '0';
                                })()}
                                onChange={(e) => {
                                    if (state.audioTracks.length > 0) {
                                        props.video.setAudioTrack(parseInt(e.currentTarget.value, 10));
                                    }
                                }}
                                aria-label={t('mlearn.Video.Controls.AudioTrack')}
                            />
                        </Show>

                        {/* Word sidebar toggle */}
                        <Show when={props.onToggleWordSidebar}>
                            <IconBtn
                                variant="ghost"
                                active={props.showWordSidebar}
                                class={props.showWordSidebar ? '' : 'inactive'}
                                onClick={() => props.onToggleWordSidebar?.()}
                                aria-label={t('mlearn.Video.UI.ToggleWordSidebar')}
                            >
                                <WordListIcon />
                            </IconBtn>
                        </Show>

                        {/* PiP — shown on Electron desktop or when Web PiP API is available */}
                        <Show when={!isTethered || document.pictureInPictureEnabled}>
                            <IconBtn
                                variant="ghost"
                                active={state.isPiP}
                                class={state.isPiP ? '' : 'inactive'}
                                onClick={() => props.video.togglePiP()}
                                aria-label={t('mlearn.Global.Aria.PictureInPicture')}
                            >
                                <PiPIcon />
                            </IconBtn>
                        </Show>

                        {/* Fullscreen */}
                        <IconBtn
                            variant="ghost"
                            onClick={() => props.video.toggleFullscreen()}
                            aria-label={state.isFullscreen ? t('mlearn.Global.Aria.ExitFullscreen') : t('mlearn.Global.Aria.Fullscreen')}
                        >
                            <FullscreenIcon isFullscreen={state.isFullscreen} />
                        </IconBtn>
                    </div>
                </div>
            </Panel>
        </div>
    );
};
