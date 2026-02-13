/**
 * useMediaStats Hook
 * Tracks per-media word/grammar encounters and syncs to disk via IPC.
 * Supports deferred initialization: call setMedia() once the media identity is known.
 */

import { createSignal, onMount, onCleanup } from 'solid-js';
import type { MediaStats, MediaSession, Token } from '../../shared/types';

interface UseMediaStatsOptions {
  mediaType: 'video' | 'book';
  language: string;
}

function hashString(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  }
  return 'mh_' + Math.abs(hash).toString(16);
}

function emptyStats(mediaType: 'video' | 'book', language: string): MediaStats {
  return {
    mediaHash: '',
    mediaName: '',
    mediaType,
    language,
    wordsEncountered: {},
    grammarEncountered: {},
    assessedLevel: null,
    sessions: [],
    totalTimeSpent: 0,
    lastAccessed: Date.now(),
  };
}

export function useMediaStats(options: UseMediaStatsOptions) {
  const [mediaName, setMediaNameSignal] = createSignal('');
  const [mediaHash, setMediaHash] = createSignal('');
  const [stats, setStats] = createSignal<MediaStats>(emptyStats(options.mediaType, options.language));
  const [isActive, setIsActive] = createSignal(false);

  let saveInterval: ReturnType<typeof setInterval> | null = null;
  let sessionStart = Date.now();
  const ipcCleanups: Array<() => void> = [];

  // Save stats to disk
  const saveStats = () => {
    const hash = mediaHash();
    if (!hash) return;
    const current = stats();
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.saveMediaStats(hash, {
        ...current,
        lastAccessed: Date.now(),
      });
    }
  };

  // Load existing stats from disk
  const loadStats = (hash: string) => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.getMediaStats(hash);
      const cleanup = window.mLearnIPC.onMediaStats((loaded) => {
        if (loaded && loaded.mediaHash === hash) {
          setStats(loaded);
        }
      });
      ipcCleanups.push(cleanup);
    }
  };

  // End the current session
  const endSession = () => {
    if (!isActive()) return;
    const duration = Date.now() - sessionStart;
    setStats((prev) => {
      const session: MediaSession = {
        date: new Date().toISOString().split('T')[0],
        duration,
        wordsLearned: Object.keys(prev.wordsEncountered).length,
      };
      return {
        ...prev,
        sessions: [...prev.sessions, session],
        totalTimeSpent: prev.totalTimeSpent + duration,
      };
    });
    saveStats();
  };

  /** Set or change the media identity. Saves previous media, loads new one. */
  const setMedia = (name: string) => {
    if (!name || name === mediaName()) return;

    // Save stats for the previous media if active
    if (isActive()) {
      endSession();
    }

    const hash = hashString(name);
    setMediaNameSignal(name);
    setMediaHash(hash);
    setStats({
      ...emptyStats(options.mediaType, options.language),
      mediaHash: hash,
      mediaName: name,
    });
    setIsActive(true);
    sessionStart = Date.now();

    // Load saved stats
    loadStats(hash);
  };

  // Record a word encounter
  const recordWord = (word: string, ease: number) => {
    if (!isActive()) return;
    setStats((prev) => {
      const existing = prev.wordsEncountered[word] || { word, ease: 2.5, timesSeen: 0, timesHovered: 0 };
      return {
        ...prev,
        wordsEncountered: {
          ...prev.wordsEncountered,
          [word]: {
            ...existing,
            timesSeen: existing.timesSeen + 1,
            ease,
          },
        },
      };
    });
  };

  // Record a word hover
  const recordWordHover = (word: string, ease: number) => {
    if (!isActive()) return;
    setStats((prev) => {
      const existing = prev.wordsEncountered[word] || { word, ease: 2.5, timesSeen: 0, timesHovered: 0 };
      return {
        ...prev,
        wordsEncountered: {
          ...prev.wordsEncountered,
          [word]: {
            ...existing,
            timesHovered: existing.timesHovered + 1,
            ease,
          },
        },
      };
    });
  };

  // Record a grammar encounter
  const recordGrammar = (pattern: string, ease: number) => {
    if (!isActive()) return;
    setStats((prev) => {
      const existing = prev.grammarEncountered[pattern] || { pattern, ease: 2.5, timesFailed: 0 };
      return {
        ...prev,
        grammarEncountered: {
          ...prev.grammarEncountered,
          [pattern]: {
            ...existing,
            ease,
          },
        },
      };
    });
  };

  // Record a grammar failure
  const recordGrammarFailed = (pattern: string, ease: number) => {
    if (!isActive()) return;
    setStats((prev) => {
      const existing = prev.grammarEncountered[pattern] || { pattern, ease: 2.5, timesFailed: 0 };
      return {
        ...prev,
        grammarEncountered: {
          ...prev.grammarEncountered,
          [pattern]: {
            ...existing,
            timesFailed: existing.timesFailed + 1,
            ease,
          },
        },
      };
    });
  };

  // Cache OCR tokens for a page (books)
  const cacheOcrPage = (pageNum: number, tokens: Token[]) => {
    if (!isActive()) return;
    setStats((prev) => ({
      ...prev,
      ocrCache: {
        ...(prev.ocrCache || {}),
        [pageNum]: tokens,
      },
    }));
  };

  // Get cached OCR tokens for a page
  const getCachedOcrPage = (pageNum: number): Token[] | null => {
    return stats().ocrCache?.[pageNum] || null;
  };

  // Set assessed difficulty level
  const setAssessedLevel = (level: number) => {
    if (!isActive()) return;
    setStats((prev) => ({ ...prev, assessedLevel: level }));
  };

  // Listen for word-seen / word-hovered events dispatched by FlashcardContext
  const handleWordSeenEvent = (e: Event) => {
    const { word, ease } = (e as CustomEvent<{ word: string; ease: number }>).detail;
    recordWord(word, ease);
  };

  const handleWordHoveredEvent = (e: Event) => {
    const { word, ease } = (e as CustomEvent<{ word: string; ease: number }>).detail;
    recordWordHover(word, ease);
  };

  onMount(() => {
    // Auto-save every 30 seconds
    saveInterval = setInterval(() => {
      if (isActive()) saveStats();
    }, 30_000);

    window.addEventListener('mlearn:word-seen', handleWordSeenEvent);
    window.addEventListener('mlearn:word-hovered', handleWordHoveredEvent);
  });

  onCleanup(() => {
    if (saveInterval) clearInterval(saveInterval);
    endSession();
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
    window.removeEventListener('mlearn:word-seen', handleWordSeenEvent);
    window.removeEventListener('mlearn:word-hovered', handleWordHoveredEvent);
  });

  return {
    stats,
    mediaHash,
    isActive,
    setMedia,
    recordWord,
    recordWordHover,
    recordGrammar,
    recordGrammarFailed,
    cacheOcrPage,
    getCachedOcrPage,
    setAssessedLevel,
    saveStats,
  };
}
