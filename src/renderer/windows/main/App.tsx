/**
 * Main Window App Component
 * Primary video player window
 */

import { Component, Show, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { WindowWrapper } from '../../context';
import { useSettings } from '../../context';
import { useIPC, useVideo, useSubtitles } from '../../hooks';
import { VideoPlayer } from '../../components/video';
import { GlassPanel, GlassButton, GlassModal } from '../../components/common';
import { WindowOverlay } from '@renderer/components/common/WindowOverlay';
import { WindowDragRegion } from '@renderer/components/utils/WindowDragRegion';
import { SettingsModal } from '../../components/settings';
import { LiveWordTranslator } from '../../components/subtitle';
import { IPC_CHANNELS } from '../../../shared/constants';

const MainContent: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { isElectron, selectFile, readFile } = useIPC();
  const video = useVideo();
  const subtitles = useSubtitles();

  const [videoSrc, setVideoSrc] = createSignal<string>('');
  const [subtitleContent, setSubtitleContent] = createSignal<string>('');
  const [showDropZone, setShowDropZone] = createSignal(true);
  const [isDragging, setIsDragging] = createSignal(false);
  const [showSettingsModal, setShowSettingsModal] = createSignal(false);
  const [settingsInitialTab, setSettingsInitialTab] = createSignal<string | undefined>();

  // Setup IPC event listeners for menu actions
  onMount(() => {
    if (window.mLearnIPC) {
      // Settings window
      window.mLearnIPC.on(IPC_CHANNELS.SHOW_SETTINGS, (tab?: string) => {
        setSettingsInitialTab(tab);
        setShowSettingsModal(true);
      });

      // Show aside (Live Word Translator)
      window.mLearnIPC.on(IPC_CHANNELS.SHOW_ASIDE, () => {
        // The LiveWordTranslator component handles this
        if ((window as any).mLearnLiveTranslator) {
          (window as any).mLearnLiveTranslator.show();
        }
      });

      // Open Kanji Grid
      window.mLearnIPC.on(IPC_CHANNELS.OPEN_KANJI_GRID, () => {
        // Open kanji grid window
        window.mLearnIPC?.send(IPC_CHANNELS.OPEN_WINDOW, { type: 'kanji-grid' });
      });

      // Open Word DB Editor
      window.mLearnIPC.on(IPC_CHANNELS.OPEN_WORD_DB_EDITOR, () => {
        // Open word db editor window
        window.mLearnIPC?.send(IPC_CHANNELS.OPEN_WINDOW, { type: 'word-db-editor' });
      });

      // Review flashcards
      window.mLearnIPC.on(IPC_CHANNELS.REVIEW_FLASHCARDS_REQUEST, () => {
        window.mLearnIPC?.send(IPC_CHANNELS.OPEN_WINDOW, { type: 'flashcards' });
      });

      // Context menu commands
      window.mLearnIPC.on(IPC_CHANNELS.CTX_MENU_COMMAND, (command: string) => {
        handleContextMenuCommand(command);
      });
    }
  });

  // Handle context menu commands
  const handleContextMenuCommand = (command: string) => {
    switch (command) {
      case 'sync-subs':
        // Sync subtitles with video
        // TODO: Implement subtitle sync
        break;
      case 'copy-sub':
        // Copy current subtitle to clipboard
        const currentSub = subtitles.getCurrentSubtitle?.();
        if (currentSub && window.mLearnIPC) {
          window.mLearnIPC.send(IPC_CHANNELS.WRITE_TO_CLIPBOARD, currentSub);
        }
        break;
    }
  };

  // Handle file drop
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []);
    
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      
      // Video file
      if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext || '')) {
        const url = URL.createObjectURL(file);
        setVideoSrc(url);
        setShowDropZone(false);
      }
      
      // Subtitle file
      if (['srt', 'vtt', 'ass', 'ssa'].includes(ext || '')) {
        const content = await file.text();
        setSubtitleContent(content);
      }
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Handle file selection via dialog
  const handleSelectVideo = async () => {
    if (!isElectron) {
      // Use file input for tethered mode
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          const url = URL.createObjectURL(file);
          setVideoSrc(url);
          setShowDropZone(false);
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
      // In Electron, use file:// protocol
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

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        'flex-direction': 'column',
        'background-color': 'var(--bg-primary)',
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <Show
        when={!showDropZone()}
        fallback={
          <div
            style={{
              flex: '1',
              display: 'flex',
              'flex-direction': 'column',
              'align-items': 'center',
              'justify-content': 'center',
              padding: '2rem',
            }}
          >
            <GlassPanel
              variant="dark"
              blur="lg"
              rounded="xl"
              padding="xl"
              style={{
                'max-width': '500px',
                width: '100%',
                'text-align': 'center',
                border: isDragging() ? '2px dashed var(--color-primary)' : '2px dashed var(--glass-border)',
                transition: 'border-color 0.2s ease',
              }}
            >
              <div
                style={{
                  'font-size': '3rem',
                  'margin-bottom': '1rem',
                }}
              >
                🎬
              </div>
              <h2
                style={{
                  'font-size': '1.5rem',
                  'font-weight': '600',
                  color: 'var(--text-primary)',
                  'margin-bottom': '0.5rem',
                }}
              >
                Drop video file here
              </h2>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  'margin-bottom': '1.5rem',
                }}
              >
                Or click below to browse
              </p>
              <div style={{ display: 'flex', gap: '1rem', 'justify-content': 'center' }}>
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

      {/* Live Word Translator Sidebar */}
      <LiveWordTranslator />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal()}
        onClose={() => setShowSettingsModal(false)}
        initialTab={settingsInitialTab() as any}
      />
    </div>
  );
};

// Main App with providers
export const MainApp: Component = () => {
  return (
    <WindowWrapper>
      <MainContent />
      <WindowOverlay />
    </WindowWrapper>
  );
};

export default MainApp;
