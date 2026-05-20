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
import { WatchTogetherCodeModal, WatchTogetherModeModal } from '../../../components/watchTogether';
import { VideoPlayer, VideoUnknownWordsSidebar } from '../../../components/video';
import type { VideoWordEntry } from '../../../components/video';
import { Panel, Btn, NavBtn, VideoIcon, Spinner } from '../../../components/common';
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
import { tokensToColoredHtml, parseWorkName } from '../../../utils/subtitleParsing';
import { getWordStatus } from '../../../services/statsService';
import { findAnkiWordMatchInCache, refreshAnkiWordsCache } from '../../../services/ankiWordsCache';
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
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import { syncVideoPluginActivity } from './videoPluginActivity';
import { collectDroppedMediaFiles } from './videoDropUtils';
import { detectMediaTracks, extractSubtitleTrack } from '../../../services/mediaTrackService';
import { getWordFormCandidates } from '../../../utils/wordForms';
import { isWordMarkedFailed } from '@shared/utils/passiveWordTracking';
import './video.css';
import { getLogger } from '@shared/utils/logger';

const log = getLogger("renderer.video");

/** Convert a filesystem path to a local-media:// URL that the renderer can load */
const toLocalMediaUrl = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const encoded = normalized.split('/').map(encodeURIComponent).join('/');
  return `local-media://localhost${encoded.startsWith('/') ? encoded : '/' + encoded}`;
};

const OPEN_VIDEO_SESSION_KEY = 'mlearn_open_video';
const OPEN_VIDEO_SUBTITLE_SESSION_KEY = 'mlearn_open_video_subtitles';

const getMediaNameFromPath = (filePath: string): string => {
  const rawName = filePath.split('/').pop() || filePath.split('\\').pop() || 'Video';
  return parseWorkName(rawName);
};

