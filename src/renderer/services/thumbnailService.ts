/**
 * Thumbnail Service
 * Captures thumbnails from video and images for recent items
 */

import { getBridge } from '../../shared/bridges';

/**
 * Capture a screenshot from a video element and return as a data URL
 * @param video - The video element to capture from
 * @param maxWidth - Maximum width of the thumbnail (default: 300)
 * @param quality - JPEG quality 0-1 (default: 0.6)
 */
export function captureVideoThumbnail(
  video: HTMLVideoElement,
  maxWidth: number = 300,
  quality: number = 0.6
): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('Failed to get canvas 2D context');
      return '';
    }

    // Get video dimensions
    const videoWidth = video.videoWidth || video.clientWidth || 0;
    const videoHeight = video.videoHeight || video.clientHeight || 0;

    if (videoWidth === 0 || videoHeight === 0) {
      console.warn('Video has no dimensions');
      return '';
    }

    // Calculate thumbnail dimensions maintaining aspect ratio
    const aspectRatio = videoHeight / videoWidth;
    const thumbWidth = Math.min(videoWidth, maxWidth);
    const thumbHeight = Math.round(thumbWidth * aspectRatio);

    canvas.width = thumbWidth;
    canvas.height = thumbHeight;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);

    // Return as JPEG data URL
    return canvas.toDataURL('image/jpeg', quality);
  } catch (e) {
    console.error('Failed to capture video thumbnail:', e);
    return '';
  }
}

/**
 * Capture a thumbnail from an image element
 * @param img - The image element to capture from
 * @param maxWidth - Maximum width of the thumbnail (default: 300)
 * @param quality - JPEG quality 0-1 (default: 0.6)
 */
export function captureImageThumbnail(
  img: HTMLImageElement,
  maxWidth: number = 300,
  quality: number = 0.6
): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const imgWidth = img.naturalWidth || img.width || 0;
    const imgHeight = img.naturalHeight || img.height || 0;

    if (imgWidth === 0 || imgHeight === 0) return '';

    const aspectRatio = imgHeight / imgWidth;
    const thumbWidth = Math.min(imgWidth, maxWidth);
    const thumbHeight = Math.round(thumbWidth * aspectRatio);

    canvas.width = thumbWidth;
    canvas.height = thumbHeight;

    ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight);

    return canvas.toDataURL('image/jpeg', quality);
  } catch (e) {
    console.error('Failed to capture image thumbnail:', e);
    return '';
  }
}

/**
 * Capture a thumbnail from a Blob (image file)
 * @param blob - The blob to capture from
 * @param maxWidth - Maximum width of the thumbnail (default: 300)
 * @param quality - JPEG quality 0-1 (default: 0.6)
 */
export async function captureBlobThumbnail(
  blob: Blob,
  maxWidth: number = 300,
  quality: number = 0.6
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const thumbnail = captureImageThumbnail(img, maxWidth, quality);
      URL.revokeObjectURL(img.src);
      resolve(thumbnail);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve('');
    };
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Interface for recent item storage
 */
export interface RecentItem {
  type: 'video' | 'book';
  name: string;
  path: string;
  subtitlePath?: string;
  thumbnail?: string;
  progress: number;
  playbackTime?: number;
  lastWatched: number;
}

const STORAGE_KEY = 'mlearn_recent_items';
const MAX_ITEMS = 10;

const matchesRecentItem = (item: Pick<RecentItem, 'name' | 'path'>, target: Pick<RecentItem, 'name' | 'path'>): boolean => {
  if (item.path && target.path) {
    return item.path === target.path;
  }

  return item.name === target.name;
};

/**
 * Save an item to recent items with optional thumbnail
 * Note: Items without a path will be saved but cannot be reopened from the welcome screen
 */
