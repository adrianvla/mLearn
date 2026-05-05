import { Component, createSignal, createMemo, onMount, onCleanup, createEffect } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type { OverlayVideoState, OverlayGeometry, OverlaySubtitleTracks } from '../../../shared/types';
import { SubtitleContainer } from '../../components/subtitle/SubtitleContainer';
import { OverlayControls, BorderFlash, triggerBorderFlash } from '../../components/overlay';
import { useSubtitles } from '../../hooks/useSubtitles';
import { useSettings } from '../../context';
import { useWatchTogether } from '../../hooks/useWatchTogether';

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
};

const DISCONNECT_TIMEOUT_MS = 15000;

/** DOM selectors that should be interactive (not click-through). */
const INTERACTIVE_SELECTORS = [
  '.overlay-controls-trigger',
  '.overlay-controls-bar',
  '.subtitles',
  '.toast-container',
];

function isOverInteractiveRegion(e: MouseEvent): boolean {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return false;
  return INTERACTIVE_SELECTORS.some((sel) => el.closest(sel));
}

export const App: Component = () => {
  const bridge = getBridge();
  const subtitles = useSubtitles();
  const { settings, updateSettings } = useSettings();

  const [videoState, setVideoState] = createSignal<OverlayVideoState | null>(null);
  const [lastSyncAt, setLastSyncAt] = createSignal<number>(0);
  const [isConnected, setIsConnected] = createSignal(false);
  const [dragOver, setDragOver] = createSignal(false);
  const [mouseInteractive, setMouseInteractive] = createSignal(false);

  const hasSubtitles = createMemo(() => subtitles.subtitles().length > 0);
  const currentTime = createMemo(() => videoState()?.currentTime ?? 0);
  const duration = createMemo(() => videoState()?.duration ?? 0);
  const isPlaying = createMemo(() => videoState()?.isPlaying ?? false);
  const isBuffering = createMemo(() => videoState()?.isWaiting ?? false);
  const volume = createMemo(() => videoState()?.volume ?? 1);
  const isMuted = createMemo(() => videoState()?.muted ?? false);
  const playbackRate = createMemo(() => videoState()?.playbackRate ?? 1);

  const watchTogether = useWatchTogether({
    getVideo: () => null,
    getVideoSrc: () => videoState()?.url ?? '',
    isOverlay: true,
    getCurrentTime: () => currentTime(),
  });

  onMount(() => {
    const cleanup = bridge.overlay.onOverlayVideoState((state: OverlayVideoState) => {
      setVideoState(state);
      setLastSyncAt(Date.now());
      setIsConnected(true);
      subtitles.updateTime(state.currentTime);
    });

    bridge.overlay.requestOverlaySync();

    onCleanup(() => {
      cleanup();
    });
  });

  onMount(() => {
    const cleanupGeometry = bridge.overlay.onOverlayGeometry((_geometry: OverlayGeometry) => {
      triggerBorderFlash();
    });

    onCleanup(() => {
      cleanupGeometry();
    });
  });

  onMount(() => {
    const cleanupTracks = bridge.overlay.onOverlaySubtitleTracks((tracks: OverlaySubtitleTracks) => {
      // If no subtitles are loaded, auto-load the first text track
      if (subtitles.subtitles().length === 0 && tracks.textTracks.length > 0) {
        subtitles.loadSubtitles(tracks.textTracks[0].text);
      }
    });

    onCleanup(() => {
      cleanupTracks();
    });
  });

  onMount(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastSyncAt() > DISCONNECT_TIMEOUT_MS) {
        setIsConnected(false);
      }
    }, 1000);

    onCleanup(() => clearInterval(interval));
  });

  // Dynamic click-through: the window starts click-through and only becomes
  // interactive when the cursor is over interactive regions (controls, trigger,
  // subtitles, toasts).  Because the Electron main process calls
  // setIgnoreMouseEvents(true, { forward: true }) the renderer still receives
  // mousemove events while click-through, letting us detect when the cursor
  // enters an interactive region and switch back.
  onMount(() => {
    let rafId: number | null = null;

    const updateInteractivity = (e: MouseEvent) => {
      // If a mouse button is held the user may be dragging a file. Switch to
      // interactive so dragenter/dragover/drop events are received.
      if (e.buttons > 0) {
        if (!mouseInteractive()) setMouseInteractive(true);
        return;
      }

      // Skip scheduling a new RAF if one is already pending
      if (rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        rafId = null;
        const next = isOverInteractiveRegion(e);
        if (next !== mouseInteractive()) {
          setMouseInteractive(next);
        }
      });
    };

    const handleMouseLeave = () => {
      setMouseInteractive(false);
    };

    // Drag-and-drop requires the window to be interactive. These events only
    // fire when the window is already in interactive mode (the e.buttons check
    // above ensures we switch before the drag reaches the window).
    let dragDepth = 0;
    const handleDragEnter = () => {
      dragDepth++;
      setMouseInteractive(true);
    };
    const handleDragLeave = () => {
      dragDepth--;
      if (dragDepth <= 0) {
        dragDepth = 0;
        setMouseInteractive(false);
      }
    };
    const handleDragDrop = () => {
      dragDepth = 0;
      setMouseInteractive(false);
    };

    document.addEventListener('mousemove', updateInteractivity);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDragDrop);

    onCleanup(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', updateInteractivity);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDragDrop);
    });
  });

  createEffect(() => {
    bridge.overlay.setOverlayIgnoreMouseEvents(!mouseInteractive());
  });

  // Keyboard shortcuts for bidirectional control
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isConnected()) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSeek(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSeek(5);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  const handlePlayPause = () => {
    if (!isConnected()) return;
    const cmd = isPlaying() ? 'pause' : 'play';
    bridge.overlay.sendOverlayCommand({ command: cmd });
  };

  const handleSeek = (time: number) => {
    if (!isConnected()) return;
    const target = Math.max(0, Math.min(duration(), time));
    bridge.overlay.sendOverlayCommand({ command: 'seek', time: target });
  };

  const handleVolumeChange = (value: number) => {
    if (!isConnected()) return;
    bridge.overlay.sendOverlayCommand({ command: 'setVolume', volume: Math.max(0, Math.min(1, value)) });
  };

  const handleToggleMute = () => {
    if (!isConnected()) return;
    bridge.overlay.sendOverlayCommand({ command: 'setVolume', volume: isMuted() ? volume() || 1 : 0 });
  };

  const handlePlaybackRateChange = (rate: number) => {
    if (!isConnected()) return;
    bridge.overlay.sendOverlayCommand({ command: 'setRate', rate });
  };

  const handleOpenSubtitleFile = async () => {
    const filePath = await bridge.files.selectSubtitleFile();
    if (!filePath) return;

    const buffer = await bridge.files.readMediaFile(filePath);
    if (!buffer) return;

    const text = new TextDecoder('utf-8').decode(buffer);
    const ext = filePath.split('.').pop()?.toLowerCase();
    let format: 'srt' | 'vtt' | 'ass' | undefined;
    if (ext === 'vtt') format = 'vtt';
    else if (ext === 'ass' || ext === 'ssa') format = 'ass';
    else if (ext === 'srt') format = 'srt';

    subtitles.loadSubtitles(text, format);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['srt', 'vtt', 'ass', 'ssa'].includes(ext)) return;

    await subtitles.loadSubtitleFile(file);
  };

  const handleOffsetChange = (offset: number) => {
    updateSettings({ subsOffsetTime: offset });
  };

  const handleClose = () => {
    bridge.window.closeWindow();
  };

  return (
    <div
      class="overlay-container"
      classList={{ 'drag-over': dragOver() }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="application"
      aria-label="Subtitle overlay"
    >
      {watchTogether.isActive() && (
        <div class="watch-together-indicator">WT</div>
      )}
      <div class="overlay-subtitle-wrapper">
        <SubtitleContainer
          tokens={subtitles.tokens()}
          isLoading={subtitles.isTokenizing()}
          originalText={subtitles.currentSubtitle()?.text}
          subtitleStart={subtitles.currentSubtitle()?.start}
          subtitleEnd={subtitles.currentSubtitle()?.end}
          videoSrc={videoState()?.url}
        />
      </div>

      <OverlayControls
        currentTime={currentTime()}
        duration={duration()}
        isConnected={isConnected()}
        hasSubtitles={hasSubtitles()}
        isPlaying={isPlaying()}
        isBuffering={isBuffering()}
        volume={volume()}
        isMuted={isMuted()}
        playbackRate={playbackRate()}
        subtitleOffset={settings.subsOffsetTime}
        onPlayPause={handlePlayPause}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
        onToggleMute={handleToggleMute}
        onPlaybackRateChange={handlePlaybackRateChange}
        onOffsetChange={handleOffsetChange}
        onLoadSubtitles={handleOpenSubtitleFile}
        onClose={handleClose}
        formatTime={formatTime}
      />
      <BorderFlash />
    </div>
  );
};