export const VideoRoute: Component = () => {
  const navigate = useNavigate();
  const { t } = useLocalization();
  const { settings, updateSetting } = useSettings();
  const langCtx = useLanguage();
  const flashcardCtx = useFlashcards();
  const subtitles = useSubtitles();
  const anki = useAnki();
  const getWordForms = (word: string): string[] => getWordFormCandidates(word, langCtx.getCanonicalForm, langCtx.getWordVariants);
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
  const [detectedAudioTracks, setDetectedAudioTracks] = createSignal<Array<{ index: number; label: string; language: string | null }>>([]);
  const [detectedSubtitleTracks, setDetectedSubtitleTracks] = createSignal<Array<{ index: number; label: string; language: string | null; extractedPath?: string }>>([]);
  const [activeDetectedSubtitleTrack, setActiveDetectedSubtitleTrack] = createSignal<number | null>(null);
  const [isWindowFocused, setIsWindowFocused] = createSignal(typeof document !== 'undefined' ? document.hasFocus() : false);
  const [showWatchTogetherModeModal, setShowWatchTogetherModeModal] = createSignal(false);
  const [showWatchTogetherCodeModal, setShowWatchTogetherCodeModal] = createSignal(false);
  const [showWatchTogetherSignInModal, setShowWatchTogetherSignInModal] = createSignal(false);
  const [watchTogetherBusy, setWatchTogetherBusy] = createSignal(false);
  const [watchTogetherError, setWatchTogetherError] = createSignal('');
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

  const { tokenize } = useTokenizer({ language: settings.language });
  const { translateWord } = useTranslation({ immediate: true, language: settings.language });

  // Media stats for this video session
  const mediaStats = useMediaStats({ mediaType: 'video', language: settings.language });

  const getCurrentVideoElement = (): HTMLVideoElement | null => document.querySelector('video');
  const currentSubtitlePhrase = createMemo(() => cleanContextPhrase(subtitles.currentSubtitle()?.text || ''));

  /** Capture the current video frame as a low-res JPEG and save it via the bridge.
   *  Returns the flashcard-image:// URL, or null when unavailable. */
  async function captureVideoFrameDataUrl(cardId: string): Promise<string | null> {
    try {
      const video = getCurrentVideoElement();
      if (!video || video.readyState < 2) return null;
      const videoWidth = video.videoWidth || video.clientWidth || 0;
      const videoHeight = video.videoHeight || video.clientHeight || 0;
      if (videoWidth === 0 || videoHeight === 0) return null;
      const targetWidth = 480;
      const targetHeight = Math.round(videoHeight * (targetWidth / videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.5);
      if (!base64) return null;
      return await getBridge().flashcards.saveFlashcardImage(cardId, base64);
    } catch (e) {
      log.error('captureVideoFrameDataUrl failed', e);
      return null;
    }
  }

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
      mediaUrl,
      mediaTitle: currentVideoName(),
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
      log.error("error", error);
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
      log.error("error", error);
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

  const handleSelectDetectedSubtitleTrack = async (index: number | null) => {
    if (index === null) {
      setActiveDetectedSubtitleTrack(null);
      return;
    }
    const tracks = detectedSubtitleTracks();
    const track = tracks[index];
    if (!track) return;
    const src = videoSrc();
    if (!src) return;
    setActiveDetectedSubtitleTrack(index);
    const result = await extractSubtitleTrack(src, track.index);
    if (result.success && result.content) {
      setSubtitleContent(result.content);
    }
  };

  const loadVideo = async (path: string, name: string) => {
    const url = toLocalMediaUrl(path);
    log.info('[VideoRoute] loadVideo: path=', path, 'url=', url);
    setVideoSrc(url);
    setCurrentVideoTime(0);
    setCurrentVideoDuration(null);
    setCurrentVideoPath(path);
    setSubtitleContent('');
    setCurrentSubtitlePath('');
    setShowDropZone(false);
    setCurrentVideoName(name);
    setDetectedAudioTracks([]);
    setDetectedSubtitleTracks([]);
    setActiveDetectedSubtitleTrack(null);

    if (isElectronPlatform() && path) {
      const tracks = await detectMediaTracks(url);
      if (tracks.audioTracks.length > 0 || tracks.subtitleTracks.length > 0) {
        setDetectedAudioTracks(
          tracks.audioTracks.map((t) => ({
            index: t.index,
            label: t.label || t.language || `Audio ${t.index + 1}`,
            language: t.language,
          })),
        );
        const subtitleTrackInfos = tracks.subtitleTracks.map((t) => ({
          index: t.index,
          label: t.label || t.language || `Subtitle ${t.index + 1}`,
          language: t.language,
        }));
        setDetectedSubtitleTracks(subtitleTrackInfos);

        if (subtitleTrackInfos.length > 0) {
          const fileSize = await getBridge().files.getFileSize(path);
          const maxSize = 512 * 1024 * 1024;
          if (fileSize != null && fileSize > maxSize) {
            log.info('[VideoRoute] loadVideo: file too large for auto-extraction', fileSize);
            showToast({
              message: t('mlearn.Video.SubtitleTracksDetected'),
              variant: 'info',
            });
          } else {
            const firstTrack = tracks.subtitleTracks[0];
            const result = await extractSubtitleTrack(url, firstTrack.index);
            if (result.success && result.content) {
              setSubtitleContent(result.content);
              setActiveDetectedSubtitleTrack(0);
            } else {
              showToast({
                message: t('mlearn.Video.SubtitleExtractionFailed'),
                variant: 'warning',
              });
            }
          }
        }
      }
    }
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
    const content = subtitleContent();
    const src = videoSrc();
    if (!content || !src) return;
    console.log('[VideoRoute] Forwarding subtitle tracks to overlay, content length=', content.length, 'url=', src);
    const bridge = getBridge();
    bridge.overlay.sendOverlaySubtitleTracks({
      tracks: [],
      textTracks: [{ language: settings.language || 'unknown', text: content }],
      url: src,
    });
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

  createEffect(() => {
    const state = watchTogether.roomState();
    if (!state?.mediaUrl || watchTogether.mode() !== 'room-viewer') return;

    if (!isRemoteWatchTogetherUrl(state.mediaUrl)) {
      return;
    }

    loadSharedVideo(state.mediaUrl, state.mediaTitle || '');
  });

  createEffect(() => {
    if (watchTogether.roomState()?.status !== 'closed') return;
    showToast({
      message: t('mlearn.WatchTogether.Code.RoomClosed'),
      variant: 'warning',
    });
    setShowWatchTogetherCodeModal(false);
    setShowWatchTogetherModeModal(false);
    watchTogether.deactivate();
  });

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

      // Capture each as a lightweight "suggested flashcard" — screenshot +
      // context only (no translation/LLM/TTS). The user reviews them later
      // from the Flashcards → Suggested tab.
      if (settings.autoSuggestFlashcards && settings.enable_flashcard_creation) {
        const colourCodes = settings.colour_codes || langCtx.currentLangData()?.colour_codes || {};
        const contextHtml = tokens.length > 0
          ? tokensToColoredHtml(tokens, colourCodes)
          : undefined;
        const mediaName = currentVideoName();
        const mediaHash = mediaStats.stats().mediaHash;

        void (async () => {
          const batchImageId = crypto.randomUUID();
          const image = await captureVideoFrameDataUrl(batchImageId);
          for (const entry of newEntries) {
            const freq = langCtx.getFrequency(entry.word);
            void flashcardCtx.captureSuggestedFlashcard({
              word: entry.word,
              reading: freq?.reading,
              pos: entry.token.type,
              level: freq?.raw_level ?? null,
              contextPhrase: cleanContextPhrase(entry.contextPhrase),
              contextHtml,
              imageUrl: image || undefined,
              source: mediaName || undefined,
              sourceMediaHash: mediaHash || undefined,
            });
          }
        })();
      }
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
      const cached = getCachedTranslation(word, settings.language);
      let translationData = cached;
      if (!translationData) {
        try { translationData = await translateWord(word); } catch (e) {
          log.error("error", e);
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

      const { toUniqueIdentifier } = await import('../../../services/statsService');
      const cardId = content.word ? await toUniqueIdentifier(content.word) : crypto.randomUUID();

      // If video mode, clip and save the video segment
      log.info('[VideoRoute] addVideoWordFlashcard: flashcardMediaType=', settings.flashcardMediaType, 'videoSrc=', videoSrc(), 'subtitleStart=', entry.subtitleStart, 'subtitleEnd=', entry.subtitleEnd);
      if (settings.flashcardMediaType === 'video' && videoSrc() && entry.subtitleStart != null && entry.subtitleEnd != null) {
        const { clipVideo } = await import('../../../services/videoClipService');
        const margin = (settings.flashcardVideoMargin ?? DEFAULT_SETTINGS.flashcardVideoMargin) / 1000;
        const start = Math.max(0, entry.subtitleStart - margin);
        const end = entry.subtitleEnd + margin;
        log.info('[VideoRoute] addVideoWordFlashcard: calling clipVideo, start=', start, 'end=', end);
        const videoData = await clipVideo(videoSrc(), start, end);
        log.info('[VideoRoute] addVideoWordFlashcard: clipVideo result=', videoData == null ? 'null' : `Uint8Array(${videoData.byteLength})`);
        if (videoData) {
          const videoUrl = await getBridge().flashcards.saveFlashcardVideo(cardId, videoData.buffer as ArrayBuffer);
          log.info('[VideoRoute] addVideoWordFlashcard: saveFlashcardVideo result=', videoUrl);
          if (videoUrl) {
            content.videoUrl = videoUrl;
            content.skipExampleTts = true;
            log.info('[VideoRoute] addVideoWordFlashcard: content.videoUrl set to', videoUrl);
          } else {
            showToast({ message: t('mlearn.Video.VideoClipFailed'), variant: 'warning' });
          }
        } else {
          showToast({ message: t('mlearn.Video.VideoClipFailed'), variant: 'warning' });
        }
      } else {
        log.info('[VideoRoute] addVideoWordFlashcard: skipping video clip — condition not met');
      }

      const imageUrl = await captureVideoFrameDataUrl(cardId);
      if (imageUrl) {
        content.imageUrl = imageUrl;
      }

      await flashcardCtx.addFlashcard(content, ease);
    } catch (err) {
      log.error('Failed to add flashcard from video sidebar:', err);
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
            await refreshAnkiWordsCache();
          } catch (err) {
            log.error(`Failed to update Anki cards for "${entry.word}":`, err);
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
        log.error('Failed to auto-load subtitles for saved video:', error);
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

    // Set up overlay video state sync interval
    const overlaySyncInterval = window.setInterval(() => {
      const video = getCurrentVideoElement();
      if (!video) return;
      bridge.overlay.sendOverlayVideoState({
        currentTime: video.currentTime,
        isPlaying: !video.paused,
        duration: video.duration && isFinite(video.duration) ? video.duration : 0,
        playbackRate: video.playbackRate,
        volume: video.volume,
        muted: video.muted,
        isWaiting: video.readyState < 3,
        url: videoSrc(),
        title: currentVideoName(),
      });
    }, 100);
    ipcCleanups.push(() => clearInterval(overlaySyncInterval));

    // Respond to overlay sync requests
    ipcCleanups.push(bridge.overlay.onOverlayRequestSync(() => {
      const video = getCurrentVideoElement();
      if (!video) return;
      bridge.overlay.sendOverlayVideoState({
        currentTime: video.currentTime,
        isPlaying: !video.paused,
        duration: video.duration && isFinite(video.duration) ? video.duration : 0,
        playbackRate: video.playbackRate,
        volume: video.volume,
        muted: video.muted,
        isWaiting: video.readyState < 3,
        url: videoSrc(),
        title: currentVideoName(),
      });
      const subContent = subtitleContent();
      const src = videoSrc();
      if (subContent && src) {
        bridge.overlay.sendOverlaySubtitleTracks({
          tracks: [],
          textTracks: [{ language: settings.language || 'unknown', text: subContent }],
          url: src,
        });
      }
    }));

    // Attach watch-together listeners to the video element once it exists.
    // Uses a short poll because the <video> may not be in the DOM yet.
    const attachWatchTogetherListeners = () => {
      const video = document.querySelector('video');
      if (!video) return;

      let isAnticipatingPlay = false;

      const onPlay = () => {
        if (watchTogether.isSuppressed) return;
        if (watchTogether.mode() === 'room-owner' && !isAnticipatingPlay) {
          isAnticipatingPlay = true;
          video.pause();
          watchTogether.handlePlayAction();
          const checkDone = window.setInterval(() => {
            if (!watchTogether.isAnticipatingPing()) {
              window.clearInterval(checkDone);
              isAnticipatingPlay = false;
            }
          }, 50);
          return;
        }
        if (!isAnticipatingPlay) {
          watchTogether.sendPlay(video.currentTime);
        }
      };
      const onPause = () => {
        if (!watchTogether.isSuppressed && !isAnticipatingPlay) {
          watchTogether.sendPause(video.currentTime);
        }
        savePlaybackTime();
        captureThumbnailIfReady();
      };
      const onSeeked = () => {
        if (!watchTogether.isSuppressed) {
          watchTogether.sendSync(video.currentTime);
        }
        bridge.overlay.sendOverlayVideoState({
          currentTime: video.currentTime,
          isPlaying: !video.paused,
          duration: video.duration && isFinite(video.duration) ? video.duration : 0,
          playbackRate: video.playbackRate,
          volume: video.volume,
          muted: video.muted,
          isWaiting: video.readyState < 3,
          url: videoSrc(),
          title: currentVideoName(),
        });
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
      settings.subtitle_font_size ?? DEFAULT_SETTINGS.subtitle_font_size,
      settings.subtitle_font_weight ?? DEFAULT_SETTINGS.subtitle_font_weight,
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
      log.info('[VideoRoute] handleDrop: video filePath=', droppedMedia.video.filePath, 'fileName=', droppedMedia.video.fileName, 'displayName=', droppedMedia.video.displayName);
      if (droppedMedia.video.filePath) {
        loadVideo(droppedMedia.video.filePath, droppedMedia.video.displayName);
        await saveVideoToRecentItems(
          droppedMedia.video.filePath,
          droppedMedia.video.displayName,
          droppedMedia.subtitle?.filePath,
        );
      } else {
        const blobUrl = URL.createObjectURL(droppedMedia.video.file);
        log.info('[VideoRoute] handleDrop: using blobUrl=', blobUrl);
        setVideoSrc(blobUrl);
        setCurrentVideoTime(0);
        setCurrentVideoDuration(null);
        setCurrentVideoPath('');
        setSubtitleContent('');
        setCurrentSubtitlePath('');
        setShowDropZone(false);
        setCurrentVideoName(droppedMedia.video.displayName);
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
      <div class="video-nav">
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
            {`${t('mlearn.WatchTogether.Code.OpenRoomPanel')}: ${watchTogether.roomSession()?.room.roomCode ?? ''} • ${watchTogether.peerCount()} ${t('mlearn.WatchTogether.Code.Peers')}`}
          </NavBtn>
        </Show>
      </div>

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
        <div class="video-player-container">
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
            detectedAudioTracks={detectedAudioTracks()}
            detectedSubtitleTracks={detectedSubtitleTracks()}
            activeDetectedSubtitleTrack={activeDetectedSubtitleTrack()}
            onSelectDetectedSubtitleTrack={handleSelectDetectedSubtitleTrack}
          />
          <Show when={watchTogether.isAnticipatingPing()}>
            <div class="watch-together-anticipation-overlay">
              <Spinner size={32} text={t('mlearn.WatchTogether.AnticipatingPing')} />
            </div>
          </Show>
        </div>
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


    </div>
  );
};