export async function saveToRecentItems(
  item: Omit<RecentItem, 'lastWatched'>,
  thumbnail?: string
): Promise<void> {
  try {
    // Warn if saving without path - these items won't be openable
    if (!item.path || !item.path.trim()) {
      console.warn(`[Recent] Saving item "${item.name}" without path - it cannot be reopened from welcome screen`);
    }
    
    const items = await getRecentItems();
    
    // Preserve existing thumbnail when no new one is provided
    const existing = items.find((recentItem) => matchesRecentItem(recentItem, item));
    
    // Create new item
    const newItem: RecentItem = {
      ...item,
      subtitlePath: item.subtitlePath ?? existing?.subtitlePath,
      thumbnail: thumbnail || item.thumbnail || existing?.thumbnail,
      lastWatched: Date.now(),
    };
    
    // Remove existing item with same name if present
    const filtered = items.filter((recentItem) => !matchesRecentItem(recentItem, item));
    
    // Add new item at the beginning
    const updated = [newItem, ...filtered].slice(0, MAX_ITEMS);
    
    await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save recent item:', e);
  }
}

/**
 * Get all recent items
 */
export async function getRecentItems(): Promise<RecentItem[]> {
  try {
    const stored = await getBridge().kvStore.kvGet(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to get recent items:', e);
    return [];
  }
}

/**
 * Update thumbnail for an existing recent item
 */
export async function updateRecentItemThumbnail(name: string, thumbnail: string): Promise<void> {
  try {
    const items = await getRecentItems();
    const index = items.findIndex((item) => item.name === name);
    if (index !== -1) {
      items[index].thumbnail = thumbnail;
      await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item thumbnail:', e);
  }
}

/**
 * Update progress for an existing recent item
 */
export async function updateRecentItemProgress(name: string, progress: number): Promise<void> {
  try {
    const items = await getRecentItems();
    const index = items.findIndex((item) => item.name === name);
    if (index !== -1) {
      items[index].progress = progress;
      items[index].lastWatched = Date.now();
      await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item progress:', e);
  }
}

export async function updateRecentItemSubtitlePath(name: string, subtitlePath: string): Promise<void> {
  try {
    const items = await getRecentItems();
    const index = items.findIndex((item) => item.name === name);
    if (index !== -1) {
      items[index].subtitlePath = subtitlePath;
      items[index].lastWatched = Date.now();
      await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item subtitle path:', e);
  }
}

export async function updateRecentItemThumbnailByPath(path: string, thumbnail: string): Promise<void> {
  try {
    const items = await getRecentItems();
    const index = items.findIndex((item) => item.path === path);
    if (index !== -1) {
      items[index].thumbnail = thumbnail;
      await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item thumbnail by path:', e);
  }
}

export async function updateRecentItemProgressByPath(path: string, progress: number): Promise<void> {
  try {
    const items = await getRecentItems();
    const index = items.findIndex((item) => item.path === path);
    if (index !== -1) {
      items[index].progress = progress;
      items[index].lastWatched = Date.now();
      await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item progress by path:', e);
  }
}

export async function updateRecentItemSubtitlePathByPath(path: string, subtitlePath: string): Promise<void> {
  try {
    const items = await getRecentItems();
    const index = items.findIndex((item) => item.path === path);
    if (index !== -1) {
      items[index].subtitlePath = subtitlePath;
      items[index].lastWatched = Date.now();
      await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item subtitle path by path:', e);
  }
}

export async function updateRecentItemPlaybackTime(name: string, playbackTime: number): Promise<void> {
  try {
    const items = await getRecentItems();
    const index = items.findIndex((item) => item.name === name);
    if (index !== -1) {
      items[index].playbackTime = playbackTime;
      items[index].lastWatched = Date.now();
      await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item playback time:', e);
  }
}

export async function updateRecentItemPlaybackTimeByPath(path: string, playbackTime: number): Promise<void> {
  try {
    const items = await getRecentItems();
    const index = items.findIndex((item) => item.path === path);
    if (index !== -1) {
      items[index].playbackTime = playbackTime;
      items[index].lastWatched = Date.now();
      await getBridge().kvStore.kvSet(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item playback time by path:', e);
  }
}
