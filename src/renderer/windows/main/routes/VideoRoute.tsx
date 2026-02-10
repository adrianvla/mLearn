/**
 * Video Route
 * Video player with subtitle display and all video-related functionality
 */

import { Component, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useIPC, useSubtitles, useWatchTogether } from '../../../hooks';
import { useLocalization, useSettings } from '../../../context';
import { VideoPlayer } from '../../../components/video';
import { Panel, Btn, NavBtn } from '../../../components/common';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { LiveWordTranslator, SubtitleSync } from '../../../components/subtitle';
import { IPC_CHANNELS } from '../../../../shared/constants';
import { captureVideoThumbnail, saveToRecentItems, updateRecentItemThumbnail } from '../../../services/thumbnailService';
import './video.css';

export const VideoRoute: Component = () => {
  const navigate = useNavigate();
  const { isElectron, selectFile, readFile } = useIPC();
  const { t } = useLocalization();
  const { settings } = useSettings();
  const subtitles = useSubtitles();

  const watchTogether = useWatchTogether({
    getVideo: () => document.querySelector('video'),
    getVideoSrc: () => videoSrc(),
  });

  const [videoSrc, setVideoSrc] = createSignal<string>('');
  const [subtitleContent, setSubtitleContent] = createSignal<string>('');
  const [showDropZone, setShowDropZone] = createSignal(true);
  const [isDragging, setIsDragging] = createSignal(false);
  const [currentVideoTime, setCurrentVideoTime] = createSignal(0);
  const [currentVideoName, setCurrentVideoName] = createSignal('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_currentVideoPath, setCurrentVideoPath] = createSignal<string>('');
  
  let thumbnailInterval: number | null = null;
  const ipcCleanups: Array<() => void> = [];

  onMount(() => {
    // Check if we have a video to open from session storage
    const pendingVideo = sessionStorage.getItem('mlearn_open_video');
    if (pendingVideo) {
      sessionStorage.removeItem('mlearn_open_video');
      // Only load if we have an actual path
      if (pendingVideo.trim()) {
        setVideoSrc(`file://${pendingVideo}`);
        setCurrentVideoPath(pendingVideo);
        setShowDropZone(false);
        // Extract video name from path
        const videoName = pendingVideo.split('/').pop() || pendingVideo.split('\\').pop() || 'Video';
        setCurrentVideoName(videoName);
      }
    }

    // Setup IPC listeners
    if (window.mLearnIPC) {
      // Show aside (Live Word Translator)
      ipcCleanups.push(window.mLearnIPC.on(IPC_CHANNELS.SHOW_ASIDE, () => {
        if ((window as any).mLearnLiveTranslator) {
          (window as any).mLearnLiveTranslator.show();
        }
      }));

      // Context menu commands
      ipcCleanups.push(window.mLearnIPC.on(IPC_CHANNELS.CTX_MENU_COMMAND, (...args: unknown[]) => {
        if (typeof args[0] === 'string') {
          handleContextMenuCommand(args[0]);
        }
      }));
    }
    
    // Set up thumbnail capture interval
    thumbnailInterval = window.setInterval(() => {
      captureThumbnailIfReady();
    }, 30000); // Capture thumbnail every 30 seconds while watching

    // Attach watch-together listeners to the video element once it exists.
    // Uses a short poll because the <video> may not be in the DOM yet.
    const attachWatchTogetherListeners = () => {
      const video = document.querySelector('video');
      if (!video) return;

      const onPlay = () => {
        if (!watchTogether.isSuppressed) {
          watchTogether.sendPlay(video.currentTime);
        }
      };
      const onPause = () => {
        if (!watchTogether.isSuppressed) {
          watchTogether.sendPause(video.currentTime);
        }
      };
      const onSeeked = () => {
        if (!watchTogether.isSuppressed) {
          watchTogether.sendSync(video.currentTime);
        }
      };

      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('seeked', onSeeked);

      ipcCleanups.push(() => {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('seeked', onSeeked);
      });
    };

    // The video element may appear later (ShowDropZone toggle), so use a
    // MutationObserver to detect when it's added.
    const observer = new MutationObserver(() => {
      if (document.querySelector('video')) {
        attachWatchTogetherListeners();
        observer.disconnect();
      }
    });
    if (document.querySelector('video')) {
      attachWatchTogetherListeners();
    } else {
      observer.observe(document.body, { childList: true, subtree: true });
      ipcCleanups.push(() => observer.disconnect());
    }
  });
  
  onCleanup(() => {
    if (thumbnailInterval !== null) {
      clearInterval(thumbnailInterval);
    }
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
    // Capture final thumbnail on cleanup
    captureThumbnailIfReady();
  });

  // Broadcast subtitle HTML to tethered clients whenever the current
  // subtitle changes and watch-together is active.
  createEffect(() => {
    if (!watchTogether.isActive()) return;
    const sub = subtitles.currentSubtitle();
    if (!sub) return;
    // Grab the rendered subtitle container from the DOM.
    const el = document.querySelector('.subtitle-container');
    if (!el) return;
    const html = el.innerHTML;
    if (!html) return;
    watchTogether.sendSubtitles(
      html,
      settings.subtitle_font_size ?? 32,
      settings.subtitle_font_weight ?? 700,
    );
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
      case 'copy-sub': {
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
      case 'watch-together':
        watchTogether.toggle();
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
        setCurrentVideoPath(filePath);
        setShowDropZone(false);
        setCurrentVideoName(file.name);
        // Only save to recent items if we have a valid path (can be reopened)
        if (filePath) {
          saveToRecentItems({
            type: 'video',
            name: file.name,
            path: filePath,
            progress: 0,
          });
        }
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
          setCurrentVideoPath(filePath);
          setShowDropZone(false);
          setCurrentVideoName(file.name);
          // Only save to recent items if we have a valid path (can be reopened)
          if (filePath) {
            saveToRecentItems({
              type: 'video',
              name: file.name,
              path: filePath,
              progress: 0,
            });
          }
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
      setCurrentVideoPath(path);
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
            <Panel
              variant="default"
              rounded="xl"
              padding="xl"
              class={`drop-zone bordered ${isDragging() ? 'dragging' : ''}`}
            >
              <div class="drop-icon">🎬</div>
              <h2>{t('mlearn.Video.UI.DropVideoHere')}</h2>
              <p>{t('mlearn.Video.UI.OrClickToBrowse')}</p>
              <div class="drop-actions">
                <Btn variant="primary" onClick={handleSelectVideo}>
                  {t('mlearn.Video.UI.OpenVideo')}
                </Btn>
                <Btn onClick={handleSelectSubtitle}>
                  {t('mlearn.Video.UI.OpenSubtitles')}
                </Btn>
              </div>
            </Panel>
          </div>
        }
      >
        <VideoPlayer
          src={videoSrc()}
          subtitleContent={subtitleContent()}
          ctxMenuOptions={{ isWatchTogether: watchTogether.isActive() }}
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
