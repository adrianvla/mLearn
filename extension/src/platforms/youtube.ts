import type { SitePlatform, PlatformSubtitleResult } from './types.js';

interface CaptionEntry {
  start: number;
  end: number;
  text: string;
}

const CAPTION_CONTAINER_SELECTOR = '.ytp-caption-window-container';
const MIN_CAPTION_DURATION_SECONDS = 5;
const MAX_FINALIZED_ENTRIES = 50;
const EMIT_THROTTLE_MS = 500;

function toSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function generateSRT(entries: CaptionEntry[]): string {
  return entries
    .map((entry, index) => {
      return `${index + 1}\n${toSRTTime(entry.start)} --> ${toSRTTime(entry.end)}\n${entry.text}`;
    })
    .join('\n\n');
}

function extractCaptionText(container: Element): { text: string; language: string } | null {
  const windows = container.querySelectorAll('.caption-window, .ytp-caption-window');
  if (windows.length === 0) return null;

  const lines: string[] = [];
  let language = 'unknown';

  for (const windowEl of Array.from(windows)) {
    const lang = windowEl.getAttribute('lang');
    if (lang) language = lang;

    const visualLines = windowEl.querySelectorAll('.caption-visual-line, .ytp-caption-visual-line, .captions-text');
    for (const lineEl of Array.from(visualLines)) {
      const segments = lineEl.querySelectorAll('.ytp-caption-segment');
      const lineText = Array.from(segments)
        .map((seg) => seg.textContent || '')
        .join('');
      if (lineText) lines.push(lineText);
    }
  }

  if (lines.length === 0) return null;
  return { text: lines.join('\n'), language };
}

export const youtubePlatform: SitePlatform = {
  name: 'youtube',

  matchesUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
    } catch {
      return false;
    }
  },

  startMonitoring(video: HTMLVideoElement, onSubtitlesChanged: (result: PlatformSubtitleResult) => void): () => void {
    let finalizedEntries: CaptionEntry[] = [];
    let currentEntry: CaptionEntry | null = null;
    let lastText = '';
    let containerObserver: MutationObserver | null = null;
    let documentObserver: MutationObserver | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let lastObservedContainer: Element | null = null;
    let lastEmittedSrt: string | null = null;
    let lastEmitTime = 0;
    let readDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const READ_DEBOUNCE_MS = 120;

    console.log('[mLearn:youtube] startMonitoring called');

    function emitSubtitles(force = false): void {
      let entries: CaptionEntry[] = [...finalizedEntries];
      if (currentEntry) {
        entries.push({
          ...currentEntry,
          end: Math.max(currentEntry.end, video.currentTime),
        });
      }

      // Merge consecutive entries with identical text to prevent duplicates
      // caused by brief flickers or transition artifacts
      const deduped: CaptionEntry[] = [];
      for (const entry of entries) {
        const last = deduped[deduped.length - 1];
        if (last && last.text === entry.text) {
          last.end = Math.max(last.end, entry.end);
        } else {
          deduped.push({ ...entry });
        }
      }
      entries = deduped;

      if (entries.length === 0) return;

      const srtText = generateSRT(entries);
      const now = Date.now();

      if (!force && srtText === lastEmittedSrt && now - lastEmitTime < EMIT_THROTTLE_MS) {
        return;
      }
      lastEmittedSrt = srtText;
      lastEmitTime = now;

      const container = document.querySelector(CAPTION_CONTAINER_SELECTOR);
      const language = container ? (extractCaptionText(container)?.language || 'unknown') : 'unknown';

      console.log('[mLearn:youtube] emitSubtitles: entries=', entries.length, 'language=', language, 'srtLength=', srtText.length);

      onSubtitlesChanged({
        tracks: [],
        textTracks: [{ language, text: srtText }],
      });
    }

    function readCaptions(): void {
      if (readDebounceTimer) {
        clearTimeout(readDebounceTimer);
      }
      readDebounceTimer = setTimeout(() => {
        readDebounceTimer = null;
        doReadCaptions();
      }, READ_DEBOUNCE_MS);
    }

    function doReadCaptions(): void {
      const container = document.querySelector(CAPTION_CONTAINER_SELECTOR);
      const captionData = container ? extractCaptionText(container) : null;
      const now = video.currentTime;

      console.log('[mLearn:youtube] doReadCaptions: container=', !!container, 'captionData=', !!captionData, 'currentTime=', now);

      if (!captionData || captionData.text === '') {
        if (currentEntry) {
          currentEntry.end = now;
          finalizedEntries.push(currentEntry);
          if (finalizedEntries.length > MAX_FINALIZED_ENTRIES) {
            finalizedEntries = finalizedEntries.slice(-MAX_FINALIZED_ENTRIES);
          }
          currentEntry = null;
          lastText = '';
          emitSubtitles(true);
        }
        return;
      }

      const text = captionData.text;
      if (text === lastText) {
        if (currentEntry) {
          currentEntry.end = now;
        }
        return;
      }

      if (currentEntry) {
        currentEntry.end = now;
        finalizedEntries.push(currentEntry);
        if (finalizedEntries.length > MAX_FINALIZED_ENTRIES) {
          finalizedEntries = finalizedEntries.slice(-MAX_FINALIZED_ENTRIES);
        }
      }

      currentEntry = { start: now, end: now + MIN_CAPTION_DURATION_SECONDS, text };
      lastText = text;
      emitSubtitles(true);
    }

    function observeContainer(container: Element): void {
      if (containerObserver) {
        containerObserver.disconnect();
      }
      lastObservedContainer = container;
      containerObserver = new MutationObserver(() => {
        readCaptions();
      });
      containerObserver.observe(container, { childList: true, subtree: true, characterData: true });
      console.log('[mLearn:youtube] Observing caption container');
    }

    function findAndObserveContainer(): void {
      const container = document.querySelector(CAPTION_CONTAINER_SELECTOR);
      if (container && container !== lastObservedContainer) {
        observeContainer(container);
        readCaptions();
      }
    }

    function setupDocumentObserver(): void {
      if (documentObserver) return;
      documentObserver = new MutationObserver((mutations) => {
        let shouldCheck = false;
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof Element) {
              if (node.matches(CAPTION_CONTAINER_SELECTOR) || node.querySelector(CAPTION_CONTAINER_SELECTOR)) {
                shouldCheck = true;
                break;
              }
            }
          }
          if (!shouldCheck && lastObservedContainer && !document.contains(lastObservedContainer)) {
            console.log('[mLearn:youtube] Caption container removed from DOM');
            if (containerObserver) {
              containerObserver.disconnect();
              containerObserver = null;
            }
            lastObservedContainer = null;
            shouldCheck = true;
          }
        }
        if (shouldCheck) {
          findAndObserveContainer();
        }
      });
      documentObserver.observe(document.documentElement, { childList: true, subtree: true });
      console.log('[mLearn:youtube] Document observer set up');
    }

    findAndObserveContainer();
    setupDocumentObserver();

    heartbeatInterval = setInterval(() => {
      if (currentEntry) {
        const oldEnd = currentEntry.end;
        currentEntry.end = video.currentTime;
        if (currentEntry.end - oldEnd >= 1) {
          emitSubtitles();
        }
      }
    }, 2000);

    return () => {
      console.log('[mLearn:youtube] Cleanup called');
      if (readDebounceTimer) {
        clearTimeout(readDebounceTimer);
        readDebounceTimer = null;
      }
      if (containerObserver) {
        containerObserver.disconnect();
        containerObserver = null;
      }
      if (documentObserver) {
        documentObserver.disconnect();
        documentObserver = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      lastObservedContainer = null;
    };
  },
};
