/**
 * Video Route
 * Video player with subtitle display and all video-related functionality
 */

import { Component, Show, createSignal, createEffect, onMount, onCleanup, createMemo } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSubtitles, useWatchTogether, useMediaStats } from '../../../hooks';
import { isElectron as isElectronPlatform } from '../../../../shared/platform';
import { useLocalization, useSettings, useLanguage, useFlashcards } from '../../../context';
import { VideoPlayer, VideoUnknownWordsSidebar } from '../../../components/video';
import type { VideoWordEntry } from '../../../components/video';
import { Panel, Btn, NavBtn, VideoIcon } from '../../../components/common';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { SubtitleSync } from '../../../components/subtitle';
import { WORD_STATUS } from '../../../../shared/constants';
import { getBridge } from '../../../../shared/bridges';
import { isWordInLanguageScript } from '../../../../shared/utils/textUtils';
import { captureVideoThumbnail, getRecentItems, saveToRecentItems, updateRecentItemPlaybackTime, updateRecentItemPlaybackTimeByPath, updateRecentItemSubtitlePath, updateRecentItemSubtitlePathByPath, updateRecentItemThumbnail, updateRecentItemThumbnailByPath, updateRecentItemProgress, updateRecentItemProgressByPath } from '../../../services/thumbnailService';
import { computeWordLevelPercentages, computeGrammarLevelPercentages, assessMediaLevel } from '../../../utils/levelPercentages';
import { buildCharacterContext } from '../../../utils/characterExtraction';
import { buildWordHoverFlashcardContent, getEffectiveWordStatus, numericToWordStatus } from '../../../components/subtitle/wordHoverHelpers';
import { wordsLearnedInApp } from '../../../services/statsService';
import { showToast } from '../../../components/common/Feedback/Toast';
import { useTokenizer, getCachedTranslation, useTranslation } from '../../../hooks/useTranslation';
import type { ConversationAgentContext } from '../../../../shared/types';
import './video.css';

/** Convert a filesystem path to a local-media:// URL that the renderer can load */
const toLocalMediaUrl = (filePath: string): string => `local-media://${filePath}`;

const OPEN_VIDEO_SESSION_KEY = 'mlearn_open_video';
const OPEN_VIDEO_SUBTITLE_SESSION_KEY = 'mlearn_open_video_subtitles';

const getMediaNameFromPath = (filePath: string): string => filePath.split('/').pop() || filePath.split('\\').pop() || 'Video';

