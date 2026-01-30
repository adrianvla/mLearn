/**
 * Video Route
 * Video player with subtitle display and all video-related functionality
 */

import { Component, Show, createSignal, onMount, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useIPC, useSubtitles } from '../../../hooks';
import { useLocalization } from '../../../context';
import { VideoPlayer } from '../../../components/video';
import { GlassPanel, GlassBtn, NavBtn } from '../../../components/common';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { LiveWordTranslator, SubtitleSync } from '../../../components/subtitle';
import { IPC_CHANNELS } from '../../../../shared/constants';
import { captureVideoThumbnail, saveToRecentItems, updateRecentItemThumbnail } from '../../../services/thumbnailService';
import './video.css';

export const VideoRoute: Component = () => {
  const navigate = useNavigate();
  const { isElectron, selectFile, readFile } = useIPC();
  const { t } = useLocalization();
  const subtitles = useSubtitles();

  const [videoSrc, setVideoSrc] = createSignal<string>('');
  const [subtitleContent, setSubtitleContent] = createSignal<string>('');
  const [showDropZone, setShowDropZone] = createSignal(true);
  const [isDragging, setIsDragging] = createSignal(false);
  const [currentVideoTime, setCurrentVideoTime] = createSignal(0);
  const [currentVideoName, setCurrentVideoName] = createSignal('');
  
  let thumbnailInterval: number | null = null;

  onMount(() => {
    // Check if we have a video to open from session storage
    const pendingVideo = sessionStorage.getItem('mlearn_open_video');
    if (pendingVideo) {
      sessionStorage.removeItem('mlearn_open_video');
      // Only load if we have an actual path
      if (pendingVideo.trim()) {
        setVideoSrc(`file://${pendingVideo}`);
        setShowDropZone(false);
        // Extract video name from path
        const videoName = pendingVideo.split('/').pop() || pendingVideo.split('\\').pop() || 'Video';
        setCurrentVideoName(videoName);
      }
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
    
    // Set up thumbnail capture interval
    thumbnailInterval = window.setInterval(() => {
      captureThumbnailIfReady();
    }, 30000); // Capture thumbnail every 30 seconds while watching
  });
  
  onCleanup(() => {
    if (thumbnailInterval !== null) {
      clearInterval(thumbnailInterval);
    }
    // Capture final thumbnail on cleanup
    captureThumbnailIfReady();
  });
  
  const captureThumbnailIfReady = () => {
    const videoEl = document.querySelector('video');
    const name = currentVideoName();
    if (videoEl && name && !videoEl.paused && videoEl.readyState >= 2) {
      const thumbnail = captureVideoThumbnail(videoEl);
      if (thumbnail) {
        updateRecentItemThumbnail(name, thumbnail);
      }
    }
  };

  const handleContextMenuCommand = (command: string) => {
    switch (command) {
      case 'sync-subs':
        // Show the subtitle sync panel
        if ((window as any).mLearnSubtitleSync) {
          (window as any).mLearnSubtitleSync.show();
        }
        break;
      case 'copy-sub':
        const currentSub = subtitles.currentSubtitle();
        if (currentSub) {
          const textToCopy = currentSub.text || '';
          // Try IPC first for Electron
          if (window.mLearnIPC?.send) {
            window.mLearnIPC.send(IPC_CHANNELS.WRITE_TO_CLIPBOARD, textToCopy);
          } else {
            // Fallback to browser clipboard API
            navigator.clipboard.writeText(textToCopy).catch(err => {
              console.error('Failed to copy subtitle:', err);
            });
          }
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
        // In Electron, File objects have a .path property with the full filesystem path
        const filePath = (file as File & { path?: string }).path || '';
        const url = filePath ? `file://${filePath}` : URL.createObjectURL(file);
        setVideoSrc(url);
        setShowDropZone(false);
        setCurrentVideoName(file.name);
        saveToRecentItems({
          type: 'video',
          name: file.name,
          path: filePath,
          progress: 0,
        });
      }
      
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

  const handleSelectVideo = async () => {
    if (!isElectron) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          // In Electron, File objects have a .path property with the full filesystem path
          const filePath = (file as File & { path?: string }).path || '';
          const url = filePath ? `file://${filePath}` : URL.createObjectURL(file);
          setVideoSrc(url);
          setShowDropZone(false);
          setCurrentVideoName(file.name);
          saveToRecentItems({
            type: 'video',
            name: file.name,
            path: filePath,
            progress: 0,
          });
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
      const videoName = path.split('/').pop() || path.split('\\').pop() || 'Video';
      setVideoSrc(`file://${path}`);
      setShowDropZone(false);
      setCurrentVideoName(videoName);
      saveToRecentItems({
        type: 'video',
        name: videoName,
        path: path,
        progress: 0,
      });
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
      <NavBtn class="back-button" onClick={goHome} title={t('mlearn.Video.Tooltip.GoHome')}>
        {t('mlearn.Video.UI.GoHome')}
      </NavBtn>

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
              <h2>{t('mlearn.Video.UI.DropVideoHere')}</h2>
              <p>{t('mlearn.Video.UI.OrClickToBrowse')}</p>
              <div class="drop-actions">
                <GlassBtn variant="primary" onClick={handleSelectVideo}>
                  {t('mlearn.Video.UI.OpenVideo')}
                </GlassBtn>
                <GlassBtn onClick={handleSelectSubtitle}>
                  {t('mlearn.Video.UI.OpenSubtitles')}
                </GlassBtn>
              </div>
            </GlassPanel>
          </div>
        }
      >
        <VideoPlayer
          src={videoSrc()}
          subtitleContent={subtitleContent()}
          style={{ flex: '1' }}
          onTimeUpdate={(time) => setCurrentVideoTime(time)}
        />
      </Show>

      <LiveWordTranslator />
      <SubtitleSync 
        currentVideoTime={currentVideoTime}
        subtitles={subtitles.subtitles()}
      />
    </div>
  );
};
