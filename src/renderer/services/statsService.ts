/**
 * Stats Service
 * Handles time tracking, word statistics, and related data management
 * Ported from stats.js in the original mLearn app
 */

import { createSignal, createMemo } from 'solid-js';
import type { Settings } from '../../shared/types';
import { WORD_STATUS } from '../../shared/constants';

// Word tracking status lookup
const LOOKUP_STATUS: Record<number, string> = {
  [WORD_STATUS.UNKNOWN]: 'Unknown',
  [WORD_STATUS.LEARNING]: 'Learning',
  [WORD_STATUS.KNOWN]: 'Learned',
};

// Stats signals
const [timeWatchedSeconds, setTimeWatchedSeconds] = createSignal<number>(0);
const [wordsLearnedInApp, setWordsLearnedInApp] = createSignal<Record<string, number>>({});
const [isTrackingTime, setIsTrackingTime] = createSignal(false);

let trackingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize time watched from settings
 */
export function initTimeWatched(settings: Settings): void {
  setTimeWatchedSeconds(settings.timeWatched || 0);
}

/**
 * Start tracking time watched
 */
export function startTimeTracking(): void {
  if (isTrackingTime()) return;
  
  setIsTrackingTime(true);
  trackingInterval = setInterval(() => {
    setTimeWatchedSeconds((prev) => prev + 1);
  }, 1000);
}

/**
 * Stop tracking time watched
 */
export function stopTimeTracking(): void {
  if (!isTrackingTime()) return;
  
  setIsTrackingTime(false);
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
}

/**
 * Get time watched in seconds
 */
export function getTimeWatchedSeconds(): number {
  return timeWatchedSeconds();
}

/**
 * Get formatted time watched string (e.g., "2h 30m")
 */
export function getTimeWatchedFormatted(): string {
  const seconds = timeWatchedSeconds();
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Update time watched (for syncing with settings)
 */
export function updateTimeWatched(seconds: number): void {
  setTimeWatchedSeconds(seconds);
}

/**
 * Get words learned in app (uuid -> status)
 */
export function getWordsLearnedInApp(): Record<string, number> {
  return wordsLearnedInApp();
}

/**
 * Get formatted words learned statistics (alias for StatsTab)
 */
export function getWordsLearnedInAppStats(): {
  total: number;
  learned: number;
  learning: number;
  unknown: number;
} {
  return getWordsLearnedFormatted();
}

/**
 * Get formatted words learned statistics
 */
export function getWordsLearnedFormatted(): {
  total: number;
  learned: number;
  learning: number;
  unknown: number;
} {
  const words = wordsLearnedInApp();
  let learned = 0;
  let learning = 0;
  let unknown = 0;

  for (const status of Object.values(words)) {
    if (status === WORD_STATUS.KNOWN) learned++;
    else if (status === WORD_STATUS.LEARNING) learning++;
    else unknown++;
  }

  return {
    total: Object.keys(words).length,
    learned,
    learning,
    unknown,
  };
}

/**
 * Set a word's learning status
 */
export function setWordStatus(uuid: string, status: number): void {
  setWordsLearnedInApp((prev) => ({
    ...prev,
    [uuid]: status,
  }));
}

/**
 * Get a word's learning status
 */
export function getWordStatus(uuid: string): number {
  return wordsLearnedInApp()[uuid] ?? WORD_STATUS.UNKNOWN;
}

/**
 * Load words from storage (localStorage or IPC)
 */
export async function loadWordsFromStorage(): Promise<void> {
  try {
    const stored = localStorage.getItem('mlearn_words_learned');
    if (stored) {
      setWordsLearnedInApp(JSON.parse(stored));
    }
  } catch (e) {
    console.error('Failed to load words from storage:', e);
  }
}

/**
 * Save words to storage
 */
export async function saveWordsToStorage(): Promise<void> {
  try {
    localStorage.setItem('mlearn_words_learned', JSON.stringify(wordsLearnedInApp()));
  } catch (e) {
    console.error('Failed to save words to storage:', e);
  }
}

/**
 * Generate unique identifier for a word (base64 hash)
 */
export async function toUniqueIdentifier(word: string): Promise<string> {
  // Simple hash function for browser compatibility
  const encoded = new TextEncoder().encode(word);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 16); // Use first 16 chars as ID
}

/**
 * Draw pie chart for words learned by status
 */
export function drawWordsLearnedPieChart(
  canvas: HTMLCanvasElement,
  settings: Settings
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const stats = getWordsLearnedFormatted();
  const total = stats.total;

  if (total === 0) {
    ctx.fillStyle = '#aaa';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No tracked words yet', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Calculate pie segments
  const segments = [
    { label: 'Learned', value: stats.learned, color: '#4CAF50' },
    { label: 'Learning', value: stats.learning, color: '#FF9800' },
    { label: 'Unknown', value: stats.unknown, color: '#9E9E9E' },
  ].filter(s => s.value > 0);

  // Canvas setup
  const DPR = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 300;
  const cssHeight = canvas.clientHeight || 200;
  canvas.width = Math.floor(cssWidth * DPR);
  canvas.height = Math.floor(cssHeight * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Clear
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // Pie chart dimensions
  const margin = { top: 20, right: 120, bottom: 20, left: 20 };
  const cx = (cssWidth - margin.left - margin.right) / 2 + margin.left;
  const cy = cssHeight / 2;
  const radius = Math.min(
    (cssWidth - margin.left - margin.right) / 2,
    (cssHeight - margin.top - margin.bottom) / 2
  );

  // Draw pie segments
  let startAngle = -Math.PI / 2;
  segments.forEach((seg) => {
    const sliceAngle = (seg.value / total) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();

    // Label inside slice
    if (seg.value > 0) {
      const mid = startAngle + sliceAngle / 2;
      const lx = cx + Math.cos(mid) * (radius * 0.6);
      const ly = cy + Math.sin(mid) * (radius * 0.6);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${seg.value}`, lx, ly);
    }

    startAngle = endAngle;
  });

  // Title
  ctx.fillStyle = settings.dark_mode ? '#ddd' : '#333';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Words learned in app', margin.left, 14);

  // Legend
  const legendX = cssWidth - margin.right + 10;
  let legendY = margin.top;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  segments.forEach((seg) => {
    const pct = Math.round((seg.value / total) * 1000) / 10;
    ctx.fillStyle = seg.color;
    ctx.fillRect(legendX, legendY, 14, 14);
    ctx.fillStyle = settings.dark_mode ? '#ccc' : '#444';
    ctx.fillText(`${seg.label} – ${seg.value} (${pct}%)`, legendX + 20, legendY);
    legendY += 20;
  });
}

/**
 * Setup video tracking (play/pause events)
 */
export function setupVideoTracking(video: HTMLVideoElement): () => void {
  const handlePlay = () => startTimeTracking();
  const handlePause = () => stopTimeTracking();
  const handleEnded = () => stopTimeTracking();

  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);
  video.addEventListener('ended', handleEnded);

  return () => {
    video.removeEventListener('play', handlePlay);
    video.removeEventListener('pause', handlePause);
    video.removeEventListener('ended', handleEnded);
    stopTimeTracking();
  };
}

// Export signals for reactive access
export {
  timeWatchedSeconds,
  wordsLearnedInApp,
  isTrackingTime,
  LOOKUP_STATUS,
};
