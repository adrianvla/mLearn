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

const SubtitleIcon: Component = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
        <line x1="6" y1="14" x2="18" y2="14" />
        <line x1="6" y1="18" x2="14" y2="18" />
    </svg>
);

const StatsIcon: Component = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
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

export interface VideoControlsProps {
    /** Video hook instance */
    video: ReturnType<typeof useVideo>;
    /** Subtitles hook instance */
    subtitles: ReturnType<typeof useSubtitles>;
    /** Reference to the player container for fullscreen */
    containerRef?: HTMLDivElement;
    /** Whether controls should be visible (from cursor visibility hook) */
    isControlsVisible?: boolean;
    /** Whether the stats panel is currently shown */
    showStats?: boolean;
    /** Toggle stats panel visibility */
    onToggleStats?: () => void;
    /** Whether the word sidebar is shown */
    showWordSidebar?: boolean;
    /** Toggle word sidebar visibility */
    onToggleWordSidebar?: () => void;
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

    const state = () => props.video.state();

    // Controls visible if: mouse moved recently, OR hovering controls, OR video paused
    const shouldShowControls = () => {
        return (props.isControlsVisible ?? true) || isHovered() || !state().isPlaying;
    };

    // Determine volume icon based on level
    const volumeIconLevel = createMemo((): 'high' | 'low' | 'muted' => {
        if (state().isMuted || state().volume === 0) return 'muted';
        if (state().volume < 0.5) return 'low';
        return 'high';
    });

    // Handle progress bar drag
    const handleProgressDrag = (e: MouseEvent) => {
        if (!isDragging()) return;
        const bar = e.currentTarget as HTMLDivElement;
        const rect = bar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const newTime = percent * state().duration;
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
                    onClick={(percent) => props.video.seek((percent / 100) * state().duration)}
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
                            aria-label={state().isPlaying ? t('mlearn.Global.Aria.Pause') : t('mlearn.Global.Aria.Play')}
                            icon={state().isPlaying ? 'pause' : 'play'}
                        />

                        {/* Volume */}
                        <div class="video-volume-control">
                            <IconBtn
                                variant="ghost"
                                onClick={() => props.video.toggleMute()}
                                aria-label={state().isMuted ? t('mlearn.Video.Controls.Unmute') : t('mlearn.Video.Controls.Mute')}
                            >
                                <VolumeIcon level={volumeIconLevel()} />
                            </IconBtn>
                            <RangeInput
                                min={0}
                                max={1}
                                step={0.05}
                                value={state().isMuted ? 0 : state().volume}
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
                            value={String(state().playbackRate)}
                            onChange={(e) => props.video.setPlaybackRate(parseFloat(e.currentTarget.value))}
                            aria-label={t('mlearn.Video.Controls.PlaybackSpeed')}
                        />

                        {/* Subtitles toggle */}
                        <IconBtn
                            variant="ghost"
                            active={settings.showSubtitles}
                            class={settings.showSubtitles ? '' : 'inactive'}
                            onClick={() => updateSettings({ showSubtitles: !settings.showSubtitles })}
                            aria-label={t('mlearn.Global.Aria.ToggleSubtitles')}
                        >
                            <SubtitleIcon />
                        </IconBtn>

                        {/* Stats toggle */}
                        <Show when={props.onToggleStats}>
                            <IconBtn
                                variant="ghost"
                                active={props.showStats}
                                class={props.showStats ? '' : 'inactive'}
                                onClick={() => props.onToggleStats?.()}
                                aria-label="Toggle media statistics"
                            >
                                <StatsIcon />
                            </IconBtn>
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
                                active={state().isPiP}
                                class={state().isPiP ? '' : 'inactive'}
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
                            aria-label={state().isFullscreen ? t('mlearn.Global.Aria.ExitFullscreen') : t('mlearn.Global.Aria.Fullscreen')}
                        >
                            <FullscreenIcon isFullscreen={state().isFullscreen} />
                        </IconBtn>
                    </div>
                </div>
            </Panel>
        </div>
    );
};
