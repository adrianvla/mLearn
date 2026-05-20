import { Component, Show, createSignal, createMemo, onMount, onCleanup, createEffect, untrack } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type { OverlayVideoState, OverlayGeometry, OverlaySubtitleTracks, Token } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { SubtitleContainer } from '../../components/subtitle/SubtitleContainer';
import { LiveWordTranslator } from '../../components/subtitle/LiveWordTranslator';
import { SubtitleSync } from '../../components/subtitle/SubtitleSync';
import { ExplainerPopup } from '../../components/subtitle/ExplainerPopup';
import { WordHover } from '../../components/subtitle/WordHover';
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

interface TextModeLookupData {
  word: string;
  x: number;
  y: number;
  contextText?: string;
  offset?: number;
}

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

function findTokenByOffset(tokens: Token[], text: string, offset: number): Token | null {
  let pos = 0;
  for (const token of tokens) {
    const surface = token.surface ?? token.word;
    const idx = text.indexOf(surface, pos);
    if (idx === -1) continue;
    const start = idx;
    const end = idx + surface.length;
    if (offset >= start && offset < end) {
      return token;
    }
    pos = end;
  }
  return null;
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
  const [explainerWord, setExplainerWord] = createSignal('');
  const [explainerContext, setExplainerContext] = createSignal('');
  const [explainerPosition, setExplainerPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [contextMenuPosition, setContextMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showWatchTogetherModeModal, setShowWatchTogetherModeModal] = createSignal(false);
  const [showWatchTogetherCodeModal, setShowWatchTogetherCodeModal] = createSignal(false);
  const [showWatchTogetherSignInModal, setShowWatchTogetherSignInModal] = createSignal(false);
  const [watchTogetherBusy, setWatchTogetherBusy] = createSignal(false);
  const [watchTogetherError, setWatchTogetherError] = createSignal('');
  const [lastScreenshot, setLastScreenshot] = createSignal<string | null>(null);

  // Text mode state
  const [textModeLookup, setTextModeLookup] = createSignal<TextModeLookupData | null>(null);
  const [textModeToken, setTextModeToken] = createSignal<Token | null>(null);
  const [textModeTranslation, setTextModeTranslation] = createSignal<{ data?: unknown[] } | null>(null);
  const [textModeLoading, setTextModeLoading] = createSignal(false);

  const [viewportScale, setViewportScale] = createSignal({ x: 1, y: 1 });

  const textModeScaledPosition = createMemo(() => {
    const lookup = textModeLookup();
    const scale = viewportScale();
    if (!lookup) return { x: 0, y: 0 };
    return {
      x: lookup.x * scale.x,
      y: lookup.y * scale.y,
    };
  });

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
        console.log('[Overlay] videoState update: url=', state.url, 'time=', state.currentTime);
        setVideoState(state);
        setLastSyncAt(Date.now());
        setIsConnected(true);

        if (state.url) {
          const strip = (u: string) => u.replace(/^https?:\/\//i, '').toLowerCase();
          const currentUrl = lastVideoUrl();
          if (!currentUrl || strip(state.url) === strip(currentUrl)) {
            updateSetting('overlayTextMode', false);
          }
        }

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
          const newText = tracks.textTracks[0].text;
          if (newText === subtitleContent()) {
            console.log('[Overlay] Subtitle content unchanged, skipping reload');
            return;
          }
          console.log('[Overlay] Loading subtitle track, text length=', newText.length);
          setSubtitleContent(newText);
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
      bridge.overlay.onOverlayActiveUrlChanged((url: string) => {
        console.log('[Overlay] active-url-changed received:', url, '| current lastVideoUrl:', lastVideoUrl());
        const prevUrl = lastVideoUrl();
        const strip = (u: string) => u.replace(/^https?:\/\//i, '').toLowerCase();
        const current = strip(url);
        const previous = strip(prevUrl);
        console.log('[Overlay] stripped: current=', current, 'previous=', previous);
        if (current !== previous) {
          console.log('[Overlay] URL differs, switching site state from', previous, 'to', current);
          if (prevUrl) saveSiteOverlayState(strip(prevUrl));
          setSubtitleContent('');
          subtitles.clearSubtitles();
          updateSetting('subsOffsetTime', 0);
          clearTextModeLookup();
          setLastVideoUrl(url);
          loadSiteOverlayState(current);
          bridge.overlay.requestOverlaySync();
        } else {
          console.log('[Overlay] URL same, skipping state switch');
        }
      })
    );

    cleanups.push(
      bridge.overlay.onOverlayTextModeLookup((payload: { word: string; x: number; y: number; contextText?: string; offset?: number }) => {
        console.log('[Overlay] 🏁 textModeLookup: word=', payload.word, 'x=', payload.x, 'y=', payload.y, 'contextText length=', payload.contextText?.length, 'screen=', window.screen.width, 'x', window.screen.height, 'inner=', window.innerWidth, 'x', window.innerHeight);
        updateSetting('overlayTextMode', true);
        console.log('[Overlay] 📏 sending overlaySetBounds to fullscreen');
        bridge.overlay.overlaySetBounds({
          x: 0, y: 0,
          width: window.screen.width,
          height: window.screen.height,
        });
        setTextModeLookup(payload);
      })
    );

    cleanups.push(
      bridge.overlay.onOverlayCloseHover(() => {
        setTextModeLookup(null);
        setTextModeToken(null);
        setTextModeTranslation(null);
      })
    );

    cleanups.push(
      bridge.overlay.onOverlayVideoScreenshot(async (screenshot: { dataUrl: string; timestamp: number }) => {
        const cardId = `overlay-screenshot-${Date.now()}`;
        const fileUrl = await getBridge().flashcards.saveFlashcardImage(cardId, screenshot.dataUrl);
        if (fileUrl) {
          setLastScreenshot(fileUrl);
        }
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

    const stateSaveInterval = setInterval(() => {
      const url = lastVideoUrl();
      if (url) saveSiteOverlayState(url);
    }, 30000);
    cleanups.push(() => clearInterval(stateSaveInterval));
    cleanups.push(() => clearInterval(interval));

    bridge.overlay.overlayGetBounds().then((bounds) => {
      if (bounds) {
        console.log('[Overlay] initial bounds:', bounds);
        setLastSyncAt(Date.now());
        setIsConnected(true);
      }
    });

    const handleResize = () => {
      setViewportScale({
        x: window.innerWidth / window.screen.width,
        y: window.innerHeight / window.screen.height,
      });
      console.log('[Overlay] 📐 window resize: inner=', window.innerWidth, 'x', window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    cleanups.push(() => window.removeEventListener('resize', handleResize));

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
    bridge.overlay.overlaySetGeometryLocked(settings.overlayTextMode === true);
  });

  createEffect(() => {
    const content = subtitleContent();
    if (content) {
      subtitles.loadSubtitles(content);
      if (untrack(() => settings.showSubtitles) === false) {
        updateSetting('showSubtitles', true);
      }
      subtitles.updateTime(currentTime());
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

  function saveSiteOverlayState(url: string): void {
    if (!url) return;
    bridge.overlay.overlaySaveSiteState({
      url,
      state: {
        subsOffsetTime: settings.subsOffsetTime,
        subtitleContent: subtitleContent(),
        overlayTextMode: settings.overlayTextMode,
      },
    });
  }

  async function loadSiteOverlayState(url: string): Promise<void> {
    if (!url) return;
    const saved = await bridge.overlay.overlayLoadSiteState(url);
    if (!saved) return;
    if (typeof saved.subsOffsetTime === 'number') {
      updateSetting('subsOffsetTime', saved.subsOffsetTime);
    }
    if (typeof saved.subtitleContent === 'string' && saved.subtitleContent) {
      setSubtitleContent(saved.subtitleContent);
    }
    if (typeof saved.overlayTextMode === 'boolean') {
      updateSetting('overlayTextMode', saved.overlayTextMode);
      if (saved.overlayTextMode) {
        bridge.overlay.overlaySetBounds({
          x: 0, y: 0,
          width: window.screen.width,
          height: window.screen.height,
        });
      }
    } else {
      const pos = saved.position as { x: number; y: number } | undefined;
      const sz = saved.size as { width: number; height: number } | undefined;
      if (pos && typeof pos.x === 'number') {
        bridge.overlay.overlaySetBounds({
          x: pos.x,
          y: pos.y,
          width: (sz && typeof sz.width === 'number') ? sz.width : 800,
          height: (sz && typeof sz.height === 'number') ? sz.height : 600,
        });
      }
    }
  }

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

  createEffect(() => {
    if (!settings.showSubtitles) {
      console.log('[Overlay] showSubtitles is FALSE');
    }
  });

  const clearTextModeLookup = () => {
    setTextModeLookup(null);
    setTextModeToken(null);
    setTextModeTranslation(null);
    setTextModeLoading(false);
  };

  const handleToggleSubtitles = () => {
    const next = !(settings.showSubtitles ?? true);
    updateSetting('showSubtitles', next);
    if (next) {
      subtitles.updateTime(currentTime());
    }
  };

  const handleOffsetChange = (offset: number) => {
    updateSettings({ subsOffsetTime: offset });
    subtitles.updateTime(currentTime());
  };

  const handleClose = () => {
    const url = lastVideoUrl();
    if (url) saveSiteOverlayState(url);
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
    setExplainerWord('');
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);
  };

  const handleOpenExplainer = (word: string, context: string, position: { x: number; y: number }) => {
    setExplainerWord(word);
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);
  };

  const handleCloseExplainer = () => {
    setExplainerOpen(false);
    setExplainerWord('');
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
        screenshotDataUrl: lastScreenshot() || undefined,
      });

      if (settings.flashcardMediaType === 'video' && (videoState()?.videoSrc || videoState()?.url) && entry.subtitleStart != null && entry.subtitleEnd != null) {
        const { clipVideo } = await import('../../services/videoClipService');
        const { toUniqueIdentifier } = await import('../../services/statsService');
        const margin = (settings.flashcardVideoMargin ?? DEFAULT_SETTINGS.flashcardVideoMargin) / 1000;
        const start = Math.max(0, entry.subtitleStart - margin);
        const end = entry.subtitleEnd + margin;
        const videoData = await clipVideo(videoState()?.videoSrc || videoState()!.url!, start, end);
        if (videoData) {
          const cardId = content.word ? await toUniqueIdentifier(content.word) : crypto.randomUUID();
          const videoUrl = await getBridge().flashcards.saveFlashcardVideo(cardId, videoData.buffer as ArrayBuffer);
          if (videoUrl) {
            content.videoUrl = videoUrl;
            content.skipExampleTts = true;
          } else {
            showToast({ message: t('mlearn.Video.VideoClipFailed'), variant: 'warning' });
          }
        } else {
          showToast({ message: t('mlearn.Video.VideoClipFailed'), variant: 'warning' });
        }
      }

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

  const handleToggleLiveTranslator = () => {
    updateSetting('showLiveTranslator', settings.showLiveTranslator === false ? true : false);
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

  createEffect(() => {
    const lookup = textModeLookup();
    if (!lookup) return;

    console.log('[Overlay] ⚡ textModeLookup effect firing, word=', lookup.word, 'contextText length=', lookup.contextText?.length, 'offset=', lookup.offset, 'inner=', window.innerWidth, 'x', window.innerHeight);
    setTextModeLoading(true);
    const word = lookup.word;
    const contextText = lookup.contextText;
    const offset = lookup.offset;

    // If we have full context from the extension, tokenize the full text
    // so the backend can properly split CJK text (which doesn't use spaces between words).
    // Then find the clicked word in the tokenized results.
    const textToTokenize = contextText || word;

    tokenize(textToTokenize).then((tokens) => {
      console.log('[Overlay] ✅ tokenize complete, will setTextModeToken, inner=', window.innerWidth, 'x', window.innerHeight);
      let selectedToken: Token | null = null;

      if (tokens && tokens.length > 0) {
        // Prefer offset-based matching for CJK and other languages where
        // the extension cannot reliably determine word boundaries.
        if (contextText && offset !== undefined && offset >= 0) {
          selectedToken = findTokenByOffset(tokens, contextText, offset);
        }
        // Fallback to string matching when offset is unavailable.
        if (!selectedToken && contextText) {
          selectedToken = tokens.find(
            (t) => (t.surface === word || t.word === word || t.actual_word === word)
          ) ?? null;
        }
        if (!selectedToken) {
          selectedToken = tokens[0];
        }
      }

      if (!selectedToken) {
        selectedToken = {
          word,
          actual_word: word,
          type: 'unknown',
          surface: word,
          partOfSpeech: 'unknown',
        };
      }

      setTextModeToken(selectedToken);

      const lookupWord = selectedToken.actual_word ?? selectedToken.surface ?? selectedToken.word;
      const cached = getCachedTranslation(lookupWord, settings.language);
      if (cached) {
        setTextModeTranslation(cached);
        setTextModeLoading(false);
      } else {
        translateWord(lookupWord)
          .then((result) => {
            if (result) setTextModeTranslation(result);
          })
          .catch((e) => {
            log.error('Overlay translate failed', e);
          })
          .finally(() => {
            setTextModeLoading(false);
          });
      }
    }).catch(() => {
      setTextModeToken({
        word,
        actual_word: word,
        type: 'unknown',
        surface: word,
        partOfSpeech: 'unknown',
      });
      setTextModeLoading(false);
    });
  });

  createEffect(() => {
    if (!textModeToken()) return;
    const clickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.word-hover-container')) return;
      setTextModeLookup(null);
      setTextModeToken(null);
      setTextModeTranslation(null);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTextModeLookup(null);
        setTextModeToken(null);
        setTextModeTranslation(null);
      }
    };
    document.addEventListener('mousedown', clickHandler);
    document.addEventListener('keydown', keyHandler);
    onCleanup(() => {
      document.removeEventListener('mousedown', clickHandler);
      document.removeEventListener('keydown', keyHandler);
    });
  });

  const currentVideoName = () => videoState()?.title ?? '';

  return (
    <div
      class="overlay-container"
      classList={{
        'drag-over': dragOver(),
        'manipulating': isManipulating(),
        'text-mode': settings.overlayTextMode === true,
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="application"
      aria-label="Subtitle overlay"
    >
      <Show
        when={settings.overlayTextMode}
        fallback={
          <>
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
                videoSrc={videoState()?.videoSrc || videoState()?.url}
                lastScreenshot={lastScreenshot() || undefined}
                remoteHtml={watchTogether.remoteSubtitle()?.html || null}
                remoteSize={watchTogether.remoteSubtitle()?.size ?? null}
                remoteWeight={watchTogether.remoteSubtitle()?.weight ?? null}
              />
            </div>

            <Show when={hasSubtitles()}>
              <LiveWordTranslator />
            </Show>

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
              showLiveTranslator={settings.showLiveTranslator}
              isWatchTogetherActive={watchTogether.isActive()}
              currentVideoTime={() => currentTime()}
              subtitles={subtitles.subtitles()}
              onOffsetChange={handleOffsetChange}
              onLoadSubtitles={handleOpenSubtitleFile}
              onToggleSubtitles={handleToggleSubtitles}
              onClose={handleClose}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onResizeStart={handleResizeStart}
              onResizeMove={handleResizeMove}
              onResizeEnd={handleResizeEnd}
              onToggleAutoPosition={handleToggleAutoPosition}
              onToggleWatchTogether={handleWatchTogetherCommand}
              onToggleLiveTranslator={handleToggleLiveTranslator}
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
              word={explainerWord()}
              contextPhrase={explainerContext()}
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
          </>
        }
      >
        <div
          class="text-mode-top-bar"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startY = e.clientY;
            const handleMouseMove = (ev: MouseEvent) => {
              bridge.overlay.overlayMoveBy({ x: ev.clientX - startX, y: ev.clientY - startY });
            };
            const handleMouseUp = () => {
              window.removeEventListener('mousemove', handleMouseMove);
              window.removeEventListener('mouseup', handleMouseUp);
            };
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
          }}
        >
          <div class="text-mode-status-row">
            <span
              class="text-mode-status-dot"
              classList={{ connected: isConnected() }}
            />
            <span class="text-mode-drag-handle" />
          </div>
        </div>
      </Show>

      <Show when={textModeToken() && textModeLookup()}>
        <WordHover
          token={textModeToken()!}
          word={textModeToken()!.actual_word ?? textModeToken()!.surface ?? textModeToken()!.word}
          position={textModeScaledPosition()}
          translationData={textModeTranslation() as never}
          isLoading={textModeLoading()}
          contextPhrase={textModeLookup()?.contextText || ''}
          onOpenExplainer={handleOpenExplainer}
          onClose={() => {
            setTextModeLookup(null);
            setTextModeToken(null);
            setTextModeTranslation(null);
          }}
        />
      </Show>
    </div>
  );
};
