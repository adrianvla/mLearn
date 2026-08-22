/**
 * Stats Service
 * Time tracking.
 */

import { createSignal } from 'solid-js';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

// Stats signals
const [timeWatchedSeconds, setTimeWatchedSeconds] = createSignal<number>(0);
const [isTrackingTime, setIsTrackingTime] = createSignal(false);

let trackingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize time watched from settings
 */
export function initTimeWatched(settings: Settings): void {
  setTimeWatchedSeconds(settings.timeWatched || DEFAULT_SETTINGS.timeWatched);
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
 * Get formatted time watched string, localized via the provided translation function.
 */
export function getTimeWatchedFormatted(t: (key: string, params?: Record<string, string | number>) => string): string {
  const seconds = timeWatchedSeconds();
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return t('mlearn.Global.Time.HoursMinutes', { hours, minutes });
  }
  return t('mlearn.Global.Time.ShortMinute', { value: minutes });
}

/**
 * Update time watched (for syncing with settings)
 */
export function updateTimeWatched(seconds: number): void {
  setTimeWatchedSeconds(seconds);
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
  isTrackingTime,
};