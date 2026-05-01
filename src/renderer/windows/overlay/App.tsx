import { Component, createSignal, createMemo, onMount, onCleanup, createEffect } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type { OverlayVideoState, OverlayGeometry } from '../../../shared/types';
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

export const App: Component = () => {
  const bridge = getBridge();
  const subtitles = useSubtitles();
  const { settings, updateSettings } = useSettings();

  const [videoState, setVideoState] = createSignal<OverlayVideoState | null>(null);
  const [lastSyncAt, setLastSyncAt] = createSignal<number>(0);
  const [isConnected, setIsConnected] = createSignal(false);
  const [dragOver, setDragOver] = createSignal(false);
  const [isInteractive, setIsInteractive] = createSignal(false);

  const hasSubtitles = createMemo(() => subtitles.subtitles().length > 0);
  const currentTime = createMemo(() => videoState()?.currentTime ?? 0);
  const duration = createMemo(() => videoState()?.duration ?? 0);

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
    const interval = setInterval(() => {
      if (Date.now() - lastSyncAt() > 5000) {
        setIsConnected(false);
      }
    }, 1000);

    onCleanup(() => clearInterval(interval));
  });

  // Click-through: ignore mouse events unless interactive
  onMount(() => {
    bridge.overlay.setOverlayIgnoreMouseEvents(true);
  });

  createEffect(() => {
    bridge.overlay.setOverlayIgnoreMouseEvents(!isInteractive());
  });

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
      classList={{ 'drag-over': dragOver(), interactive: isInteractive() }}
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
        subtitleOffset={settings.subsOffsetTime}
        onOffsetChange={handleOffsetChange}
        onLoadSubtitles={handleOpenSubtitleFile}
        onClose={handleClose}
        formatTime={formatTime}
        onInteractiveChange={setIsInteractive}
      />
      <BorderFlash />
    </div>
  );
};
