import { Component, Show, createSignal, createMemo, onMount, onCleanup, createEffect } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type { OverlayVideoState, OverlayGeometry, OverlaySubtitleTracks } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { SubtitleContainer } from '../../components/subtitle/SubtitleContainer';
import { LiveWordTranslator } from '../../components/subtitle/LiveWordTranslator';
import { SubtitleSync } from '../../components/subtitle/SubtitleSync';
import { ExplainerPopup } from '../../components/subtitle/ExplainerPopup';
import { OverlayControls } from '../../components/overlay';
import { VideoUnknownWordsSidebar, type VideoWordEntry } from '../../components/video/VideoUnknownWordsSidebar';
import { WatchTogetherCodeModal, WatchTogetherModeModal } from '../../components/watchTogether';
import { CloudReLoginModal } from '../../components/cloud';
import { AnkiModifyWarningModal } from '../../components/flashcard/AnkiModifyWarningModal';
import { useSubtitles } from '../../hooks/useSubtitles';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../context';
import { useAnki } from '../../hooks/useAnki';
import { useTokenizer, useTranslation, getCachedTranslation } from '../../hooks/useTranslation';
import { useWatchTogether } from '../../hooks/useWatchTogether';
import { cleanContextPhrase } from '../../utils/phraseExtraction';
import { isWordInLanguageScript } from '../../../shared/utils/textUtils';
import { getWordStatus } from '../../services/statsService';
import { findAnkiWordMatchInCache, refreshAnkiWordsCache } from '../../services/ankiWordsCache';
import { buildWordHoverFlashcardContent, getEffectiveWordStatus, getAnkiEaseForStatus, getAnkiWordKnowledgeStatus, numericToWordStatus, type WordStatus } from '../../components/subtitle/wordHoverHelpers';
import { getWordFormCandidates } from '../../utils/wordForms';
import { WORD_STATUS } from '../../../shared/constants';
import { createWatchTogetherRoom, isRemoteWatchTogetherUrl, joinWatchTogetherRoom, isShareableWatchTogetherUrl } from '../../services/watchTogetherRoomService';
import { ensureCloudAccessToken as ensureSharedCloudAccessToken } from '../../services/cloudSessionManager';
import { showToast } from '../../components/common/Feedback/Toast';
import { getLogger } from '../../../shared/utils/logger';

const DISCONNECT_TIMEOUT_MS = 15000;

const INTERACTIVE_SELECTORS = [
  '.overlay-controls-trigger',
  '.overlay-controls-bar',
  '.subtitles',
  '.toast-container',
  '.overlay-drag-handle',
  '.overlay-resize-handle',
  '.word-hover-container',
  '.subtitle_hover',
  '.draggable-popup',
  '.modal-overlay',
  '.video-unknown-words-sidebar',
  '.live-word-translator',
  '.watch-together-code-modal',
  '.watch-together-mode-modal',
  '.subtitle-sync',
  '.subtitle-sync-btn',
  '.panel-header',
];

function isOverInteractiveRegion(e: MouseEvent): boolean {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return false;
  return INTERACTIVE_SELECTORS.some((sel) => el.closest(sel));
}

const log = getLogger('renderer.overlay');

