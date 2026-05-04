import { Component, createSignal, createMemo, Show, onMount, onCleanup } from 'solid-js';
import { useLocalization } from '../../context';
import { IconBtn, RangeInput, Select, ProgressBar, Panel } from '../common';
import type { SelectOption } from '../common/Select/Select';
import './OverlayControls.css';

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

const SubtitleIcon: Component = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
    <line x1="6" y1="14" x2="18" y2="14" />
    <line x1="6" y1="18" x2="14" y2="18" />
  </svg>
);

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

export interface OverlayControlsProps {
  currentTime: number;
  duration: number;
  isConnected: boolean;
  hasSubtitles: boolean;
  isPlaying?: boolean;
  isBuffering?: boolean;
  volume?: number;
  isMuted?: boolean;
  playbackRate?: number;
  subtitleOffset: number;
  onPlayPause?: () => void;
  onSeek: (time: number) => void;
  onVolumeChange?: (value: number) => void;
  onToggleMute?: () => void;
  onPlaybackRateChange?: (rate: number) => void;
  onOffsetChange: (offset: number) => void;
  onLoadSubtitles: () => void;
  onClose: () => void;
  formatTime: (seconds: number) => string;
}

export const OverlayControls: Component<OverlayControlsProps> = (props) => {
  const { t } = useLocalization();
  const [isAltHeld, setIsAltHeld] = createSignal(false);
  const [isHovered, setIsHovered] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);

  const isVisible = createMemo(() =>
    isAltHeld() || isHovered() || !props.hasSubtitles || !props.isConnected
  );

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        setIsAltHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsAltHeld(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });

  const volumeIconLevel = createMemo((): 'high' | 'low' | 'muted' => {
    if (props.isMuted || (props.volume ?? 1) === 0) return 'muted';
    if ((props.volume ?? 1) < 0.5) return 'low';
    return 'high';
  });

  const progress = createMemo(() => {
    if (!props.duration) return 0;
    return (props.currentTime / props.duration) * 100;
  });

  const handleMouseDown = () => {
    setIsDragging(true);
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  const handleWindowMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return;
    const progressBarEl = document.querySelector('.overlay-progress-bar') as HTMLDivElement;
    if (!progressBarEl) return;
    const barRect = progressBarEl.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - barRect.left) / barRect.width));
    props.onSeek(percent * props.duration);
  };

  const handleWindowMouseUp = () => {
    setIsDragging(false);
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
  };

  onCleanup(() => {
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
  });

  const handleOffsetDecrease = () => {
    props.onOffsetChange(Math.round((props.subtitleOffset - 0.1) * 10) / 10);
  };

  const handleOffsetIncrease = () => {
    props.onOffsetChange(Math.round((props.subtitleOffset + 0.1) * 10) / 10);
  };

  const offsetMs = () => Math.round(props.subtitleOffset * 1000);

  return (
    <div
      class="overlay-controls-container"
      classList={{ interactive: isVisible() }}
    >
      <div
        class="overlay-controls-trigger"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-hidden="true"
      />
      <div
        class="overlay-controls-bar"
        classList={{ visible: isVisible() }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role="toolbar"
        aria-label={t('mlearn.Overlay.ControlsAria')}
      >
        <Panel variant="default" rounded="none" padding="none" border={false}>
          {/* Progress bar */}
          <ProgressBar
            value={progress()}
            size="md"
            variant="default"
            interactive
            trackClass="overlay-progress-bar"
            fillClass={`overlay-progress-fill ${isDragging() ? 'dragging' : ''}`}
            onClick={(percent) => props.onSeek((percent / 100) * props.duration)}
            onMouseDown={handleMouseDown}
            rounded={false}
          />

          {/* Control buttons */}
          <div class="overlay-controls-inner">
            {/* Left controls */}
            <div class="overlay-controls-left">
              {/* Play/Pause */}
              <IconBtn
                variant="ghost"
                size="sm"
                onClick={() => props.onPlayPause?.()}
                aria-label={props.isPlaying ? t('mlearn.Global.Aria.Pause') : t('mlearn.Global.Aria.Play')}
                icon={props.isPlaying ? 'pause' : 'play'}
              />

              {/* Volume */}
              <Show when={props.isConnected}>
                <div class="overlay-volume-control">
                  <IconBtn
                    variant="ghost"
                    size="sm"
                    onClick={() => props.onToggleMute?.()}
                    aria-label={props.isMuted ? t('mlearn.Video.Controls.Unmute') : t('mlearn.Video.Controls.Mute')}
                  >
                    <VolumeIcon level={volumeIconLevel()} />
                  </IconBtn>
                  <RangeInput
                    min={0}
                    max={1}
                    step={0.05}
                    value={props.isMuted ? 0 : (props.volume ?? 1)}
                    onChange={(value) => props.onVolumeChange?.(value)}
                    class="overlay-volume-slider"
                    tabIndex={-1}
                  />
                </div>
              </Show>

              {/* Time display */}
              <span class="overlay-time-display">
                {props.formatTime(props.currentTime)} / {props.formatTime(props.duration)}
                <Show when={props.isBuffering}>
                  <span class="overlay-buffering-indicator"> (Buffering...)</span>
                </Show>
              </span>
            </div>

            {/* Center controls — subtitle offset */}
            <div class="overlay-controls-center">
              <div class="overlay-offset-control">
                <IconBtn
                  variant="ghost"
                  size="xs"
                  onClick={handleOffsetDecrease}
                  aria-label={t('mlearn.Overlay.DecreaseOffset')}
                  title={t('mlearn.Overlay.DecreaseOffset')}
                  icon="chevron"
                  iconRotation={-90}
                />
                <span
                  class="overlay-offset-value"
                  title={t('mlearn.Overlay.OffsetTooltip')}
                >
                  {offsetMs() >= 0 ? '+' : ''}
                  {offsetMs()}ms
                </span>
                <IconBtn
                  variant="ghost"
                  size="xs"
                  onClick={handleOffsetIncrease}
                  aria-label={t('mlearn.Overlay.IncreaseOffset')}
                  title={t('mlearn.Overlay.IncreaseOffset')}
                  icon="chevron"
                  iconRotation={90}
                />
              </div>
            </div>

            {/* Right controls */}
            <div class="overlay-controls-right">
              {/* Playback speed */}
              <Show when={props.isConnected}>
                <Select
                  class="overlay-speed-select"
                  options={SPEED_OPTIONS}
                  value={String(props.playbackRate ?? 1)}
                  onChange={(e) => props.onPlaybackRateChange?.(parseFloat(e.currentTarget.value))}
                  aria-label={t('mlearn.Video.Controls.PlaybackSpeed')}
                />
              </Show>

              {/* Sync indicator */}
              <span
                class="overlay-sync-indicator"
                classList={{
                  'sync-connected': props.isConnected,
                  'sync-disconnected': !props.isConnected,
                }}
                title={
                  props.isConnected
                    ? t('mlearn.Overlay.SyncActive')
                    : t('mlearn.Overlay.SyncInactive')
                }
                role="status"
              />

              {/* Load subtitles */}
              <IconBtn
                variant="ghost"
                size="sm"
                onClick={props.onLoadSubtitles}
                aria-label={t('mlearn.Overlay.LoadSubtitles')}
                title={t('mlearn.Overlay.LoadSubtitles')}
              >
                <SubtitleIcon />
              </IconBtn>

              {/* Close */}
              <IconBtn
                variant="ghost"
                size="sm"
                onClick={props.onClose}
                aria-label={t('mlearn.Overlay.Close')}
                title={t('mlearn.Overlay.Close')}
                icon="cross"
              />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
};