export const VideoRoute: Component = () => {
  const navigate = useNavigate();
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
  const [currentVideoPath, setCurrentVideoPath] = createSignal('');
  const [currentSubtitlePath, setCurrentSubtitlePath] = createSignal('');
  const [showWordSidebar, setShowWordSidebar] = createSignal(false);

  // Accumulated unknown words from subtitles
  const [accumulatedWords, setAccumulatedWords] = createSignal<VideoWordEntry[]>([]);
  const seenWords = new Set<string>();
  const [addingSidebarWords, setAddingSidebarWords] = createSignal<Set<string>>(new Set());
  const [isAddingAllSidebarWords, setIsAddingAllSidebarWords] = createSignal(false);

  const { tokenize } = useTokenizer();
  const { translateWord } = useTranslation({ immediate: true });

  // Media stats for this video session
  const mediaStats = useMediaStats({ mediaType: 'video', language: settings.language });

  const loadVideo = (path: string, name: string) => {
    setVideoSrc(toLocalMediaUrl(path));
    setCurrentVideoPath(path);
    setSubtitleContent('');
    setCurrentSubtitlePath('');
    setShowDropZone(false);
    setCurrentVideoName(name);
  };

  const saveVideoToRecentItems = async (path: string, name: string) => {
    await saveToRecentItems({
      type: 'video',
      name,
      path,
      subtitlePath: currentSubtitlePath() || undefined,
      progress: 0,
    });
  };

  const persistCurrentSubtitlePath = async (subtitlePath: string) => {
    const videoName = currentVideoName();
    const videoPath = currentVideoPath();
    if (!subtitlePath || !videoName || !videoPath) {
      return;
    }

    await updateRecentItemSubtitlePathByPath(videoPath, subtitlePath);
    await updateRecentItemSubtitlePath(videoName, subtitlePath);
  };

  // Activate media stats when a video name is available
  createEffect(() => {
    const name = currentVideoName();
    if (name) mediaStats.setMedia(name);
  });

  // Accumulate unknown words from subtitle tokens as they appear
  createEffect(() => {
    const tokens = subtitles.tokens();
    const idx = subtitles.currentIndex();
    if (!tokens.length || idx < 0) return;

    const currentSub = subtitles.currentSubtitle();
    const contextPhrase = currentSub?.text || '';
    const newEntries: VideoWordEntry[] = [];

    for (const token of tokens) {
      const word = token.actual_word ?? token.surface ?? token.word;
      if (!word || !langCtx.isTranslatable(token.type)) continue;
      if (!isWordInLanguageScript(word, settings.language)) continue;
      if (seenWords.has(word)) continue;
      if (flashcardCtx.isWordIgnoredSync(word)) continue;

      const manualStatus = numericToWordStatus(wordsLearnedInApp()[word] ?? WORD_STATUS.UNKNOWN);
      const effectiveStatus = getEffectiveWordStatus(flashcardCtx.getCardByWordSync(word), manualStatus);
      if (effectiveStatus === 'known') continue;

      seenWords.add(word);
      newEntries.push({
        key: `sub:${idx}:${word}`,
        word,
        token,
        contextPhrase,
        subtitleIndex: idx,
        subtitleStart: currentSub?.start,
        subtitleEnd: currentSub?.end,
      });
    }

    if (newEntries.length > 0) {
      setAccumulatedWords(prev => [...prev, ...newEntries]);
    }
  });

  // Visible unknown words: filter out words that became known/ignored since accumulation
  const visibleUnknownWords = createMemo<VideoWordEntry[]>(() => {
    const manualStatuses = wordsLearnedInApp();

    return accumulatedWords().filter(entry => {
      if (flashcardCtx.isWordIgnoredSync(entry.word)) return false;
      const manualStatus = numericToWordStatus(manualStatuses[entry.word] ?? WORD_STATUS.UNKNOWN);
      const effectiveStatus = getEffectiveWordStatus(flashcardCtx.getCardByWordSync(entry.word), manualStatus);
      return effectiveStatus !== 'known';
    });
  });

  const addVideoWordFlashcard = async (entry: VideoWordEntry) => {
    setAddingSidebarWords(prev => {
      const next = new Set(prev);
      next.add(entry.key);
      return next;
    });
    try {
      const word = entry.word;
      const cached = getCachedTranslation(word);
      let translationData = cached;
      if (!translationData) {
        try { translationData = await translateWord(word); } catch { /* ignore */ }
      }
      const freq = langCtx.getFrequency(word);
      const manualStatus = numericToWordStatus(wordsLearnedInApp()[word] ?? WORD_STATUS.UNKNOWN);
      const colourCodes = settings.colour_codes || langCtx.currentLangData()?.colour_codes || {};

      const { content, ease } = await buildWordHoverFlashcardContent({
        token: entry.token,
        word,
        translationData: translationData || undefined,
        contextPhrase: entry.contextPhrase,
        isOcr: false,
        level: freq?.raw_level ?? -1,
        manualStatus,
        colourCodes,
        tokenize,
        flashcardMediaType: settings.flashcardMediaType === 'video' ? 'video' : 'image',
      });

      // If video mode, clip and save the video segment
      console.log('[VideoRoute] addVideoWordFlashcard: flashcardMediaType=', settings.flashcardMediaType, 'videoSrc=', videoSrc(), 'subtitleStart=', entry.subtitleStart, 'subtitleEnd=', entry.subtitleEnd);
      if (settings.flashcardMediaType === 'video' && videoSrc() && entry.subtitleStart != null && entry.subtitleEnd != null) {
        const { clipVideo } = await import('../../../services/videoClipService');
        const margin = (settings.flashcardVideoMargin ?? 300) / 1000;
        const start = Math.max(0, entry.subtitleStart - margin);
        const end = entry.subtitleEnd + margin;
        console.log('[VideoRoute] addVideoWordFlashcard: calling clipVideo, start=', start, 'end=', end);
        const videoData = await clipVideo(videoSrc(), start, end);
        console.log('[VideoRoute] addVideoWordFlashcard: clipVideo result=', videoData == null ? 'null' : `Uint8Array(${videoData.byteLength})`);
        if (videoData) {
          const { toUniqueIdentifier } = await import('../../../services/statsService');
          const cardId = content.word ? await toUniqueIdentifier(content.word) : crypto.randomUUID();
          const videoUrl = await getBridge().flashcards.saveFlashcardVideo(cardId, videoData.buffer as ArrayBuffer);
          console.log('[VideoRoute] addVideoWordFlashcard: saveFlashcardVideo result=', videoUrl);
          if (videoUrl) {
            content.videoUrl = videoUrl;
            content.skipExampleTts = true;
            console.log('[VideoRoute] addVideoWordFlashcard: content.videoUrl set to', videoUrl);
          } else {
            showToast({ message: t('mlearn.Video.VideoClipFailed'), variant: 'warning' });
          }
        } else {
          showToast({ message: t('mlearn.Video.VideoClipFailed'), variant: 'warning' });
        }
      } else {
        console.log('[VideoRoute] addVideoWordFlashcard: skipping video clip — condition not met');
      }

      await flashcardCtx.addFlashcard(content, ease);
    } catch (err) {
      console.error('Failed to add flashcard from video sidebar:', err);
    } finally {
      setAddingSidebarWords(prev => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
    }
  };

  const addAllVideoWords = async (entries: VideoWordEntry[]) => {
    setIsAddingAllSidebarWords(true);
    for (const entry of entries) {
      await addVideoWordFlashcard(entry);
    }
    setIsAddingAllSidebarWords(false);
  };

  const ignoreVideoWord = async (entry: VideoWordEntry) => {
    await flashcardCtx.ignoreWordForLanguage(entry.word);
  };
  
  let thumbnailInterval: number | null = null;
  let progressInterval: number | null = null;
  const ipcCleanups: Array<() => void> = [];

  onMount(() => {
    const loadPendingVideo = async () => {
      const pendingVideo = sessionStorage.getItem(OPEN_VIDEO_SESSION_KEY);
      const pendingSubtitle = sessionStorage.getItem(OPEN_VIDEO_SUBTITLE_SESSION_KEY);

      sessionStorage.removeItem(OPEN_VIDEO_SESSION_KEY);
      sessionStorage.removeItem(OPEN_VIDEO_SUBTITLE_SESSION_KEY);

      if (!pendingVideo?.trim()) {
        return;
      }

      loadVideo(pendingVideo, getMediaNameFromPath(pendingVideo));

      if (!pendingSubtitle?.trim()) {
        return;
      }

      try {
        const buffer = await getBridge().files.readMediaFile(pendingSubtitle);
        if (buffer) {
          const content = new TextDecoder().decode(buffer);
          setSubtitleContent(content);
          setCurrentSubtitlePath(pendingSubtitle);
        }
      } catch (error) {
        console.error('Failed to auto-load subtitles for saved video:', error);
      }
    };

    void loadPendingVideo();

    // Setup IPC listeners
    const bridge = getBridge();

    // Show aside (Live Word Translator)
    ipcCleanups.push(bridge.window.onOpenAside(() => {
      if ((window as any).mLearnLiveTranslator) {
        (window as any).mLearnLiveTranslator.show();
      }
    }));

    // Context menu commands
    ipcCleanups.push(bridge.window.onContextMenuCommand((command: string) => {
      handleContextMenuCommand(command);
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
        savePlaybackTime();
        captureThumbnailIfReady();
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

    // Seek to the saved playback position when the video metadata is available
    const attachVideoResumption = () => {
      const video = document.querySelector('video');
      if (!video) return;

      const restorePlayback = async () => {
        const path = currentVideoPath();
        if (!path) return;
        const items = await getRecentItems();
        const saved = items.find(i => i.path === path);
        if (saved?.playbackTime && saved.playbackTime > 5 && isFinite(saved.playbackTime)) {
          video.currentTime = saved.playbackTime;
        }
      };

      if (video.readyState >= 1) {
        void restorePlayback();
      } else {
        const onLoadedMetadata = () => {
          void restorePlayback();
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
        };
        video.addEventListener('loadedmetadata', onLoadedMetadata);
        ipcCleanups.push(() => video.removeEventListener('loadedmetadata', onLoadedMetadata));
      }
    };

    // The video element may appear later (ShowDropZone toggle), so use a
    // MutationObserver to detect when it's added.
    const observer = new MutationObserver(() => {
      if (document.querySelector('video')) {
        attachWatchTogetherListeners();
        attachInitialThumbnailCapture();
        attachVideoResumption();
        observer.disconnect();
      }
    });
    if (document.querySelector('video')) {
      attachWatchTogetherListeners();
      attachInitialThumbnailCapture();
      attachVideoResumption();
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
    savePlaybackTime();
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
  
  const THUMBNAIL_MIN_TIME = 10; // seconds: skip black frames near video start

  const captureThumbnailIfReady = () => {
    const videoEl = document.querySelector('video');
    const name = currentVideoName();
    const path = currentVideoPath();
    if (videoEl && name && videoEl.readyState >= 2 && videoEl.currentTime >= THUMBNAIL_MIN_TIME) {
      const thumbnail = captureVideoThumbnail(videoEl);
      if (thumbnail) {
        if (path) {
          void updateRecentItemThumbnailByPath(path, thumbnail);
        }
        void updateRecentItemThumbnail(name, thumbnail);
      }
    }
  };

  const updateVideoProgress = () => {
    const videoEl = document.querySelector('video');
    const name = currentVideoName();
    const path = currentVideoPath();
    if (videoEl && name && videoEl.duration && isFinite(videoEl.duration)) {
      const progress = videoEl.currentTime / videoEl.duration;
      if (path) {
        void updateRecentItemProgressByPath(path, progress);
      }
      void updateRecentItemProgress(name, progress);
    }
  };

  const savePlaybackTime = () => {
    const videoEl = document.querySelector('video');
    const name = currentVideoName();
    const path = currentVideoPath();
    if (videoEl && name && isFinite(videoEl.currentTime) && videoEl.currentTime > 5) {
      if (path) {
        void updateRecentItemPlaybackTimeByPath(path, videoEl.currentTime);
      }
      void updateRecentItemPlaybackTime(name, videoEl.currentTime);
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
    let droppedVideo: { path: string; name: string } | null = null;
    let droppedSubtitlePath = '';
    
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      
      if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext || '')) {
        const filePath = getBridge().files.getPathForFile(file)
          || (file as File & { path?: string }).path || '';
        if (filePath) {
          loadVideo(filePath, file.name);
        } else {
          setVideoSrc(URL.createObjectURL(file));
          setCurrentVideoPath('');
          setSubtitleContent('');
          setCurrentSubtitlePath('');
          setShowDropZone(false);
          setCurrentVideoName(file.name);
        }
        droppedVideo = filePath ? { path: filePath, name: file.name } : null;
        // Only save to recent items if we have a valid path (can be reopened)
        if (filePath) {
          await saveVideoToRecentItems(filePath, file.name);
        }
      }
      
      if (['srt', 'vtt', 'ass', 'ssa'].includes(ext || '')) {
        const content = await file.text();
        setSubtitleContent(content);
        const filePath = getBridge().files.getPathForFile(file)
          || (file as File & { path?: string }).path || '';
        setCurrentSubtitlePath(filePath);
        droppedSubtitlePath = filePath;
      }
    }

    if (droppedSubtitlePath) {
      if (droppedVideo) {
        await updateRecentItemSubtitlePathByPath(droppedVideo.path, droppedSubtitlePath);
        await updateRecentItemSubtitlePath(droppedVideo.name, droppedSubtitlePath);
      } else {
        await persistCurrentSubtitlePath(droppedSubtitlePath);
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
    const bridge = getBridge();
    const path = await bridge.files.selectVideoFile();

    if (!path) return;

    // On Electron, selectVideoFile returns a filesystem path
    // On Capacitor, it returns a blob URL
    if (isElectronPlatform()) {
      const videoName = getMediaNameFromPath(path);
      loadVideo(path, videoName);
      await saveVideoToRecentItems(path, videoName);
    } else {
      // Blob URL — can play but can't reopen later
      const videoName = getMediaNameFromPath(path);
      setVideoSrc(path);
      setCurrentVideoPath('');
      setShowDropZone(false);
      setCurrentVideoName(videoName);
    }
  };

  const handleSelectSubtitle = async () => {
    const bridge = getBridge();

    if (isElectronPlatform()) {
      const path = await bridge.files.selectSubtitleFile();
      if (!path) return;

      const buffer = await bridge.files.readMediaFile(path);
      if (!buffer) return;

      const content = new TextDecoder().decode(buffer);
      setSubtitleContent(content);
      setCurrentSubtitlePath(path);
      await persistCurrentSubtitlePath(path);
    } else {
      // On non-Electron, selectSubtitleFile returns a blob URL — read as text
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.srt,.vtt,.ass,.ssa';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) {
          const content = await file.text();
          setSubtitleContent(content);
          setCurrentSubtitlePath('');
        }
      };
      input.click();
    }
  };

  const goHome = () => {
    navigate('/');
  };

  const openConversationAgent = () => {
    const s = mediaStats.stats();
    const name = currentVideoName();
    const lang = settings.language;

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

    const failedWords = Array.from(mediaWords.values()).filter((w) => w.ease < 2.5 || w.timesHovered > 0);
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

  const videoRouteClass = () => {
    const classes = ['video-route'];
    if (showWordSidebar() && !showDropZone()) classes.push('with-word-sidebar');
    return classes.join(' ');
  };

  return (
    <div
      class={videoRouteClass()}
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
          subtitles={subtitles}
          ctxMenuOptions={{ isWatchTogether: watchTogether.isActive() }}
          onTimeUpdate={(time) => setCurrentVideoTime(time)}
          showWordSidebar={showWordSidebar()}
          onToggleWordSidebar={() => setShowWordSidebar(prev => !prev)}
        />
      </Show>

      <SubtitleSync 
        currentVideoTime={currentVideoTime}
        subtitles={subtitles.subtitles()}
      />

      {/* Unknown words sidebar */}
      <Show when={showWordSidebar() && !showDropZone()}>
        <VideoUnknownWordsSidebar
          words={visibleUnknownWords}
          addingWordKeys={() => addingSidebarWords()}
          isAddingAll={() => isAddingAllSidebarWords()}
          onAddWord={addVideoWordFlashcard}
          onAddAll={addAllVideoWords}
          onIgnoreWord={ignoreVideoWord}
          onClose={() => setShowWordSidebar(false)}
        />
      </Show>
    </div>
  );
};
