/**
 * Thumbnail Service
 * Captures thumbnails from video and images for recent items
 */

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
  thumbnail?: string;
  progress: number;
  lastWatched: number;
}

const STORAGE_KEY = 'mlearn_recent_items';
const MAX_ITEMS = 10;

/**
 * Save an item to recent items with optional thumbnail
 */
export function saveToRecentItems(
  item: Omit<RecentItem, 'lastWatched'>,
  thumbnail?: string
): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const items: RecentItem[] = stored ? JSON.parse(stored) : [];
    
    // Create new item
    const newItem: RecentItem = {
      ...item,
      thumbnail: thumbnail || item.thumbnail,
      lastWatched: Date.now(),
    };
    
    // Remove existing item with same name if present
    const filtered = items.filter((i) => i.name !== item.name);
    
    // Add new item at the beginning
    const updated = [newItem, ...filtered].slice(0, MAX_ITEMS);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save recent item:', e);
  }
}

/**
 * Get all recent items
 */
export function getRecentItems(): RecentItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to get recent items:', e);
    return [];
  }
}

/**
 * Update thumbnail for an existing recent item
 */
export function updateRecentItemThumbnail(name: string, thumbnail: string): void {
  try {
    const items = getRecentItems();
    const index = items.findIndex((i) => i.name === name);
    if (index !== -1) {
      items[index].thumbnail = thumbnail;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item thumbnail:', e);
  }
}

/**
 * Update progress for an existing recent item
 */
export function updateRecentItemProgress(name: string, progress: number): void {
  try {
    const items = getRecentItems();
    const index = items.findIndex((i) => i.name === name);
    if (index !== -1) {
      items[index].progress = progress;
      items[index].lastWatched = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  } catch (e) {
    console.error('Failed to update recent item progress:', e);
  }
}
