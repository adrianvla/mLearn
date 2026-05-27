// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockKvGet = vi.fn();
const mockKvSet = vi.fn();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    kvStore: {
      kvGet: mockKvGet,
      kvSet: mockKvSet,
    },
  }),
}));

import {
  captureVideoThumbnail,
  captureImageThumbnail,
  captureBlobThumbnail,
  saveToRecentItems,
  getRecentItems,
  updateRecentItemThumbnail,
  updateRecentItemProgress,
  updateRecentItemSubtitlePath,
  updateRecentItemThumbnailByPath,
  updateRecentItemProgressByPath,
  updateRecentItemSubtitlePathByPath,
  type RecentItem,
} from './thumbnailService';

const originalCreateElement = document.createElement.bind(document);

function makeCanvasMock(dataUrl = 'data:image/jpeg;base64,FAKE') {
  const ctx = { drawImage: vi.fn() };
  const canvas = {
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => dataUrl),
    width: 0,
    height: 0,
  };
  return { canvas, ctx };
}

function makeVideoElement(videoWidth = 640, videoHeight = 360): HTMLVideoElement {
  return { videoWidth, videoHeight, clientWidth: videoWidth, clientHeight: videoHeight } as unknown as HTMLVideoElement;
}

function makeImageElement(naturalWidth = 800, naturalHeight = 600): HTMLImageElement {
  return { naturalWidth, naturalHeight, width: naturalWidth, height: naturalHeight } as unknown as HTMLImageElement;
}