export const App: Component = () => {
  const bridge = getBridge();
  const subtitles = useSubtitles();
  const { t } = useLocalization();
  const { settings, updateSettings, updateSetting } = useSettings();
  const langCtx = useLanguage();
  const flashcardCtx = useFlashcards();
  const anki = useAnki();
  const { tokenize } = useTokenizer({ language: settings.language });
  const { translateWord } = useTranslation({ immediate: true, language: settings.language });

  const [videoState, setVideoState] = createSignal<OverlayVideoState | null>(null);
  const [lastVideoUrl, setLastVideoUrl] = createSignal('');
  const [subtitleContent, setSubtitleContent] = createSignal('');
  const [lastSyncAt, setLastSyncAt] = createSignal<number>(0);
  const [isConnected, setIsConnected] = createSignal(false);
  const [dragOver, setDragOver] = createSignal(false);
  const [mouseInteractive, setMouseInteractive] = createSignal(false);
  const [autoPositionEnabled, setAutoPositionEnabled] = createSignal(true);
  const [isManipulating, setIsManipulating] = createSignal(false);

  const [showWordSidebar, setShowWordSidebar] = createSignal(false);
  const [accumulatedWords, setAccumulatedWords] = createSignal<VideoWordEntry[]>([]);
  const seenWords = new Set<string>();
  const [addingSidebarWords, setAddingSidebarWords] = createSignal<Set<string>>(new Set());
  const [isAddingAllSidebarWords, setIsAddingAllSidebarWords] = createSignal(false);
  const [showAnkiAddAllWarning, setShowAnkiAddAllWarning] = createSignal(false);
  const [pendingAddAllEntries, setPendingAddAllEntries] = createSignal<VideoWordEntry[]>([]);
  const [explainerOpen, setExplainerOpen] = createSignal(false);
  const [explainerContext, setExplainerContext] = createSignal('');
  const [explainerPosition, setExplainerPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [contextMenuPosition, setContextMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showWatchTogetherModeModal, setShowWatchTogetherModeModal] = createSignal(false);
  const [showWatchTogetherCodeModal, setShowWatchTogetherCodeModal] = createSignal(false);
  const [showWatchTogetherSignInModal, setShowWatchTogetherSignInModal] = createSignal(false);
  const [watchTogetherBusy, setWatchTogetherBusy] = createSignal(false);
  const [watchTogetherError, setWatchTogetherError] = createSignal('');

  const hasSubtitles = createMemo(() => subtitles.subtitles().length > 0);
  const currentTime = createMemo(() => videoState()?.currentTime ?? 0);
  const duration = createMemo(() => videoState()?.duration ?? 0);
  const isPlaying = createMemo(() => videoState()?.isPlaying ?? false);
  const currentSubtitlePhrase = createMemo(() => cleanContextPhrase(subtitles.currentSubtitle()?.text || ''));

  const watchTogether = useWatchTogether({
    getVideo: () => null,
    getVideoSrc: () => videoState()?.url ?? '',
    isOverlay: true,
    getCurrentTime: () => currentTime(),
  });

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

  onMount(() => {
    const cleanups: Array<() => void> = [];

    cleanups.push(
      bridge.overlay.onOverlayVideoState((state: OverlayVideoState) => {
        setVideoState(state);
        setLastSyncAt(Date.now());
        setIsConnected(true);

        const prevUrl = lastVideoUrl();
        const currentUrl = state.url ?? '';
        console.log('[Overlay] videoState update: prevUrl=', prevUrl, 'currentUrl=', currentUrl, 'time=', state.currentTime, 'subsOffsetTime=', settings.subsOffsetTime);
        if (prevUrl && prevUrl !== currentUrl) {
          console.log('[Overlay] URL changed, clearing subtitles and resetting offset');
          setSubtitleContent('');
          subtitles.clearSubtitles();
          updateSetting('subsOffsetTime', 0);
        }
        setLastVideoUrl(currentUrl);

        subtitles.updateTime(state.currentTime);
      })
    );
    bridge.overlay.requestOverlaySync();

    cleanups.push(
      bridge.overlay.onOverlayGeometry((_geometry: OverlayGeometry) => {
        setLastSyncAt(Date.now());
        setIsConnected(true);
      })
    );

    cleanups.push(
      bridge.overlay.onOverlaySubtitleTracks((tracks: OverlaySubtitleTracks) => {
        const currentUrl = videoState()?.url;
        console.log('[Overlay] onOverlaySubtitleTracks: tracks.url=', tracks.url, 'currentUrl=', currentUrl, 'textTracks.length=', tracks.textTracks.length);
        if (tracks.url && currentUrl && tracks.url !== currentUrl) {
          console.log('[Overlay] Subtitle track URL mismatch, ignoring');
          return;
        }
        if (tracks.textTracks.length > 0) {
          console.log('[Overlay] Loading subtitle track, text length=', tracks.textTracks[0].text.length);
          setSubtitleContent(tracks.textTracks[0].text);
        } else {
          console.log('[Overlay] No textTracks in subtitle tracks payload');
        }
      })
    );

    cleanups.push(
      bridge.overlay.onOverlayAutoPositionChanged((enabled: boolean) => {
        setAutoPositionEnabled(enabled);
      })
    );

    cleanups.push(
      bridge.window.onContextMenuCommand((command: string) => {
        handleContextMenuCommand(command);
      })
    );

    onCleanup(() => { for (const fn of cleanups) fn(); });
  });

  onMount(() => {
    const cleanups: Array<() => void> = [];

    const interval = setInterval(() => {
      if (Date.now() - lastSyncAt() > DISCONNECT_TIMEOUT_MS) {
        setIsConnected(false);
      }
    }, 1000);
    cleanups.push(() => clearInterval(interval));

    bridge.overlay.overlayGetBounds().then((bounds) => {
      if (bounds) {
        setLastSyncAt(Date.now());
        setIsConnected(true);
      }
    });

    onCleanup(() => { for (const fn of cleanups) fn(); });
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

  createEffect(() => {
    const content = subtitleContent();
    if (content) {
      subtitles.loadSubtitles(content);
    } else {
      subtitles.clearSubtitles();
    }
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
    if (!Number.isFinite(duration()) || !Number.isFinite(time)) return;
    const target = Math.max(0, Math.min(duration(), time));
    bridge.overlay.sendOverlayCommand({ command: 'seek', time: target });
  };

  const handleOpenSubtitleFile = async () => {
    const filePath = await bridge.files.selectSubtitleFile();
    if (!filePath) return;

    const buffer = await bridge.files.readMediaFile(filePath);
    if (!buffer) return;

    const text = new TextDecoder('utf-8').decode(buffer);
    console.log('[Overlay] handleOpenSubtitleFile: loaded text length=', text.length);
    setSubtitleContent(text);
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

    const text = await file.text();
    console.log('[Overlay] handleDrop: loaded text length=', text.length);
    setSubtitleContent(text);
  };

  const handleOffsetChange = (offset: number) => {
    updateSettings({ subsOffsetTime: offset });
  };

  const handleClose = () => {
    bridge.window.closeWindow();
  };

  const handleDragStart = () => {
    setIsManipulating(true);
  };

  const handleDragMove = (deltaX: number, deltaY: number) => {
    bridge.overlay.overlayMoveBy({ x: deltaX, y: deltaY });
  };

  const handleDragEnd = () => {
    setIsManipulating(false);
  };

  const handleResizeStart = () => {
    setIsManipulating(true);
  };

  const handleResizeMove = (deltaWidth: number, deltaHeight: number) => {
    bridge.overlay.overlayResizeBy({ width: deltaWidth, height: deltaHeight });
  };

  const handleResizeEnd = () => {
    setIsManipulating(false);
  };

  const handleToggleAutoPosition = () => {
    const next = !autoPositionEnabled();
    setAutoPositionEnabled(next);
    bridge.overlay.overlaySetAutoPosition(next);
  };

  const handleOpenPhraseExplainer = (context: string, position: { x: number; y: number }) => {
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);
  };

  const handleCloseExplainer = () => setExplainerOpen(false);

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

  const handleContextMenuCommand = (command: string) => {
    switch (command) {
      case 'sync-subs':
        if (typeof window !== 'undefined' && window.mLearnSubtitleSync) {
          window.mLearnSubtitleSync.show();
        }
        break;
      case 'copy-sub': {
        const currentSub = subtitles.currentSubtitle();
        if (currentSub) {
          bridge.files.writeToClipboard(currentSub.text || '');
        }
        break;
      }
      case 'explain-phrase': {
        if (!settings.llmEnabled) {
          break;
        }
        const phrase = currentSubtitlePhrase();
        if (phrase) {
          handleOpenPhraseExplainer(phrase, contextMenuPosition());
        }
        break;
      }
      case 'watch-together':
        handleWatchTogetherCommand();
        break;
    }
  };

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

  const failedSidebarWordSet = createMemo<ReadonlySet<string>>(() => new Set());

  const addVideoWordFlashcard = async (entry: VideoWordEntry) => {
    setAddingSidebarWords(prev => { const next = new Set(prev); next.add(entry.key); return next; });
    try {
      const word = entry.word;
      const cached = getCachedTranslation(word, settings.language);
      let translationData = cached;
      if (!translationData) {
        try { translationData = await translateWord(word); } catch (e) { log.error('Translation failed', e); }
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

      await flashcardCtx.addFlashcard(content, ease);
    } catch (err) {
      log.error('Failed to add flashcard from overlay sidebar:', err);
    } finally {
      setAddingSidebarWords(prev => { const next = new Set(prev); next.delete(entry.key); return next; });
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

  const openConversationAgent = () => {
    const name = currentVideoName();
    const lang = settings.language;

    const context = {
      mediaName: name,
      mediaType: 'video',
      language: lang,
      subtitleHistory: subtitles.subtitles().slice(-50).map((sub) => sub.text),
    };

    bridge.window.openWindow({ type: 'conversation-agent', context: context as unknown as Record<string, unknown> });
  };

  const buildWatchTogetherPayload = () => {
    const mediaUrl = videoState()?.url ?? '';
    if (!isShareableWatchTogetherUrl(mediaUrl)) {
      return null;
    }
    return {
      currentTime: currentTime(),
      paused: !isPlaying(),
      playbackRate: videoState()?.playbackRate ?? 1,
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

  const handleChooseLocalWatchTogether = () => {
    setShowWatchTogetherModeModal(false);
    setWatchTogetherError('');
    watchTogether.activate();
  };

  const handleChooseCodeWatchTogether = () => {
    setShowWatchTogetherModeModal(false);
    openWatchTogetherCodeModal();
  };

  const openWatchTogetherCodeModal = () => {
    setWatchTogetherError('');
    setShowWatchTogetherCodeModal(true);
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
      log.error('error', error);
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
      log.error('error', error);
      setWatchTogetherError((error as Error).message || String(error));
    } finally {
      setWatchTogetherBusy(false);
    }
  };

  const handleCopyWatchTogetherRoomCode = () => {
    const roomCode = watchTogether.roomSession()?.room.roomCode;
    if (!roomCode) return;
    bridge.files.writeToClipboard(roomCode);
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

  createEffect(() => {
    if (!watchTogether.canControl()) return;
    const sub = subtitles.currentSubtitle();
    if (!sub) return;
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

  createEffect(() => {
    const state = watchTogether.roomState();
    if (!state?.mediaUrl || watchTogether.mode() !== 'room-viewer') return;
    if (!isRemoteWatchTogetherUrl(state.mediaUrl)) return;
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

  const currentVideoName = () => videoState()?.title ?? '';

  return (
    <div
      class="overlay-container"
      classList={{
        'drag-over': dragOver(),
        'manipulating': isManipulating(),
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="application"
      aria-label="Subtitle overlay"
    >
      {watchTogether.isActive() && (
        <div class="watch-together-indicator">WT</div>
      )}
      <div
        class="overlay-subtitle-wrapper"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenuPosition({ x: e.clientX, y: e.clientY });
          bridge.window.showCtxMenu({
            isWatchTogether: watchTogether.isActive(),
            hasContextPhrase: !!currentSubtitlePhrase(),
            canExplainPhrase: settings.llmEnabled && !!currentSubtitlePhrase(),
          });
        }}
      >
        <SubtitleContainer
          tokens={subtitles.tokens()}
          isLoading={subtitles.isTokenizing()}
          originalText={subtitles.currentSubtitle()?.text}
          subtitleStart={subtitles.currentSubtitle()?.start}
          subtitleEnd={subtitles.currentSubtitle()?.end}
          videoSrc={videoState()?.url}
          remoteHtml={watchTogether.remoteSubtitle()?.html || null}
          remoteSize={watchTogether.remoteSubtitle()?.size ?? null}
          remoteWeight={watchTogether.remoteSubtitle()?.weight ?? null}
        />
      </div>

      <LiveWordTranslator />

      <SubtitleSync
        currentVideoTime={() => currentTime()}
        subtitles={subtitles.subtitles()}
      />

      <OverlayControls
        isConnected={isConnected()}
        hasSubtitles={hasSubtitles()}
        showSubtitles={settings.showSubtitles !== false}
        subtitleOffset={settings.subsOffsetTime}
        autoPositionEnabled={autoPositionEnabled()}
        showWordSidebar={showWordSidebar()}
        currentVideoTime={() => currentTime()}
        subtitles={subtitles.subtitles()}
        onOffsetChange={handleOffsetChange}
        onLoadSubtitles={handleOpenSubtitleFile}
        onToggleSubtitles={() => updateSettings({ showSubtitles: settings.showSubtitles === false })}
        onClose={handleClose}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onResizeStart={handleResizeStart}
        onResizeMove={handleResizeMove}
        onResizeEnd={handleResizeEnd}
        onToggleAutoPosition={handleToggleAutoPosition}
        onToggleWordSidebar={() => setShowWordSidebar(prev => !prev)}
        onOpenConversationAgent={openConversationAgent}
        isPlaying={isPlaying()}
      />

      <Show when={showWordSidebar()}>
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

      <ExplainerPopup
        isOpen={explainerOpen()}
        onClose={handleCloseExplainer}
        word=""
        contextPhrase={explainerContext()}
        mode="phrase"
        initialPosition={explainerPosition()}
      />

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
