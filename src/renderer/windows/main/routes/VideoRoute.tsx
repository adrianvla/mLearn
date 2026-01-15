/**
 * Video Route
 * Video player with subtitle display and all video-related functionality
 */

import { Component, Show, createSignal, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useIPC, useSubtitles } from '../../../hooks';
import { VideoPlayer } from '../../../components/video';
import { GlassPanel, GlassButton } from '../../../components/common';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { LiveWordTranslator } from '../../../components/subtitle';
import { IPC_CHANNELS } from '../../../../shared/constants';
import './video.css';

export const VideoRoute: Component = () => {
  const navigate = useNavigate();
  const { isElectron, selectFile, readFile } = useIPC();
  const subtitles = useSubtitles();

  const [videoSrc, setVideoSrc] = createSignal<string>('');
  const [subtitleContent, setSubtitleContent] = createSignal<string>('');
  const [showDropZone, setShowDropZone] = createSignal(true);
  const [isDragging, setIsDragging] = createSignal(false);

  onMount(() => {
    // Check if we have a video to open from session storage
    const pendingVideo = sessionStorage.getItem('mlearn_open_video');
    if (pendingVideo) {
      sessionStorage.removeItem('mlearn_open_video');
      setVideoSrc(`file://${pendingVideo}`);
      setShowDropZone(false);
    }

    // Setup IPC listeners
    if (window.mLearnIPC) {
      // Show aside (Live Word Translator)
      window.mLearnIPC.on(IPC_CHANNELS.SHOW_ASIDE, () => {
        if ((window as any).mLearnLiveTranslator) {
          (window as any).mLearnLiveTranslator.show();
        }
      });

      // Context menu commands
      window.mLearnIPC.on(IPC_CHANNELS.CTX_MENU_COMMAND, (...args: unknown[]) => {
        if (typeof args[0] === 'string') {
          handleContextMenuCommand(args[0]);
        }
      });
    }
  });

  const handleContextMenuCommand = (command: string) => {
    switch (command) {
      case 'sync-subs':
        // TODO: Implement subtitle sync
        break;
      case 'copy-sub':
        const currentSub = subtitles.currentSubtitle();
        if (currentSub && window.mLearnIPC) {
          window.mLearnIPC.send(IPC_CHANNELS.WRITE_TO_CLIPBOARD, currentSub.text);
        }
        break;
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []);
    
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      
      if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext || '')) {
        const url = URL.createObjectURL(file);
        setVideoSrc(url);
        setShowDropZone(false);
        saveToRecent(file.name, 'video');
      }
      
      if (['srt', 'vtt', 'ass', 'ssa'].includes(ext || '')) {
        const content = await file.text();
        setSubtitleContent(content);
      }
    }
  };

  const saveToRecent = (name: string, type: 'video' | 'book') => {
    try {
      const stored = localStorage.getItem('mlearn_recent_items');
      const items = stored ? JSON.parse(stored) : [];
      const newItem = {
        type,
        name,
        path: '',
        progress: 0,
        lastWatched: Date.now()
      };
      const filtered = items.filter((i: any) => i.name !== name);
      const updated = [newItem, ...filtered].slice(0, 10);
      localStorage.setItem('mlearn_recent_items', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save recent:', e);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleSelectVideo = async () => {
    if (!isElectron) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          const url = URL.createObjectURL(file);
          setVideoSrc(url);
          setShowDropZone(false);
          saveToRecent(file.name, 'video');
        }
      };
      input.click();
      return;
    }

    const path = await selectFile({
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov'] },
      ],
    });

    if (path) {
      setVideoSrc(`file://${path}`);
      setShowDropZone(false);
    }
  };

  const handleSelectSubtitle = async () => {
    if (!isElectron) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.srt,.vtt,.ass,.ssa';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          const content = await file.text();
          setSubtitleContent(content);
        }
      };
      input.click();
      return;
    }

    const path = await selectFile({
      filters: [
        { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
      ],
    });

    if (path) {
      const content = await readFile(path);
      setSubtitleContent(content);
    }
  };

  const goHome = () => {
    navigate('/');
  };

  return (
    <div
      class="video-route"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <WindowDragRegion />
      
      {/* Back button */}
      <button class="back-button" onClick={goHome} title="Back to Home">
        ← Home
      </button>

      <Show
        when={!showDropZone()}
        fallback={
          <div class="drop-zone-container">
            <GlassPanel
              variant="dark"
              blur="lg"
              rounded="xl"
              padding="xl"
              class={`drop-zone ${isDragging() ? 'dragging' : ''}`}
            >
              <div class="drop-icon">🎬</div>
              <h2>Drop video file here</h2>
              <p>Or click below to browse</p>
              <div class="drop-actions">
                <GlassButton variant="primary" onClick={handleSelectVideo}>
                  Open Video
                </GlassButton>
                <GlassButton onClick={handleSelectSubtitle}>
                  Open Subtitles
                </GlassButton>
              </div>
            </GlassPanel>
          </div>
        }
      >
        <VideoPlayer
          src={videoSrc()}
          subtitleContent={subtitleContent()}
          style={{ flex: '1' }}
        />
      </Show>

      <LiveWordTranslator />
    </div>
  );
};
