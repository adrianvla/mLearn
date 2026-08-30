// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('statsService', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initTimeWatched', () => {
    it('sets time watched from settings', async () => {
      const { initTimeWatched, getTimeWatchedSeconds } = await import('./statsService');
      initTimeWatched({ timeWatched: 3600 } as Parameters<typeof initTimeWatched>[0]);
      expect(getTimeWatchedSeconds()).toBe(3600);
    });

    it('uses 0 when settings.timeWatched is undefined', async () => {
      const { initTimeWatched, getTimeWatchedSeconds } = await import('./statsService');
      initTimeWatched({ timeWatched: undefined } as unknown as Parameters<typeof initTimeWatched>[0]);
      expect(getTimeWatchedSeconds()).toBe(0);
    });
  });

  describe('startTimeTracking / stopTimeTracking', () => {
    it('increments time when tracking', async () => {
      vi.useFakeTimers();
      const { startTimeTracking, stopTimeTracking, getTimeWatchedSeconds } = await import('./statsService');
      startTimeTracking();
      vi.advanceTimersByTime(3000);
      stopTimeTracking();
      expect(getTimeWatchedSeconds()).toBeGreaterThanOrEqual(3);
    });

    it('does not start tracking if already tracking', async () => {
      vi.useFakeTimers();
      const { startTimeTracking, stopTimeTracking, getTimeWatchedSeconds } = await import('./statsService');
      startTimeTracking();
      const before = getTimeWatchedSeconds();
      startTimeTracking();
      vi.advanceTimersByTime(1000);
      stopTimeTracking();
      expect(getTimeWatchedSeconds()).toBe(before + 1);
    });

    it('does not stop if not tracking', async () => {
      const { stopTimeTracking, getTimeWatchedSeconds } = await import('./statsService');
      const before = getTimeWatchedSeconds();
      stopTimeTracking();
      expect(getTimeWatchedSeconds()).toBe(before);
    });

    it('clears interval on stop', async () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearInterval');
      const { startTimeTracking, stopTimeTracking } = await import('./statsService');
      startTimeTracking();
      stopTimeTracking();
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe('updateTimeWatched', () => {
    it('sets time watched directly', async () => {
      const { updateTimeWatched, getTimeWatchedSeconds } = await import('./statsService');
      updateTimeWatched(999);
      expect(getTimeWatchedSeconds()).toBe(999);
    });
  });

  describe('getTimeWatchedFormatted', () => {
    it('returns hours and minutes format when >= 1 hour', async () => {
      const { updateTimeWatched, getTimeWatchedFormatted } = await import('./statsService');
      updateTimeWatched(7320);
      const t = (key: string, params?: Record<string, string | number>) => {
        if (key === 'mlearn.Global.Time.HoursMinutes') return `${params?.hours}h ${params?.minutes}m`;
        return key;
      };
      expect(getTimeWatchedFormatted(t)).toBe('2h 2m');
    });

    it('returns minute format when < 1 hour', async () => {
      const { updateTimeWatched, getTimeWatchedFormatted } = await import('./statsService');
      updateTimeWatched(300);
      const t = (key: string, params?: Record<string, string | number>) => {
        if (key === 'mlearn.Global.Time.ShortMinute') return `${params?.value}min`;
        return key;
      };
      expect(getTimeWatchedFormatted(t)).toBe('5min');
    });
  });

  describe('toUniqueIdentifier', () => {
    it('returns a 16-char hex string for any word', async () => {
      const { toUniqueIdentifier } = await import('./statsService');
      const id = await toUniqueIdentifier('hello');
      expect(id).toMatch(/^[a-f0-9]{16}$/);
    });

    it('returns different ids for different words', async () => {
      const { toUniqueIdentifier } = await import('./statsService');
      const id1 = await toUniqueIdentifier('hello');
      const id2 = await toUniqueIdentifier('world');
      expect(id1).not.toBe(id2);
    });

    it('returns same id for same word', async () => {
      const { toUniqueIdentifier } = await import('./statsService');
      const id1 = await toUniqueIdentifier('consistent');
      const id2 = await toUniqueIdentifier('consistent');
      expect(id1).toBe(id2);
    });

    it('returns the exact pinned SHA-256 prefix for fixed inputs (drift guard)', async () => {
      const { toUniqueIdentifier } = await import('./statsService');
      expect(await toUniqueIdentifier('hello')).toBe('2cf24dba5fb0a30e');
      expect(await toUniqueIdentifier('日本語')).toBe('77710aedc74ecfa3');
      expect(await toUniqueIdentifier('')).toBe('e3b0c44298fc1c14');
    });
  });

  describe('setupVideoTracking', () => {
    it('returns a cleanup function', async () => {
      const { setupVideoTracking } = await import('./statsService');
      const video = document.createElement('video') as HTMLVideoElement;
      const cleanup = setupVideoTracking(video);
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('starts tracking on play event', async () => {
      vi.useFakeTimers();
      const { setupVideoTracking, getTimeWatchedSeconds } = await import('./statsService');
      const video = document.createElement('video') as HTMLVideoElement;
      const cleanup = setupVideoTracking(video);
      video.dispatchEvent(new Event('play'));
      const before = getTimeWatchedSeconds();
      vi.advanceTimersByTime(2000);
      expect(getTimeWatchedSeconds()).toBeGreaterThanOrEqual(before);
      cleanup();
    });

    it('stops tracking on pause event', async () => {
      vi.useFakeTimers();
      const { setupVideoTracking, getTimeWatchedSeconds } = await import('./statsService');
      const video = document.createElement('video') as HTMLVideoElement;
      const cleanup = setupVideoTracking(video);
      video.dispatchEvent(new Event('play'));
      vi.advanceTimersByTime(1000);
      video.dispatchEvent(new Event('pause'));
      const frozen = getTimeWatchedSeconds();
      vi.advanceTimersByTime(2000);
      expect(getTimeWatchedSeconds()).toBe(frozen);
      cleanup();
    });

    it('stops tracking on ended event', async () => {
      vi.useFakeTimers();
      const { setupVideoTracking, getTimeWatchedSeconds } = await import('./statsService');
      const video = document.createElement('video') as HTMLVideoElement;
      const cleanup = setupVideoTracking(video);
      video.dispatchEvent(new Event('play'));
      vi.advanceTimersByTime(1000);
      video.dispatchEvent(new Event('ended'));
      const frozen = getTimeWatchedSeconds();
      vi.advanceTimersByTime(2000);
      expect(getTimeWatchedSeconds()).toBe(frozen);
      cleanup();
    });

    it('removes event listeners and stops tracking on cleanup', async () => {
      vi.useFakeTimers();
      const { setupVideoTracking, getTimeWatchedSeconds } = await import('./statsService');
      const video = document.createElement('video') as HTMLVideoElement;
      const cleanup = setupVideoTracking(video);
      video.dispatchEvent(new Event('play'));
      cleanup();
      const frozen = getTimeWatchedSeconds();
      vi.advanceTimersByTime(3000);
      expect(getTimeWatchedSeconds()).toBe(frozen);
    });
  });
});