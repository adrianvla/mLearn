/**
 * Video Route
 * Video player with subtitle display and all video-related functionality
 */

import { Component, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useIPC, useSubtitles, useWatchTogether, useMediaStats } from '../../../hooks';
import { useLocalization, useSettings, useLanguage, useFlashcards } from '../../../context';
import { VideoPlayer } from '../../../components/video';
import { MediaStatsPanel } from '../../../components/statistics/MediaStatsPanel';
import { Panel, Btn, NavBtn, VideoIcon } from '../../../components/common';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { LiveWordTranslator, SubtitleSync } from '../../../components/subtitle';
import { IPC_CHANNELS } from '../../../../shared/constants';
import { getBridge } from '../../../../shared/bridges';
import { captureVideoThumbnail, saveToRecentItems, updateRecentItemThumbnail, updateRecentItemProgress } from '../../../services/thumbnailService';
import { computeWordLevelPercentages, computeGrammarLevelPercentages, assessMediaLevel } from '../../../utils/levelPercentages';
import { buildCharacterContext } from '../../../utils/characterExtraction';
import type { ConversationAgentContext } from '../../../../shared/types';
import './video.css';

/** Convert a filesystem path to a local-media:// URL that the renderer can load */
const toLocalMediaUrl = (filePath: string): string => `local-media://${filePath}`;

