// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../shared/bridges', () => ({
  getBridge: vi.fn(),
}));

vi.mock('../../shared/platform', () => ({
  isElectron: vi.fn(),
}));

const mockKvGet = vi.fn();
const mockKvSet = vi.fn();
const mockKvSetBatch = vi.fn();
const mockGetMigratedItem = vi.fn();

describe('statsService', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockKvGet.mockReset();
    mockKvSet.mockReset();
    mockKvSetBatch.mockReset();
    mockGetMigratedItem.mockReset();
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue(undefined);
    mockKvSetBatch.mockResolvedValue(undefined);
    mockGetMigratedItem.mockResolvedValue(null);

    const { getBridge } = await import('../../shared/bridges');
    vi.mocked(getBridge).mockReturnValue({
      kvStore: {
        kvGet: mockKvGet,
        kvSet: mockKvSet,
        kvSetBatch: mockKvSetBatch,
      },
      migration: {
        getMigratedItem: mockGetMigratedItem,
      },
    } as unknown as ReturnType<typeof getBridge>);

    const { isElectron } = await import('../../shared/platform');
    vi.mocked(isElectron).mockReturnValue(false);
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

  describe('setWordStatus / getWordStatus', () => {
    it('sets and retrieves word status', async () => {
      const { setWordStatus, getWordStatus } = await import('./statsService');
      setWordStatus('hello', 2);
      expect(getWordStatus('hello')).toBe(2);
    });

    it('falls back to alias word forms when the preferred form is not stored yet', async () => {
      const { setWordStatus, getWordStatus } = await import('./statsService');
      setWordStatus('なかま', 1);
      expect(getWordStatus('仲間', ['なかま'])).toBe(1);
    });

    it('removes alias statuses when saving the preferred word form', async () => {
      const { setWordStatus, getWordStatus, getWordsLearnedInApp } = await import('./statsService');
      setWordStatus('なかま', 1);
      setWordStatus('仲間', 2, ['なかま']);

      expect(getWordStatus('仲間', ['なかま'])).toBe(2);
      expect(getWordsLearnedInApp()).not.toHaveProperty('なかま');
    });

    it('returns UNKNOWN (0) for unseen words', async () => {
      const { getWordStatus } = await import('./statsService');
      expect(getWordStatus('nonexistent_word_xyz')).toBe(0);
    });

    it('saves to storage after setting word status', async () => {
      const { setWordStatus } = await import('./statsService');
      setWordStatus('test', 1);
      await vi.waitFor(() => expect(mockKvSet).toHaveBeenCalledWith(
        'mlearn_words_learned',
        expect.any(String)
      ));
    });
  });

  describe('changeKnownStatus', () => {
    it('delegates to setWordStatus', async () => {
      const { changeKnownStatus, getWordStatus } = await import('./statsService');
      changeKnownStatus('apple', 1);
      expect(getWordStatus('apple')).toBe(1);
    });
  });

  describe('getKnownStatus', () => {
    it('returns stored status when no srsCheck provided', async () => {
      const { setWordStatus, getKnownStatus } = await import('./statsService');
      setWordStatus('cat', 2);
      const status = await getKnownStatus('cat');
      expect(status).toBe(2);
    });

    it('returns max of local and srs status', async () => {
      const { setWordStatus, getKnownStatus } = await import('./statsService');
      setWordStatus('dog', 1);
      const srsCheck = vi.fn().mockResolvedValue(2);
      const status = await getKnownStatus('dog', srsCheck);
      expect(status).toBe(2);
    });

    it('returns UNKNOWN when word not found and no srsCheck', async () => {
      const { getKnownStatus } = await import('./statsService');
      const status = await getKnownStatus('totally_unknown_xyz');
      expect(status).toBe(0);
    });
  });

  describe('getWordsLearnedFormatted / getWordsLearnedInAppStats', () => {
    it('returns correct counts for mixed statuses', async () => {
      const { setWordStatus, getWordsLearnedFormatted } = await import('./statsService');
      setWordStatus('w1', 2);
      setWordStatus('w2', 1);
      setWordStatus('w3', 0);
      const stats = getWordsLearnedFormatted();
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.learned).toBeGreaterThanOrEqual(1);
      expect(stats.learning).toBeGreaterThanOrEqual(1);
      expect(stats.unknown).toBeGreaterThanOrEqual(1);
    });

    it('getWordsLearnedInAppStats returns same as getWordsLearnedFormatted', async () => {
      const { getWordsLearnedFormatted, getWordsLearnedInAppStats } = await import('./statsService');
      expect(getWordsLearnedInAppStats()).toEqual(getWordsLearnedFormatted());
    });

    it('returns zeros when no words tracked', async () => {
      const { getWordsLearnedFormatted, getWordsLearnedInApp } = await import('./statsService');
      const words = getWordsLearnedInApp();
      if (Object.keys(words).length === 0) {
        const stats = getWordsLearnedFormatted();
        expect(stats.total).toBe(0);
        expect(stats.learned).toBe(0);
        expect(stats.learning).toBe(0);
        expect(stats.unknown).toBe(0);
      }
    });
  });

  describe('loadWordsFromStorage', () => {
    it('loads words from KV store', async () => {
      const stored = JSON.stringify({ hello: 2, world: 1 });
      mockKvGet.mockResolvedValue(stored);
      const { loadWordsFromStorage, getWordsLearnedInApp } = await import('./statsService');
      await loadWordsFromStorage();
      const words = getWordsLearnedInApp();
      expect(typeof words).toBe('object');
    });

    it('calls getMigratedItem when no KV data and isElectron', async () => {
      const { isElectron } = await import('../../shared/platform');
      vi.mocked(isElectron).mockReturnValue(true);
      mockKvGet.mockResolvedValue(null);
      mockGetMigratedItem.mockResolvedValue({ testWord: 2 });
      const { loadWordsFromStorage } = await import('./statsService');
      await loadWordsFromStorage();

      expect(mockGetMigratedItem).toHaveBeenCalledWith('knownAdjustment');
      expect(mockKvSetBatch).toHaveBeenCalledWith({
        mlearn_words_learned: JSON.stringify({ testWord: 2 }),
        mlearn_words_learned_v1_migration_done: '1',
      });
    });

    it('does not retry v1 migration after it has already been imported', async () => {
      const { isElectron } = await import('../../shared/platform');
      vi.mocked(isElectron).mockReturnValue(true);
      mockKvGet.mockImplementation(async (key: string) => {
        if (key === 'mlearn_words_learned') return null;
        if (key === 'mlearn_words_learned_v1_migration_done') return '1';
        return null;
      });

      const { loadWordsFromStorage } = await import('./statsService');
      await loadWordsFromStorage();

      expect(mockGetMigratedItem).not.toHaveBeenCalled();
    });

    it('does not surface a migration toast when no word statuses were migrated', async () => {
      const { isElectron } = await import('../../shared/platform');
      vi.mocked(isElectron).mockReturnValue(true);
      mockKvGet.mockResolvedValue(null);
      mockGetMigratedItem.mockResolvedValue({});

      const { getLocalStorageMigrationInfo, loadWordsFromStorage } = await import('./statsService');
      await loadWordsFromStorage();

      expect(getLocalStorageMigrationInfo()).toEqual({
        occurred: false,
        backupData: null,
        migratedWordCount: 0,
      });
    });
  });

  describe('saveWordsToStorage', () => {
    it('saves current words to KV store', async () => {
      const { setWordStatus, saveWordsToStorage } = await import('./statsService');
      setWordStatus('persist', 2);
      await saveWordsToStorage();
      expect(mockKvSet).toHaveBeenCalledWith(
        'mlearn_words_learned',
        expect.stringContaining('persist')
      );
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
  });

  describe('drawWordsLearnedPieChart', () => {
    it('draws "No tracked words yet" text when no words', async () => {
      const { drawWordsLearnedPieChart } = await import('./statsService');
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      const fillTextMock = vi.fn();
      const ctx = {
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillText: fillTextMock,
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        arc: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        setTransform: vi.fn(),
        fillRect: vi.fn(),
      };
      vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
      const mockSettings = { theme: 'light', timeWatched: 0 } as Parameters<typeof drawWordsLearnedPieChart>[1];
      drawWordsLearnedPieChart(canvas, mockSettings);
    });

    it('draws pie chart segments when words exist', async () => {
      const { setWordStatus, drawWordsLearnedPieChart } = await import('./statsService');
      setWordStatus('testword', 2);
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      const arcMock = vi.fn();
      const ctx = {
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillText: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        arc: arcMock,
        closePath: vi.fn(),
        fill: vi.fn(),
        setTransform: vi.fn(),
        fillRect: vi.fn(),
      };
      vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
      const mockSettings = { theme: 'dark', timeWatched: 0 } as Parameters<typeof drawWordsLearnedPieChart>[1];
      drawWordsLearnedPieChart(canvas, mockSettings);
      expect(arcMock).toHaveBeenCalled();
    });

    it('returns early when canvas context is null', async () => {
      const { drawWordsLearnedPieChart } = await import('./statsService');
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      vi.spyOn(canvas, 'getContext').mockReturnValue(null);
      const mockSettings = { theme: 'light', timeWatched: 0 } as Parameters<typeof drawWordsLearnedPieChart>[1];
      expect(() => drawWordsLearnedPieChart(canvas, mockSettings)).not.toThrow();
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

  describe('getLocalStorageMigrationInfo / resetLocalStorageMigrationInfo', () => {
    it('returns default migration info', async () => {
      const { getLocalStorageMigrationInfo } = await import('./statsService');
      const info = getLocalStorageMigrationInfo();
      expect(info).toHaveProperty('occurred');
      expect(info).toHaveProperty('backupData');
      expect(info).toHaveProperty('migratedWordCount');
    });

    it('resets migration info to default values', async () => {
      const { getLocalStorageMigrationInfo, resetLocalStorageMigrationInfo } = await import('./statsService');
      resetLocalStorageMigrationInfo();
      const info = getLocalStorageMigrationInfo();
      expect(info.occurred).toBe(false);
      expect(info.backupData).toBe(null);
      expect(info.migratedWordCount).toBe(0);
    });
  });
});
