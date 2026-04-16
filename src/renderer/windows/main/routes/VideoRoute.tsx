/**
 * Video Route
 * Video player with subtitle display and all video-related functionality
 */

import { Component, Show, createSignal, createEffect, onMount, onCleanup, createMemo } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSubtitles, useWatchTogether, useMediaStats } from '../../../hooks';
import { isElectron as isElectronPlatform } from '../../../../shared/platform';
import { useLocalization, useSettings, useLanguage, useFlashcards } from '../../../context';
import { CloudReLoginModal } from '../../../components/cloud';
import { WatchTogetherCodeModal, WatchTogetherModeModal, MediaDistributionModal, MediaReceiveModal } from '../../../components/watchTogether';
import type { MediaTransferMetadata } from '../../../services/mediaDistributionService';
import { VideoPlayer, VideoUnknownWordsSidebar } from '../../../components/video';
import type { VideoWordEntry } from '../../../components/video';
import { Panel, Btn, NavBtn, VideoIcon } from '../../../components/common';
import { AnkiModifyWarningModal } from '../../../components/flashcard/AnkiModifyWarningModal';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { SubtitleSync } from '../../../components/subtitle';
import { ExplainerPopup } from '../../../components/subtitle/ExplainerPopup';
import { WORD_STATUS } from '../../../../shared/constants';
import { getBridge } from '../../../../shared/bridges';
import { isWordInLanguageScript } from '../../../../shared/utils/textUtils';
import { captureVideoThumbnail, getRecentItems, saveToRecentItems, updateRecentItemPlaybackTime, updateRecentItemPlaybackTimeByPath, updateRecentItemSubtitlePathByPath, updateRecentItemThumbnail, updateRecentItemThumbnailByPath, updateRecentItemProgress, updateRecentItemProgressByPath } from '../../../services/thumbnailService';
import { computeWordLevelPercentages, computeGrammarLevelPercentages, assessMediaLevel } from '../../../utils/levelPercentages';
import { buildCharacterContext } from '../../../utils/characterExtraction';
import { buildWordHoverFlashcardContent, getEffectiveWordStatus, getAnkiEaseForStatus, getAnkiWordKnowledgeStatus, numericToWordStatus, type WordStatus } from '../../../components/subtitle/wordHoverHelpers';
import { cleanContextPhrase } from '../../../utils/phraseExtraction';
import { getWordStatus } from '../../../services/statsService';
import { findAnkiWordMatchInCache } from '../../../services/ankiWordsCache';
import { useAnki } from '../../../hooks/useAnki';
import { showToast } from '../../../components/common/Feedback/Toast';
import { ensureCloudAccessToken as ensureSharedCloudAccessToken } from '../../../services/cloudSessionManager';
import {
  createWatchTogetherRoom,
  isRemoteWatchTogetherUrl,
  joinWatchTogetherRoom,
  isShareableWatchTogetherUrl,
} from '../../../services/watchTogetherRoomService';
import { useTokenizer, getCachedTranslation, useTranslation } from '../../../hooks/useTranslation';
import type { ConversationAgentContext } from '../../../../shared/types';
import { syncVideoPluginActivity } from './videoPluginActivity';
import { collectDroppedMediaFiles } from './videoDropUtils';
import { getWordFormCandidates } from '../../../utils/wordForms';
import { isWordMarkedFailed } from '@shared/utils/passiveWordTracking';
import './video.css';

/** Convert a filesystem path to a local-media:// URL that the renderer can load */
const toLocalMediaUrl = (filePath: string): string => `local-media://${filePath}`;

const OPEN_VIDEO_SESSION_KEY = 'mlearn_open_video';
const OPEN_VIDEO_SUBTITLE_SESSION_KEY = 'mlearn_open_video_subtitles';

const getMediaNameFromPath = (filePath: string): string => filePath.split('/').pop() || filePath.split('\\').pop() || 'Video';

