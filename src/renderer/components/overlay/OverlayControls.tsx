import { Component, createSignal, createMemo, Show, onMount, onCleanup } from 'solid-js';
import { useLocalization } from '../../context';
import { IconBtn, RangeInput, Select, ProgressBar, Panel, VolumeLevelIcon, SubtitleIcon, DragIcon, ResizeIcon, AutoPositionIcon } from '../common';
import type { SelectOption } from '../common/Select/Select';
import './OverlayControls.css';

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
  autoPositionEnabled?: boolean;
  onPlayPause?: () => void;
  onSeek: (time: number) => void;
  onVolumeChange?: (value: number) => void;
  onToggleMute?: () => void;
  onPlaybackRateChange?: (rate: number) => void;
  onOffsetChange: (offset: number) => void;
  onLoadSubtitles: () => void;
  onClose: () => void;
  onDragStart?: () => void;
  onDragMove?: (deltaX: number, deltaY: number) => void;
  onDragEnd?: () => void;
  onResizeStart?: () => void;
  onResizeMove?: (deltaWidth: number, deltaHeight: number) => void;
  onResizeEnd?: () => void;
  onToggleAutoPosition?: () => void;
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

  let progressBarTrackEl: HTMLDivElement | null = null;

  const handleMouseDown = (e: MouseEvent) => {
    if (isDragging()) return;
    setIsDragging(true);
    progressBarTrackEl = e.currentTarget as HTMLDivElement;
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  const handleWindowMouseMove = (e: MouseEvent) => {
    if (!isDragging() || !progressBarTrackEl) return;
    const barRect = progressBarTrackEl.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - barRect.left) / barRect.width));
    props.onSeek(percent * props.duration);
  };

  const handleWindowMouseUp = () => {
    setIsDragging(false);
    progressBarTrackEl = null;
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

  const [isWindowDragging, setIsWindowDragging] = createSignal(false);
  const [isWindowResizing, setIsWindowResizing] = createSignal(false);
  let pendingMoveDeltaX = 0;
  let pendingMoveDeltaY = 0;
  let pendingResizeDeltaW = 0;
  let pendingResizeDeltaH = 0;
  let moveRafId: number | null = null;
  let resizeRafId: number | null = null;

  const flushMoveDelta = () => {
    if (pendingMoveDeltaX !== 0 || pendingMoveDeltaY !== 0) {
      props.onDragMove?.(pendingMoveDeltaX, pendingMoveDeltaY);
      pendingMoveDeltaX = 0;
      pendingMoveDeltaY = 0;
    }
    moveRafId = null;
  };

  const flushResizeDelta = () => {
    if (pendingResizeDeltaW !== 0 || pendingResizeDeltaH !== 0) {
      props.onResizeMove?.(pendingResizeDeltaW, pendingResizeDeltaH);
      pendingResizeDeltaW = 0;
      pendingResizeDeltaH = 0;
    }
    resizeRafId = null;
  };

  const handleDragMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsWindowDragging(true);
    props.onDragStart?.();
    window.addEventListener('mousemove', handleDragMouseMove);
    window.addEventListener('mouseup', handleDragMouseUp);
  };

  const handleDragMouseMove = (e: MouseEvent) => {
    if (!isWindowDragging()) return;
    pendingMoveDeltaX += e.movementX;
    pendingMoveDeltaY += e.movementY;
    if (moveRafId === null) {
      moveRafId = requestAnimationFrame(flushMoveDelta);
    }
  };

  const handleDragMouseUp = () => {
    if (!isWindowDragging()) return;
    setIsWindowDragging(false);
    if (moveRafId !== null) {
      cancelAnimationFrame(moveRafId);
      moveRafId = null;
    }
    flushMoveDelta();
    props.onDragEnd?.();
    window.removeEventListener('mousemove', handleDragMouseMove);
    window.removeEventListener('mouseup', handleDragMouseUp);
  };

  const handleResizeMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsWindowResizing(true);
    props.onResizeStart?.();
    window.addEventListener('mousemove', handleResizeMouseMove);
    window.addEventListener('mouseup', handleResizeMouseUp);
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (!isWindowResizing()) return;
    pendingResizeDeltaW += e.movementX;
    pendingResizeDeltaH += e.movementY;
    if (resizeRafId === null) {
      resizeRafId = requestAnimationFrame(flushResizeDelta);
    }
  };

  const handleResizeMouseUp = () => {
    if (!isWindowResizing()) return;
    setIsWindowResizing(false);
    if (resizeRafId !== null) {
      cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    flushResizeDelta();
    props.onResizeEnd?.();
    window.removeEventListener('mousemove', handleResizeMouseMove);
    window.removeEventListener('mouseup', handleResizeMouseUp);
  };

  onCleanup(() => {
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
    window.removeEventListener('mousemove', handleDragMouseMove);
    window.removeEventListener('mouseup', handleDragMouseUp);
    window.removeEventListener('mousemove', handleResizeMouseMove);
    window.removeEventListener('mouseup', handleResizeMouseUp);
    if (moveRafId !== null) {
      cancelAnimationFrame(moveRafId);
      moveRafId = null;
    }
    if (resizeRafId !== null) {
      cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    flushMoveDelta();
    flushResizeDelta();
  });

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
                    <VolumeLevelIcon level={volumeIconLevel()} />
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

              {/* Auto-position toggle */}
              <Show when={props.onToggleAutoPosition}>
                <IconBtn
                  variant="ghost"
                  size="sm"
                  onClick={() => props.onToggleAutoPosition?.()}
                  aria-label={props.autoPositionEnabled ? t('mlearn.Overlay.DisableAutoPosition') : t('mlearn.Overlay.EnableAutoPosition')}
                  title={props.autoPositionEnabled ? t('mlearn.Overlay.DisableAutoPosition') : t('mlearn.Overlay.EnableAutoPosition')}
                >
                  <AutoPositionIcon enabled={props.autoPositionEnabled ?? true} />
                </IconBtn>
              </Show>

              {/* Drag handle */}
              <Show when={props.onDragStart}>
                <div
                  class="overlay-drag-handle"
                  onMouseDown={handleDragMouseDown}
                  title={t('mlearn.Overlay.DragToMove')}
                >
                  <DragIcon />
                </div>
              </Show>

              {/* Resize handle */}
              <Show when={props.onResizeStart}>
                <div
                  class="overlay-resize-handle"
                  onMouseDown={handleResizeMouseDown}
                  title={t('mlearn.Overlay.DragToResize')}
                >
                  <ResizeIcon />
                </div>
              </Show>

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
