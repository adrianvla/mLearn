/**
 * Video Controls Component
 * Control bar for video player
 */

import { Component, JSX, Show, createSignal, createMemo } from 'solid-js';
import type { useVideo, useSubtitles } from '../../hooks';
import { useSettings } from '../../context';
import { useIPC } from '../../hooks';
import { GlassPanel } from '../common';

// Icons as components
const PlayIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

const VolumeHighIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />
  </svg>
);

const VolumeLowIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M15.54 8.46a5 5 0 010 7.07" />
  </svg>
);

const VolumeMuteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

const FullscreenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
  </svg>
);

const ExitFullscreenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3" />
  </svg>
);

const PiPIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <rect x="11" y="9" width="9" height="6" rx="1" ry="1" fill="currentColor" />
  </svg>
);

const SubtitleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
    <line x1="6" y1="14" x2="18" y2="14" />
    <line x1="6" y1="18" x2="14" y2="18" />
  </svg>
);

export interface VideoControlsProps {
  video: ReturnType<typeof useVideo>;
  subtitles: ReturnType<typeof useSubtitles>;
  containerRef?: HTMLDivElement;
  /** Whether controls should be visible (from cursor visibility hook) */
  isControlsVisible?: boolean;
}

export const VideoControls: Component<VideoControlsProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { isTethered } = useIPC();
  
  const [isHovered, setIsHovered] = createSignal(false);
  const [showSpeedMenu, setShowSpeedMenu] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);

  const state = () => props.video.state();
  
  // Controls visible if: mouse moved recently, OR hovering controls, OR video paused
  const shouldShowControls = () => {
    return (props.isControlsVisible ?? true) || isHovered() || !state().isPlaying;
  };

  // Volume icon based on level
  const VolumeIcon = createMemo(() => {
    if (state().isMuted || state().volume === 0) return VolumeMuteIcon;
    if (state().volume < 0.5) return VolumeLowIcon;
    return VolumeHighIcon;
  });

  // Fullscreen icon
  const FullscreenBtn = createMemo(() => {
    return state().isFullscreen ? ExitFullscreenIcon : FullscreenIcon;
  });

  // Handle progress bar click
  const handleProgressClick = (e: MouseEvent) => {
    const bar = e.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * state().duration;
    props.video.seek(newTime);
  };

  // Handle progress bar drag
  const handleProgressDrag = (e: MouseEvent) => {
    if (!isDragging()) return;
    const bar = (e.currentTarget as HTMLElement).closest('.progress-bar') as HTMLDivElement;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = percent * state().duration;
    props.video.seek(newTime);
  };

  // Handle volume change
  const handleVolumeChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    props.video.setVolume(parseFloat(input.value));
  };

  const controlsStyle = (): JSX.CSSProperties => ({
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    opacity: shouldShowControls() ? '1' : '0',
    transition: 'opacity 0.3s ease',
    'pointer-events': shouldShowControls() ? 'auto' : 'none',
  });

  const buttonStyle: JSX.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    padding: '0.5rem',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    opacity: '0.9',
    transition: 'opacity 0.2s',
  };

  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  return (
    <div
      style={controlsStyle()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <GlassPanel variant="dark" blur="md" rounded="none" padding="none">
        {/* Progress bar */}
        <div
          class="progress-bar"
          style={{
            height: '4px',
            'background-color': 'rgba(255,255,255,0.2)',
            cursor: 'pointer',
            position: 'relative',
          }}
          onClick={handleProgressClick}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onMouseMove={handleProgressDrag}
          onMouseLeave={() => setIsDragging(false)}
        >
          <div
            style={{
              position: 'absolute',
              left: '0',
              top: '0',
              height: '100%',
              width: `${props.video.progress()}%`,
              'background-color': 'var(--color-primary)',
              transition: isDragging() ? 'none' : 'width 0.1s linear',
            }}
          />
        </div>

        {/* Control buttons */}
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            padding: '0.25rem 0.5rem',
          }}
        >
          {/* Left controls */}
          <div style={{ display: 'flex', 'align-items': 'center', gap: '0.25rem' }}>
            {/* Play/Pause */}
            <button
              style={buttonStyle}
              onClick={() => props.video.togglePlay()}
              aria-label={state().isPlaying ? 'Pause' : 'Play'}
            >
              <Show when={state().isPlaying} fallback={<PlayIcon />}>
                <PauseIcon />
              </Show>
            </button>

            {/* Volume */}
            <div style={{ display: 'flex', 'align-items': 'center' }}>
              <button
                style={buttonStyle}
                onClick={() => props.video.toggleMute()}
                aria-label={state().isMuted ? 'Unmute' : 'Mute'}
              >
                {VolumeIcon()()}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={state().isMuted ? 0 : state().volume}
                onInput={handleVolumeChange}
                style={{
                  width: '80px',
                  'accent-color': 'var(--color-primary)',
                }}
              />
            </div>

            {/* Time display */}
            <span
              style={{
                'font-size': '0.75rem',
                color: 'white',
                opacity: '0.9',
                'margin-left': '0.5rem',
                'font-variant-numeric': 'tabular-nums',
              }}
            >
              {props.video.formattedCurrentTime()} / {props.video.formattedDuration()}
            </span>
          </div>

          {/* Right controls */}
          <div style={{ display: 'flex', 'align-items': 'center', gap: '0.25rem' }}>
            {/* Playback speed */}
            <div style={{ position: 'relative' }}>
              <button
                style={{
                  ...buttonStyle,
                  'font-size': '0.75rem',
                  'min-width': '3rem',
                }}
                onClick={() => setShowSpeedMenu(!showSpeedMenu())}
              >
                {state().playbackRate}x
              </button>
              <Show when={showSpeedMenu()}>
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    right: '0',
                    'margin-bottom': '0.25rem',
                    'background-color': 'rgba(0,0,0,0.9)',
                    'border-radius': 'var(--radius-md)',
                    padding: '0.25rem',
                    'min-width': '80px',
                  }}
                >
                  {speedOptions.map((speed) => (
                    <button
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '0.375rem 0.5rem',
                        background: state().playbackRate === speed ? 'var(--color-primary)' : 'none',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        'text-align': 'center',
                        'font-size': '0.75rem',
                        'border-radius': 'var(--radius-sm)',
                      }}
                      onClick={() => {
                        props.video.setPlaybackRate(speed);
                        setShowSpeedMenu(false);
                      }}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </Show>
            </div>

            {/* Subtitles toggle */}
            <button
              style={{
                ...buttonStyle,
                opacity: settings.showSubtitles ? '1' : '0.5',
              }}
              onClick={() => updateSettings({ showSubtitles: !settings.showSubtitles })}
              aria-label="Toggle subtitles"
            >
              <SubtitleIcon />
            </button>

            {/* PiP (Electron only) */}
            <Show when={!isTethered}>
              <button
                style={{
                  ...buttonStyle,
                  opacity: state().isPiP ? '1' : '0.7',
                }}
                onClick={() => props.video.togglePiP()}
                aria-label="Picture in picture"
              >
                <PiPIcon />
              </button>
            </Show>

            {/* Fullscreen */}
            <button
              style={buttonStyle}
              onClick={() => props.video.toggleFullscreen()}
              aria-label={state().isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {FullscreenBtn()()}
            </button>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
};