export const VideoRoute: Component = () => {
  const navigate = useNavigate();
  const { t } = useLocalization();
  const { settings, updateSetting } = useSettings();
  const langCtx = useLanguage();
  const flashcardCtx = useFlashcards();
  const subtitles = useSubtitles();
  const anki = useAnki();
  const getWordForms = (word: string): string[] => getWordFormCandidates(word, langCtx.getCanonicalForm);
  const getManualWordStatus = (word: string): WordStatus => {
    const forms = getWordForms(word);
    return numericToWordStatus(getWordStatus(forms[0] ?? word, forms.slice(1)));
  };
  const getTrackedAnkiWord = (word: string): string | null => {
    if (!settings.use_anki) return null;
    return findAnkiWordMatchInCache(getWordForms(word))?.word ?? null;
  };
  const getAnkiKnowledgeStatus = (word: string): WordStatus | null => {
    if (!settings.use_anki) return null;
    return getAnkiWordKnowledgeStatus(
      findAnkiWordMatchInCache(getWordForms(word))?.cards,
      settings.ankiLearningThreshold,
      settings.ankiKnownThreshold,
    );
  };

  const watchTogether = useWatchTogether({
    getVideo: () => document.querySelector('video'),
    getVideoSrc: () => videoSrc(),
    getVideoTitle: () => currentVideoName(),
  });

  const [videoSrc, setVideoSrc] = createSignal<string>('');
  const [subtitleContent, setSubtitleContent] = createSignal<string>('');
  const [showDropZone, setShowDropZone] = createSignal(true);
  const [isDragging, setIsDragging] = createSignal(false);
  const [currentVideoTime, setCurrentVideoTime] = createSignal(0);
  const [currentVideoName, setCurrentVideoName] = createSignal('');
  const [currentVideoDuration, setCurrentVideoDuration] = createSignal<number | null>(null);
  const [currentVideoPath, setCurrentVideoPath] = createSignal('');
  const [, setCurrentSubtitlePath] = createSignal('');
  const [showWordSidebar, setShowWordSidebar] = createSignal(false);
  const [isWindowFocused, setIsWindowFocused] = createSignal(typeof document !== 'undefined' ? document.hasFocus() : false);
  const [showWatchTogetherModeModal, setShowWatchTogetherModeModal] = createSignal(false);
  const [showWatchTogetherCodeModal, setShowWatchTogetherCodeModal] = createSignal(false);
  const [showWatchTogetherSignInModal, setShowWatchTogetherSignInModal] = createSignal(false);
  const [watchTogetherBusy, setWatchTogetherBusy] = createSignal(false);
  const [watchTogetherError, setWatchTogetherError] = createSignal('');
  const [showMediaDistributionModal, setShowMediaDistributionModal] = createSignal(false);
  const [showMediaReceiveModal, setShowMediaReceiveModal] = createSignal(false);
  const [explainerOpen, setExplainerOpen] = createSignal(false);
  const [explainerContext, setExplainerContext] = createSignal('');
  const [explainerPosition, setExplainerPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [contextMenuPosition, setContextMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });

  // Accumulated unknown words from subtitles
  const [accumulatedWords, setAccumulatedWords] = createSignal<VideoWordEntry[]>([]);
  const seenWords = new Set<string>();
  const [addingSidebarWords, setAddingSidebarWords] = createSignal<Set<string>>(new Set());
  const [isAddingAllSidebarWords, setIsAddingAllSidebarWords] = createSignal(false);

  // Anki Add All warning state
  const [showAnkiAddAllWarning, setShowAnkiAddAllWarning] = createSignal(false);
  const [pendingAddAllEntries, setPendingAddAllEntries] = createSignal<VideoWordEntry[]>([]);

  const { tokenize } = useTokenizer();
  const { translateWord } = useTranslation({ immediate: true });

  // Media stats for this video session
  const mediaStats = useMediaStats({ mediaType: 'video', language: settings.language });

  const getCurrentVideoElement = (): HTMLVideoElement | null => document.querySelector('video');
  const currentSubtitlePhrase = createMemo(() => cleanContextPhrase(subtitles.currentSubtitle()?.text || ''));

  const loadSharedVideo = (url: string, name: string) => {
    setVideoSrc(url);
    setCurrentVideoTime(0);
    setCurrentVideoDuration(null);
    setCurrentVideoPath('');
    setSubtitleContent('');
    setCurrentSubtitlePath('');
    setShowDropZone(false);
    setCurrentVideoName(name || getMediaNameFromPath(url));
  };

  const buildWatchTogetherPayload = () => {
    const mediaUrl = videoSrc();
    if (!isShareableWatchTogetherUrl(mediaUrl)) {
      return null;
    }

    const video = getCurrentVideoElement();
    return {
      currentTime: video?.currentTime ?? currentVideoTime(),
      paused: video?.paused ?? true,
      playbackRate: video?.playbackRate ?? 1,
    };
  };

  const ensureWatchTogetherCloudAccessToken = async (): Promise<string | null> => {
    const hadSignedInSession = settings.cloudAuthStatus === 'signed-in';
    const accessToken = await ensureSharedCloudAccessToken();
    if (!accessToken && !hadSignedInSession) {
      setShowWatchTogetherSignInModal(true);
    }
    return accessToken;
  };

  const openWatchTogetherCodeModal = () => {
    setWatchTogetherError('');
    setShowWatchTogetherCodeModal(true);
  };

  const handleWatchTogetherCommand = () => {
    setWatchTogetherError('');
    if (watchTogether.isActive()) {
      watchTogether.deactivate();
      setShowWatchTogetherModeModal(false);
      setShowWatchTogetherCodeModal(false);
      return;
    }

    setShowWatchTogetherModeModal(true);
  };

  const handleChooseLocalWatchTogether = () => {
    setShowWatchTogetherModeModal(false);
    setWatchTogetherError('');
    watchTogether.activate();
  };

  const handleChooseCodeWatchTogether = () => {
    setShowWatchTogetherModeModal(false);
    openWatchTogetherCodeModal();
  };

  const handleCreateWatchTogetherRoom = async () => {
    setWatchTogetherError('');
    const payload = buildWatchTogetherPayload();
    if (!payload) {
      setWatchTogetherError(t('mlearn.WatchTogether.Code.UnshareableVideo'));
      return;
    }

    const accessToken = await ensureWatchTogetherCloudAccessToken();
    if (!accessToken) return;

    setWatchTogetherBusy(true);
    try {
      const session = await createWatchTogetherRoom(settings, accessToken, payload);
      watchTogether.activateRoomWithUserId(session, accessToken, settings.cloudAuthUserId);
      setShowWatchTogetherCodeModal(true);
    } catch (error) {
      console.error(error);
      setWatchTogetherError((error as Error).message || String(error));
    } finally {
      setWatchTogetherBusy(false);
    }
  };

  const handleJoinWatchTogetherRoom = async (roomCode: string) => {
    setWatchTogetherError('');
    const accessToken = await ensureWatchTogetherCloudAccessToken();
    if (!accessToken) return;

    setWatchTogetherBusy(true);
    try {
      const session = await joinWatchTogetherRoom(settings, accessToken, roomCode);
      watchTogether.activateRoomWithUserId(session, accessToken, settings.cloudAuthUserId);
      setShowWatchTogetherCodeModal(true);
    } catch (error) {
      console.error(error);
      setWatchTogetherError((error as Error).message || String(error));
    } finally {
      setWatchTogetherBusy(false);
    }
  };

  const handleCopyWatchTogetherRoomCode = () => {
    const roomCode = watchTogether.roomSession()?.room.roomCode;
    if (!roomCode) return;

    getBridge().files.writeToClipboard(roomCode);
    showToast({
      message: t('mlearn.WatchTogether.Code.Copied'),
      variant: 'success',
    });
  };

  const handleDisconnectWatchTogether = () => {
    watchTogether.deactivate();
    setShowWatchTogetherCodeModal(false);
    setShowWatchTogetherModeModal(false);
    setWatchTogetherError('');
  };

  const handleOpenPhraseExplainer = (context: string, position: { x: number; y: number }) => {
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);
  };

  const handleCloseExplainer = () => {
    setExplainerOpen(false);
  };

  const loadVideo = (path: string, name: string) => {
    setVideoSrc(toLocalMediaUrl(path));
    setCurrentVideoTime(0);
    setCurrentVideoDuration(null);
    setCurrentVideoPath(path);
    setSubtitleContent('');
    setCurrentSubtitlePath('');
    setShowDropZone(false);
    setCurrentVideoName(name);
  };

  const saveVideoToRecentItems = async (path: string, name: string, subtitlePath?: string) => {
    await saveToRecentItems({
      type: 'video',
      name,
      path,
      subtitlePath: subtitlePath || undefined,
      progress: 0,
    });
  };

  const persistCurrentSubtitlePath = async (subtitlePath: string) => {
    const videoPath = currentVideoPath();
    if (!subtitlePath || !videoPath) {
      return;
    }

    await updateRecentItemSubtitlePathByPath(videoPath, subtitlePath);
  };

  // Activate media stats when a video name is available
  createEffect(() => {
    const name = currentVideoName();
    if (name) mediaStats.setMedia(name);
  });

  createEffect(() => {
    const mode = watchTogether.mode();
    const activeVideoSrc = videoSrc();

    if (mode !== 'room-owner' || !activeVideoSrc) {
      return;
    }

    if (!isShareableWatchTogetherUrl(activeVideoSrc)) {
      setWatchTogetherError(t('mlearn.WatchTogether.Code.HostDisabled'));
      handleDisconnectWatchTogether();
      return;
    }

    watchTogether.sendSync(getCurrentVideoElement()?.currentTime ?? 0);
  });

  // Show the media receive modal when a pending offer arrives
  createEffect(() => {
    const offer = watchTogether.pendingMediaOffer();
    if (offer) {
      setShowMediaReceiveModal(true);
    }
  });

  // When the owner sends a sync-state with a new mediaUrl, load the video (viewer mode)
  createEffect(() => {
    const received = watchTogether.receivedMediaUrl();
    if (!received) return;

    if (!isRemoteWatchTogetherUrl(received.url)) {
      watchTogether.clearReceivedMediaUrl();
      return;
    }

    loadSharedVideo(received.url, received.title);
    watchTogether.clearReceivedMediaUrl();
  });

  // When the room is closed by the host, notify the viewer
  createEffect(() => {
    if (!watchTogether.roomClosedByHost()) return;
    showToast({
      message: t('mlearn.WatchTogether.Code.RoomClosed'),
      variant: 'warning',
    });
    setShowWatchTogetherCodeModal(false);
    setShowWatchTogetherModeModal(false);
    watchTogether.clearRoomClosedByHost();
  });

  // When a media file is received via WebRTC, allow loading it
  const handleLoadReceivedMedia = (file: Blob, meta: MediaTransferMetadata) => {
    const objectUrl = URL.createObjectURL(file);
    setVideoSrc(objectUrl);
    setCurrentVideoTime(0);
    setCurrentVideoDuration(null);
    setCurrentVideoPath('');
    setShowDropZone(false);
    setCurrentVideoName(meta.fileName);

    if (meta.subtitleContent) {
      setSubtitleContent(meta.subtitleContent);
      setCurrentSubtitlePath('');
    }

    watchTogether.clearMediaReceiveResult();
    setShowMediaReceiveModal(false);
  };

  const handleStartMediaDistribution = (file: Blob, fileName: string, subtitleContent: string | null) => {
    watchTogether.startMediaDistribution(file, fileName, subtitleContent);
  };

  syncVideoPluginActivity({
    workName: currentVideoName,
    currentTimeSeconds: currentVideoTime,
    durationSeconds: currentVideoDuration,
    isFocused: isWindowFocused,
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

      const manualStatus = getManualWordStatus(word);
      const effectiveStatus = getEffectiveWordStatus(
        flashcardCtx.getCardByWordSync(word), manualStatus,
        getAnkiKnowledgeStatus(word),
        settings.knowledgeSourceOrder, settings.knowledgeResolutionMode,
      );
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
    return accumulatedWords().filter(entry => {
      if (flashcardCtx.isWordIgnoredSync(entry.word)) return false;
      const manualStatus = getManualWordStatus(entry.word);
      const effectiveStatus = getEffectiveWordStatus(
        flashcardCtx.getCardByWordSync(entry.word), manualStatus,
        getAnkiKnowledgeStatus(entry.word),
        settings.knowledgeSourceOrder, settings.knowledgeResolutionMode,
      );
      return effectiveStatus !== 'known';
    });
  });

  const failedSidebarWordSet = createMemo<Set<string>>(() => {
    const failedWords = new Set<string>();

    for (const entry of Object.values(mediaStats.stats().wordsEncountered)) {
      if (isWordMarkedFailed(entry, settings)) {
        failedWords.add(entry.word);
      }
    }

    return failedWords;
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
        try { translationData = await translateWord(word); } catch (e) {
          console.error(e);
        }
      }
      const freq = langCtx.getFrequency(word);
      const manualStatus = getManualWordStatus(word);
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
        srsLearningEase: settings.srsLearningEase,
        srsKnownEase: settings.srsKnownEase,
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
    if (settings.use_anki && !settings.skipAnkiModifyWarning) {
      setPendingAddAllEntries(entries);
      setShowAnkiAddAllWarning(true);
      return;
    }
    await processAddAll(entries);
  };

  const processAddAll = async (entries: VideoWordEntry[]) => {
    setIsAddingAllSidebarWords(true);
    try {
      for (const entry of entries) {
        const trackedAnkiWord = getTrackedAnkiWord(entry.word);
        if (trackedAnkiWord) {
          const forms = getWordForms(entry.word);
          const storedStatus = getWordStatus(forms[0] ?? entry.word, forms.slice(1));
          const status = numericToWordStatus(storedStatus === WORD_STATUS.UNKNOWN ? WORD_STATUS.LEARNING : storedStatus);
          const ankiEase = getAnkiEaseForStatus(status, settings.ankiLearningEase, settings.ankiKnownEase);
          try {
            await anki.updateWordCards(trackedAnkiWord, ankiEase);
          } catch (err) {
            console.error(`Failed to update Anki cards for "${entry.word}":`, err);
            showToast({ message: t('mlearn.WordHover.AnkiUpdateFailed'), variant: 'error' });
          }
        } else {
          await addVideoWordFlashcard(entry);
        }
      }
    } finally {
      setIsAddingAllSidebarWords(false);
    }
  };

  const confirmAnkiAddAll = (dontRemind: boolean) => {
    if (dontRemind) {
      updateSetting('skipAnkiModifyWarning', true);
    }
    const entries = pendingAddAllEntries();
    setShowAnkiAddAllWarning(false);
    setPendingAddAllEntries([]);
    void processAddAll(entries);
  };

  const ignoreVideoWord = async (entry: VideoWordEntry) => {
    await flashcardCtx.ignoreWordForLanguage(entry.word);
  };
  
  let thumbnailInterval: number | null = null;
  let progressInterval: number | null = null;
  const ipcCleanups: Array<() => void> = [];

  onMount(() => {
    const syncWindowFocus = () => {
      setIsWindowFocused(document.hasFocus())
    }

    window.addEventListener('focus', syncWindowFocus)
    window.addEventListener('blur', syncWindowFocus)
    document.addEventListener('visibilitychange', syncWindowFocus)
    ipcCleanups.push(() => {
      window.removeEventListener('focus', syncWindowFocus)
      window.removeEventListener('blur', syncWindowFocus)
      document.removeEventListener('visibilitychange', syncWindowFocus)
    })

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
      if (window.mLearnLiveTranslator) {
        window.mLearnLiveTranslator.show();
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

      const syncVideoDuration = () => {
        setCurrentVideoDuration(video.duration && isFinite(video.duration) ? video.duration : null)
      }

      syncVideoDuration()
      video.addEventListener('durationchange', syncVideoDuration)
      ipcCleanups.push(() => video.removeEventListener('durationchange', syncVideoDuration))

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
        syncVideoDuration()
        void restorePlayback();
      } else {
        const onLoadedMetadata = () => {
          syncVideoDuration()
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
    setCurrentVideoDuration(null);
  });

  // Broadcast subtitle HTML to tethered clients whenever the current
  // subtitle changes and watch-together is active.
  createEffect(() => {
    if (!watchTogether.canControl()) return;
    const sub = subtitles.currentSubtitle();
    if (!sub) return;
    // Grab the rendered subtitle container from the DOM.
    const el = document.querySelector('.subtitles');
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
        if (window.mLearnSubtitleSync) {
          window.mLearnSubtitleSync.show();
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
      case 'explain-phrase': {
        if (!settings.llmEnabled) {
          alert(t('mlearn.WordHover.Alerts.ExplainRequiresLlm'));
          break;
        }

        const contextPhrase = currentSubtitlePhrase();
        if (contextPhrase) {
          handleOpenPhraseExplainer(contextPhrase, contextMenuPosition());
        }
        break;
      }
      case 'watch-together':
        handleWatchTogetherCommand();
        break;
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []);
    const droppedMedia = await collectDroppedMediaFiles(files, (file) =>
      getBridge().files.getPathForFile(file)
        || (file as File & { path?: string }).path
        || '',
    );

    if (droppedMedia.video) {
      if (droppedMedia.video.filePath) {
        loadVideo(droppedMedia.video.filePath, droppedMedia.video.fileName);
        await saveVideoToRecentItems(
          droppedMedia.video.filePath,
          droppedMedia.video.fileName,
          droppedMedia.subtitle?.filePath,
        );
      } else {
        setVideoSrc(URL.createObjectURL(droppedMedia.video.file));
        setCurrentVideoTime(0);
        setCurrentVideoDuration(null);
        setCurrentVideoPath('');
        setSubtitleContent('');
        setCurrentSubtitlePath('');
        setShowDropZone(false);
        setCurrentVideoName(droppedMedia.video.fileName);
      }
    }

    if (droppedMedia.subtitle) {
      setSubtitleContent(droppedMedia.subtitle.content);
      setCurrentSubtitlePath(droppedMedia.subtitle.filePath);

      if (!droppedMedia.video && droppedMedia.subtitle.filePath) {
        await persistCurrentSubtitlePath(droppedMedia.subtitle.filePath);
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
      setCurrentVideoTime(0);
      setCurrentVideoDuration(null);
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

    const failedWords = Array.from(mediaWords.values()).filter((word) => isWordMarkedFailed(word, settings));
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

      <Show when={watchTogether.isRoomMode()}>
        <NavBtn
          class="watch-together-room-button"
          onClick={openWatchTogetherCodeModal}
          title={t('mlearn.WatchTogether.Code.OpenRoomPanel')}
        >
          {t('mlearn.WatchTogether.Code.OpenRoomPanel')}
        </NavBtn>
        <Show when={watchTogether.canControl()}>
          <NavBtn
            class="watch-together-distribute-button"
            onClick={() => setShowMediaDistributionModal(true)}
            title={t('mlearn.WatchTogether.Media.DistributeTitle')}
          >
            {t('mlearn.WatchTogether.Media.DistributeAction')}
          </NavBtn>
        </Show>
      </Show>

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
                <Btn onClick={openWatchTogetherCodeModal}>
                  {t('mlearn.Video.WatchTogether')}
                </Btn>
              </div>
            </Panel>
          </div>
        }
      >
        <VideoPlayer
          src={videoSrc()}
          subtitleContent={subtitleContent()}
          remoteSubtitleHtml={watchTogether.remoteSubtitle()?.html || null}
          remoteSubtitleSize={watchTogether.remoteSubtitle()?.size ?? null}
          remoteSubtitleWeight={watchTogether.remoteSubtitle()?.weight ?? null}
          subtitles={subtitles}
          ctxMenuOptions={{
            isWatchTogether: watchTogether.isActive(),
            hasContextPhrase: !!currentSubtitlePhrase(),
            canExplainPhrase: settings.llmEnabled && !!currentSubtitlePhrase(),
          }}
          onContextMenuOpen={setContextMenuPosition}
          onTimeUpdate={(time) => setCurrentVideoTime(time)}
          showWordSidebar={showWordSidebar()}
          onToggleWordSidebar={() => setShowWordSidebar(prev => !prev)}
        />
      </Show>

      <ExplainerPopup
        isOpen={explainerOpen()}
        onClose={handleCloseExplainer}
        word=""
        contextPhrase={explainerContext()}
        mode="phrase"
        initialPosition={explainerPosition()}
      />

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
          failedWordSet={failedSidebarWordSet}
          onAddWord={addVideoWordFlashcard}
          onAddAll={addAllVideoWords}
          onIgnoreWord={ignoreVideoWord}
          onClose={() => setShowWordSidebar(false)}
        />
      </Show>

      {/* Anki Add All warning modal */}
      <AnkiModifyWarningModal
        isOpen={showAnkiAddAllWarning()}
        title={t('mlearn.Sidebar.AnkiAddAllWarning.Title')}
        message={t('mlearn.Sidebar.AnkiAddAllWarning.Message')}
        confirmText={t('mlearn.Sidebar.AnkiAddAllWarning.Confirm')}
        onConfirm={confirmAnkiAddAll}
        onCancel={() => { setShowAnkiAddAllWarning(false); setPendingAddAllEntries([]); }}
      />

      <WatchTogetherModeModal
        isOpen={showWatchTogetherModeModal()}
        onClose={() => setShowWatchTogetherModeModal(false)}
        onChooseLocal={handleChooseLocalWatchTogether}
        onChooseCode={handleChooseCodeWatchTogether}
      />

      <WatchTogetherCodeModal
        isOpen={showWatchTogetherCodeModal()}
        onClose={() => setShowWatchTogetherCodeModal(false)}
        isSignedIn={settings.cloudAuthStatus === 'signed-in'}
        canHost={Boolean(buildWatchTogetherPayload())}
        currentSession={watchTogether.roomSession()}
        isBusy={watchTogetherBusy()}
        error={watchTogetherError()}
        onCreateRoom={handleCreateWatchTogetherRoom}
        onJoinRoom={handleJoinWatchTogetherRoom}
        onCopyRoomCode={handleCopyWatchTogetherRoomCode}
        onDisconnect={handleDisconnectWatchTogether}
        onOpenSignIn={() => setShowWatchTogetherSignInModal(true)}
      />

      <CloudReLoginModal
        isOpen={showWatchTogetherSignInModal()}
        onClose={() => setShowWatchTogetherSignInModal(false)}
        onReLoginSuccess={() => setShowWatchTogetherSignInModal(false)}
        title={t('mlearn.WatchTogether.Code.SignInModalTitle')}
        warningMessage={t('mlearn.WatchTogether.Code.SignInRequiredMessage')}
        hint={t('mlearn.WatchTogether.Code.SignInHint')}
        codeHint={t('mlearn.WatchTogether.Code.SignInCodeHint')}
      />

      <MediaDistributionModal
        isOpen={showMediaDistributionModal()}
        onClose={() => setShowMediaDistributionModal(false)}
        connectedPeerCount={watchTogether.connectedPeerCount()}
        isSending={watchTogether.isSendingMedia()}
        sendProgress={watchTogether.mediaSendProgress()}
        sendComplete={watchTogether.mediaSendComplete()}
        onStartDistribution={handleStartMediaDistribution}
        onCancel={() => { watchTogether.cancelMediaDistribution(); setShowMediaDistributionModal(false); }}
        videoSrc={videoSrc()}
        subtitleContent={subtitleContent() || null}
      />

      <MediaReceiveModal
        isOpen={showMediaReceiveModal()}
        onClose={() => setShowMediaReceiveModal(false)}
        offerMeta={watchTogether.pendingMediaOffer()?.meta ?? null}
        isReceiving={watchTogether.isReceivingMedia()}
        receiveProgress={watchTogether.mediaReceiveProgress()}
        receiveResult={watchTogether.mediaReceiveResult()}
        onAccept={() => watchTogether.acceptMediaOffer()}
        onReject={() => { watchTogether.rejectMediaOffer(); setShowMediaReceiveModal(false); }}
        onLoadReceived={handleLoadReceivedMedia}
        onDismiss={() => { watchTogether.clearMediaReceiveResult(); setShowMediaReceiveModal(false); }}
      />
    </div>
  );
};