export const VideoRoute: Component = () => {
  const navigate = useNavigate();
  const { isElectron, selectFile, readFile } = useIPC();
  const { t } = useLocalization();
  const { settings } = useSettings();
  const langCtx = useLanguage();
  const flashcardCtx = useFlashcards();
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
  const [showStatsPanel, setShowStatsPanel] = createSignal(false);

  // Media stats for this video session
  const mediaStats = useMediaStats({ mediaType: 'video', language: settings.language || 'ja' });

  // Activate media stats when a video name is available
  createEffect(() => {
    const name = currentVideoName();
    if (name) mediaStats.setMedia(name);
  });
  
  let thumbnailInterval: number | null = null;
  let progressInterval: number | null = null;
  const ipcCleanups: Array<() => void> = [];

  onMount(() => {
    // Check if we have a video to open from session storage
    const pendingVideo = sessionStorage.getItem('mlearn_open_video');
    if (pendingVideo) {
      sessionStorage.removeItem('mlearn_open_video');
      // Only load if we have an actual path
      if (pendingVideo.trim()) {
        setVideoSrc(toLocalMediaUrl(pendingVideo));
        setCurrentVideoPath(pendingVideo);
        setShowDropZone(false);
        // Extract video name from path
        const videoName = pendingVideo.split('/').pop() || pendingVideo.split('\\').pop() || 'Video';
        setCurrentVideoName(videoName);
      }
    }

    // Setup IPC listeners
    const bridge = getBridge();

    // Show aside (Live Word Translator)
    ipcCleanups.push(bridge.generic.on(IPC_CHANNELS.SHOW_ASIDE, () => {
      if ((window as any).mLearnLiveTranslator) {
        (window as any).mLearnLiveTranslator.show();
      }
    }));

    // Context menu commands
    ipcCleanups.push(bridge.generic.on(IPC_CHANNELS.CTX_MENU_COMMAND, (...args: unknown[]) => {
      if (typeof args[0] === 'string') {
        handleContextMenuCommand(args[0]);
      }
    }));
    
    // Set up thumbnail capture interval
    thumbnailInterval = window.setInterval(() => {
      captureThumbnailIfReady();
    }, 30000); // Capture thumbnail every 30 seconds while watching
    
    // Set up video progress save interval
    progressInterval = window.setInterval(() => {
      updateVideoProgress();
    }, 10000); // Save progress every 10 seconds

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

    // Capture an initial thumbnail as soon as the video has enough data
    const attachInitialThumbnailCapture = () => {
      const video = document.querySelector('video');
      if (!video) return;
      const onCanPlay = () => {
        captureThumbnailIfReady();
        video.removeEventListener('canplay', onCanPlay);
      };
      if (video.readyState >= 3) {
        captureThumbnailIfReady();
      } else {
        video.addEventListener('canplay', onCanPlay);
        ipcCleanups.push(() => video.removeEventListener('canplay', onCanPlay));
      }
    };

    // The video element may appear later (ShowDropZone toggle), so use a
    // MutationObserver to detect when it's added.
    const observer = new MutationObserver(() => {
      if (document.querySelector('video')) {
        attachWatchTogetherListeners();
        attachInitialThumbnailCapture();
        observer.disconnect();
      }
    });
    if (document.querySelector('video')) {
      attachWatchTogetherListeners();
      attachInitialThumbnailCapture();
    } else {
      observer.observe(document.body, { childList: true, subtree: true });
      ipcCleanups.push(() => observer.disconnect());
    }
  });
  
  onCleanup(() => {
    if (thumbnailInterval !== null) {
      clearInterval(thumbnailInterval);
    }
    if (progressInterval !== null) {
      clearInterval(progressInterval);
    }
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
    // Capture final thumbnail and save final progress on cleanup
    captureThumbnailIfReady();
    updateVideoProgress();
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
    if (videoEl && name && videoEl.readyState >= 2) {
      const thumbnail = captureVideoThumbnail(videoEl);
      if (thumbnail) {
        updateRecentItemThumbnail(name, thumbnail);
      }
    }
  };

  const updateVideoProgress = () => {
    const videoEl = document.querySelector('video');
    const name = currentVideoName();
    if (videoEl && name && videoEl.duration && isFinite(videoEl.duration)) {
      const progress = videoEl.currentTime / videoEl.duration;
      updateRecentItemProgress(name, progress);
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
          getBridge().files.writeToClipboard(textToCopy);
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
        const filePath = getBridge().files.getPathForFile(file)
          || (file as File & { path?: string }).path || '';
        const url = filePath ? toLocalMediaUrl(filePath) : URL.createObjectURL(file);
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
          const filePath = getBridge().files.getPathForFile(file)
            || (file as File & { path?: string }).path || '';
          const url = filePath ? toLocalMediaUrl(filePath) : URL.createObjectURL(file);
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
      setVideoSrc(toLocalMediaUrl(path));
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

  const openConversationAgent = () => {
    const s = mediaStats.stats();
    const name = currentVideoName();
    const lang = settings.language || 'ja';

    // Build level percentages from current media stats
    const freqLookup = { getFrequency: langCtx.getFrequency, getFreqLevelNames: langCtx.getFreqLevelNames };
    const grammarLookup = { getGrammarPoint: langCtx.getGrammarPoint, getGrammarLevelNames: langCtx.getGrammarLevelNames };
    const wordLevels = computeWordLevelPercentages(s, freqLookup);
    const grammarLevels = computeGrammarLevelPercentages(s, grammarLookup);
    const level = assessMediaLevel(wordLevels);
    const levelNames = langCtx.getFreqLevelNames();

    // Collect failed words: merge per-media stats with global wordKnowledge
    // wordsEncountered has per-media seen/hovered counts; wordKnowledge has global ease
    const wordKnowledge = flashcardCtx.store.wordKnowledge;
    const mediaWords = new Map<string, { word: string; ease: number; timesSeen: number; timesHovered: number }>();

    // Only include words encountered in this specific media
    // Refine ease with global wordKnowledge but never add words from other media
    for (const entry of Object.values(s.wordsEncountered)) {
      const globalEntry = wordKnowledge[lang + ':' + entry.word] || wordKnowledge[entry.word];
      if (globalEntry) {
        mediaWords.set(entry.word, {
          word: entry.word,
          ease: Math.min(entry.ease, globalEntry.ease),
          timesSeen: Math.max(entry.timesSeen, globalEntry.timesSeen),
          timesHovered: Math.max(entry.timesHovered, globalEntry.timesHovered),
        });
      } else {
        mediaWords.set(entry.word, { ...entry });
      }
    }

    const failedWords = Array.from(mediaWords.values()).filter((w) => w.ease < 2.5);
    const failedGrammar = Object.values(s.grammarEncountered).filter((g) => g.timesFailed > 0);

    const context: ConversationAgentContext = {
      mediaName: name,
      mediaType: 'video',
      mediaHash: s.mediaHash,
      assessedLevel: level,
      assessedLevelName: level !== null && levelNames[String(level)] ? levelNames[String(level)] : '',
      language: lang,
      failedWords,
      failedGrammar,
      wordLevelPercentages: wordLevels,
      grammarLevelPercentages: grammarLevels,
      characterContext: buildCharacterContext(subtitles.subtitles().map((sub) => sub.text)) ?? undefined,
      subtitleHistory: subtitles.subtitles().slice(-50).map((sub) => sub.text),
    };

    getBridge().window.openWindow({ type: 'conversation-agent', context: context as unknown as Record<string, unknown> });
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

      <NavBtn
        class="conversation-agent-button"
        onClick={openConversationAgent}
        title={t('mlearn.Video.Tooltip.OpenConversationAgent')}
      >
        {t('mlearn.Video.UI.OpenConversationAgent')}
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
              <div class="drop-icon"><VideoIcon size={40} /></div>
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
          showStats={showStatsPanel()}
          onToggleStats={() => setShowStatsPanel(prev => !prev)}
        />
      </Show>

      <LiveWordTranslator />
      <SubtitleSync 
        currentVideoTime={currentVideoTime}
        subtitles={subtitles.subtitles()}
      />

      {/* Media Stats Panel overlay */}
      <Show when={showStatsPanel() && mediaStats.isActive()}>
        <MediaStatsPanel
          stats={mediaStats.stats()}
          onClose={() => setShowStatsPanel(false)}
          onReviewWithAI={() => {
            openConversationAgent();
            setShowStatsPanel(false);
          }}
        />
      </Show>
    </div>
  );
};