describe('thumbnailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.createElement = originalCreateElement;
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
  });

  describe('captureVideoThumbnail', () => {
    it('returns a data URL when the video has valid dimensions', () => {
      const { canvas, ctx } = makeCanvasMock('data:image/jpeg;base64,VIDEO');
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      const video = makeVideoElement(640, 360);
      const result = captureVideoThumbnail(video);

      expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 300, 169);
      expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.6);
      expect(result).toBe('data:image/jpeg;base64,VIDEO');
    });

    it('respects custom maxWidth parameter', () => {
      const { canvas, ctx } = makeCanvasMock();
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      captureVideoThumbnail(makeVideoElement(640, 480), 200);

      expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 200, 150);
    });

    it('respects custom quality parameter', () => {
      const { canvas } = makeCanvasMock();
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      captureVideoThumbnail(makeVideoElement(640, 360), 300, 0.9);

      expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
    });

    it('uses the full videoWidth when it is smaller than maxWidth', () => {
      const { canvas, ctx } = makeCanvasMock();
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      captureVideoThumbnail(makeVideoElement(100, 80), 300);

      expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 100, 80);
    });

    it('returns empty string when video has zero width', () => {
      const { canvas } = makeCanvasMock();
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      expect(captureVideoThumbnail(makeVideoElement(0, 0))).toBe('');
    });

    it('returns empty string when canvas context is unavailable', () => {
      const canvas = { getContext: vi.fn(() => null), toDataURL: vi.fn(), width: 0, height: 0 };
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      expect(captureVideoThumbnail(makeVideoElement(640, 360))).toBe('');
    });

    it('returns empty string when document.createElement throws', () => {
      document.createElement = () => { throw new Error('canvas not supported'); };

      expect(captureVideoThumbnail(makeVideoElement(640, 360))).toBe('');
    });

    it('falls back to clientWidth/clientHeight when videoWidth/videoHeight are zero', () => {
      const { canvas, ctx } = makeCanvasMock();
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      const video = { videoWidth: 0, videoHeight: 0, clientWidth: 320, clientHeight: 240 } as unknown as HTMLVideoElement;
      captureVideoThumbnail(video, 400);

      expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 240);
    });
  });

  describe('captureImageThumbnail', () => {
    it('returns a data URL when the image has valid dimensions', () => {
      const { canvas, ctx } = makeCanvasMock('data:image/jpeg;base64,IMG');
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      const img = makeImageElement(800, 600);
      const result = captureImageThumbnail(img);

      expect(ctx.drawImage).toHaveBeenCalledWith(img, 0, 0, 300, 225);
      expect(result).toBe('data:image/jpeg;base64,IMG');
    });

    it('respects custom maxWidth', () => {
      const { canvas, ctx } = makeCanvasMock();
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      captureImageThumbnail(makeImageElement(400, 300), 100);

      expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 100, 75);
    });

    it('uses full image width when smaller than maxWidth', () => {
      const { canvas, ctx } = makeCanvasMock();
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      captureImageThumbnail(makeImageElement(50, 50), 300);

      expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 50, 50);
    });

    it('returns empty string when image has zero dimensions', () => {
      const { canvas } = makeCanvasMock();
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      expect(captureImageThumbnail(makeImageElement(0, 0))).toBe('');
    });

    it('returns empty string when canvas context is unavailable', () => {
      const canvas = { getContext: vi.fn(() => null), toDataURL: vi.fn(), width: 0, height: 0 };
      document.createElement = (tag: string) =>
        tag === 'canvas' ? (canvas as unknown as HTMLElement) : originalCreateElement(tag);

      expect(captureImageThumbnail(makeImageElement(100, 100))).toBe('');
    });

    it('returns empty string when document.createElement throws', () => {
      document.createElement = () => { throw new Error('oops'); };

      expect(captureImageThumbnail(makeImageElement(100, 100))).toBe('');
    });
  });

  describe('captureBlobThumbnail', () => {
    it('resolves with a data URL when the blob image loads successfully', async () => {
      const { canvas } = makeCanvasMock('data:image/jpeg;base64,BLOB');
      document.createElement = (tag: string) => {
        if (tag === 'canvas') return canvas as unknown as HTMLElement;
        return originalCreateElement(tag);
      };

      type ImgHandle = { onload: ((e: Event) => void) | null; onerror: ((e: Event) => void) | null; src: string };
      let capturedImg: ImgHandle | null = null;
      const OriginalImage = globalThis.Image;
      globalThis.Image = class {
        onload: ((e: Event) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        src: string = '';
        constructor() { capturedImg = this as unknown as ImgHandle; }
      } as unknown as typeof Image;

      const origCreate = URL.createObjectURL;
      const origRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:fake-url');
      URL.revokeObjectURL = vi.fn();

      const promise = captureBlobThumbnail(new Blob(['fake'], { type: 'image/jpeg' }));
      capturedImg!.onload!(new Event('load'));

      const result = await promise;
      expect(typeof result).toBe('string');

      globalThis.Image = OriginalImage;
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    });

    it('resolves with empty string when the image fails to load', async () => {
      type ImgHandle = { onload: ((e: Event) => void) | null; onerror: ((e: Event) => void) | null; src: string };
      let capturedImg: ImgHandle | null = null;
      const OriginalImage = globalThis.Image;
      globalThis.Image = class {
        onload: ((e: Event) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        src: string = '';
        constructor() { capturedImg = this as unknown as ImgHandle; }
      } as unknown as typeof Image;

      const origCreate = URL.createObjectURL;
      const origRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:fake-error-url');
      URL.revokeObjectURL = vi.fn();

      const promise = captureBlobThumbnail(new Blob(['bad'], { type: 'image/jpeg' }));
      capturedImg!.onerror!(new Event('error'));

      expect(await promise).toBe('');

      globalThis.Image = OriginalImage;
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    });
  });

  describe('getRecentItems', () => {
    it('returns parsed items when storage has data', async () => {
      const items: RecentItem[] = [
        { type: 'video', name: 'test.mp4', path: '/test.mp4', progress: 0.5, lastWatched: 1000 },
      ];
      mockKvGet.mockResolvedValue(JSON.stringify(items));

      const result = await getRecentItems();

      expect(result).toEqual(items);
      expect(mockKvGet).toHaveBeenCalledWith('mlearn_recent_items');
    });

    it('returns empty array when storage is empty', async () => {
      mockKvGet.mockResolvedValue(null);
      expect(await getRecentItems()).toEqual([]);
    });

    it('returns empty array when storage throws', async () => {
      mockKvGet.mockRejectedValue(new Error('storage failure'));
      expect(await getRecentItems()).toEqual([]);
    });
  });

  describe('saveToRecentItems', () => {
    it('adds a new item to an empty list', async () => {
      mockKvGet.mockResolvedValue(null);
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'video', name: 'movie.mp4', path: '/movie.mp4', progress: 0 });

      expect(mockKvSet).toHaveBeenCalledOnce();
      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].name).toBe('movie.mp4');
      expect(saved[0].type).toBe('video');
    });

    it('places the new item at the beginning of the list', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'old.mp4', path: '/old.mp4', progress: 0, lastWatched: 999 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'video', name: 'new.mp4', path: '/new.mp4', progress: 0 });

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].name).toBe('new.mp4');
      expect(saved[1].name).toBe('old.mp4');
    });

    it('replaces an existing item with the same path', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'movie.mp4', path: '/movie.mp4', progress: 0.3, lastWatched: 1000 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'video', name: 'movie.mp4', path: '/movie.mp4', progress: 0.7 });

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved).toHaveLength(1);
      expect(saved[0].progress).toBe(0.7);
    });

    it('preserves the existing thumbnail when none is provided', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1, thumbnail: 'data:old' },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0.2 });

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].thumbnail).toBe('data:old');
    });

    it('uses the provided thumbnail over the existing one', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1, thumbnail: 'data:old' },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0 }, 'data:new');

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].thumbnail).toBe('data:new');
    });

    it('caps the list at 10 items', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify(
        Array.from({ length: 10 }, (_, i) => ({
          type: 'video' as const, name: `file${i}.mp4`, path: `/file${i}.mp4`, progress: 0, lastWatched: i,
        }))
      ));
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'video', name: 'new.mp4', path: '/new.mp4', progress: 0 });

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved).toHaveLength(10);
    });

    it('saves a book type item', async () => {
      mockKvGet.mockResolvedValue(null);
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'book', name: 'book.pdf', path: '/book.pdf', progress: 0 });

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].type).toBe('book');
    });

    it('sets lastWatched to approximately now', async () => {
      mockKvGet.mockResolvedValue(null);
      mockKvSet.mockResolvedValue(undefined);

      const before = Date.now();
      await saveToRecentItems({ type: 'video', name: 'v.mp4', path: '/v.mp4', progress: 0 });
      const after = Date.now();

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].lastWatched).toBeGreaterThanOrEqual(before);
      expect(saved[0].lastWatched).toBeLessThanOrEqual(after);
    });

    it('does not throw when kvSet fails', async () => {
      mockKvGet.mockResolvedValue(null);
      mockKvSet.mockRejectedValue(new Error('write error'));

      await expect(saveToRecentItems({ type: 'video', name: 'v.mp4', path: '/v.mp4', progress: 0 })).resolves.toBeUndefined();
    });

    it('preserves subtitlePath from existing item when not specified in new item', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1, subtitlePath: '/sub.srt' },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0.5 });

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].subtitlePath).toBe('/sub.srt');
    });

    it('preserves playbackTime from existing item when re-saving', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1, playbackTime: 3600 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await saveToRecentItems({ type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0.5 });

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].playbackTime).toBe(3600);
    });
  });

  describe('updateRecentItemThumbnail', () => {
    it('updates the thumbnail of the matching item by name', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemThumbnail('vid.mp4', 'data:thumb');

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].thumbnail).toBe('data:thumb');
    });

    it('does nothing when no item matches the name', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemThumbnail('other.mp4', 'data:thumb');

      expect(mockKvSet).not.toHaveBeenCalled();
    });
  });

  describe('updateRecentItemProgress', () => {
    it('updates the progress of the matching item by name', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemProgress('vid.mp4', 0.75);

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].progress).toBe(0.75);
    });

    it('updates lastWatched when updating progress', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      const before = Date.now();
      await updateRecentItemProgress('vid.mp4', 0.5);
      const after = Date.now();

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].lastWatched).toBeGreaterThanOrEqual(before);
      expect(saved[0].lastWatched).toBeLessThanOrEqual(after);
    });

    it('does nothing when no item matches', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemProgress('missing.mp4', 0.5);

      expect(mockKvSet).not.toHaveBeenCalled();
    });
  });

  describe('updateRecentItemSubtitlePath', () => {
    it('updates the subtitlePath of the matching item by name', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/vid.mp4', progress: 0, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemSubtitlePath('vid.mp4', '/sub.srt');

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].subtitlePath).toBe('/sub.srt');
    });
  });

  describe('updateRecentItemThumbnailByPath', () => {
    it('updates the thumbnail by matching path', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/video/vid.mp4', progress: 0, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemThumbnailByPath('/video/vid.mp4', 'data:new-thumb');

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].thumbnail).toBe('data:new-thumb');
    });

    it('does nothing when path does not match', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/video/vid.mp4', progress: 0, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemThumbnailByPath('/other.mp4', 'data:thumb');

      expect(mockKvSet).not.toHaveBeenCalled();
    });
  });

  describe('updateRecentItemProgressByPath', () => {
    it('updates progress by matching path', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/path/vid.mp4', progress: 0.1, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemProgressByPath('/path/vid.mp4', 0.9);

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].progress).toBe(0.9);
    });
  });

  describe('updateRecentItemSubtitlePathByPath', () => {
    it('updates subtitlePath by matching path', async () => {
      mockKvGet.mockResolvedValue(JSON.stringify([
        { type: 'video', name: 'vid.mp4', path: '/path/vid.mp4', progress: 0, lastWatched: 1 },
      ]));
      mockKvSet.mockResolvedValue(undefined);

      await updateRecentItemSubtitlePathByPath('/path/vid.mp4', '/subs/en.srt');

      const saved = JSON.parse(mockKvSet.mock.calls[0][1] as string) as RecentItem[];
      expect(saved[0].subtitlePath).toBe('/subs/en.srt');
    });
  });
});
