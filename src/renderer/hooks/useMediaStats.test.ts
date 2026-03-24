import { createRoot } from 'solid-js';
import { useMediaStats } from './useMediaStats';
import type { MediaStats } from '../../shared/types';

let mockSaveMediaStats: ReturnType<typeof vi.fn>;
let mockGetMediaStats: ReturnType<typeof vi.fn>;
let mockOnMediaStats: ReturnType<typeof vi.fn>;
let onMediaStatsCallback: ((stats: MediaStats | null) => void) | null;

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    mediaStats: {
      saveMediaStats: (...args: unknown[]) => mockSaveMediaStats(...args),
      getMediaStats: (...args: unknown[]) => mockGetMediaStats(...args),
      onMediaStats: (cb: (stats: MediaStats | null) => void) => mockOnMediaStats(cb),
    },
  }),
}));

function makeStats(overrides: Partial<MediaStats> = {}): MediaStats {
  return {
    mediaHash: '',
    mediaName: '',
    mediaType: 'video',
    language: 'ja',
    wordsEncountered: {},
    grammarEncountered: {},
    assessedLevel: null,
    sessions: [],
    totalTimeSpent: 0,
    lastAccessed: Date.now(),
    ...overrides,
  };
}

describe('useMediaStats', () => {
  beforeEach(() => {
    onMediaStatsCallback = null;
    mockSaveMediaStats = vi.fn();
    mockGetMediaStats = vi.fn();
    mockOnMediaStats = vi.fn((cb: (stats: MediaStats | null) => void) => {
      onMediaStatsCallback = cb;
      return vi.fn();
    });
  });

  const createHook = (opts = { mediaType: 'video' as const, language: 'ja' }) => {
    return useMediaStats(opts);
  };

  it('starts with empty stats and isActive false', () => {
    createRoot((dispose) => {
      const hook = createHook();
      expect(hook.isActive()).toBe(false);
      expect(hook.stats().mediaHash).toBe('');
      expect(hook.stats().mediaType).toBe('video');
      expect(hook.stats().language).toBe('ja');
      expect(hook.stats().wordsEncountered).toEqual({});
      expect(hook.stats().grammarEncountered).toEqual({});
      expect(hook.stats().sessions).toEqual([]);
      expect(hook.stats().totalTimeSpent).toBe(0);
      expect(hook.stats().assessedLevel).toBeNull();
      dispose();
    });
  });

  it('mediaHash starts empty', () => {
    createRoot((dispose) => {
      const hook = createHook();
      expect(hook.mediaHash()).toBe('');
      dispose();
    });
  });

  it('setMedia activates tracking and sets hash/name', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('my-video.mp4');

      expect(hook.isActive()).toBe(true);
      expect(hook.mediaHash()).not.toBe('');
      expect(hook.stats().mediaName).toBe('my-video.mp4');
      expect(hook.stats().mediaHash).toBe(hook.mediaHash());
      dispose();
    });
  });

  it('setMedia calls bridge.getMediaStats and onMediaStats', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');

      expect(mockGetMediaStats).toHaveBeenCalledWith(hook.mediaHash());
      expect(mockOnMediaStats).toHaveBeenCalledWith(expect.any(Function));
      dispose();
    });
  });

  it('setMedia ignores empty string', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('');
      expect(hook.isActive()).toBe(false);
      expect(mockGetMediaStats).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('setMedia ignores duplicate name', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      mockGetMediaStats.mockClear();
      mockOnMediaStats.mockClear();

      hook.setMedia('video.mp4');
      expect(mockGetMediaStats).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('setMedia to different name saves previous and resets', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video1.mp4');
      hook.recordWord('hello', 2.5);
      const firstHash = hook.mediaHash();

      hook.setMedia('video2.mp4');

      expect(mockSaveMediaStats).toHaveBeenCalled();
      const saveCall = mockSaveMediaStats.mock.calls[0];
      expect(saveCall[0]).toBe(firstHash);

      expect(hook.stats().mediaName).toBe('video2.mp4');
      expect(hook.stats().wordsEncountered).toEqual({});
      expect(hook.mediaHash()).not.toBe(firstHash);
      dispose();
    });
  });

  it('onMediaStats callback populates stats when hash matches', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      const hash = hook.mediaHash();

      const loaded = makeStats({
        mediaHash: hash,
        mediaName: 'video.mp4',
        totalTimeSpent: 5000,
        wordsEncountered: { 'hello': { word: 'hello', ease: 2.5, timesSeen: 3, timesHovered: 1 } },
      });

      onMediaStatsCallback?.(loaded);

      expect(hook.stats().totalTimeSpent).toBe(5000);
      expect(hook.stats().wordsEncountered['hello'].timesSeen).toBe(3);
      dispose();
    });
  });

  it('onMediaStats callback ignores stats with different hash', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');

      const loaded = makeStats({
        mediaHash: 'wrong_hash',
        totalTimeSpent: 9999,
      });

      onMediaStatsCallback?.(loaded);

      expect(hook.stats().totalTimeSpent).toBe(0);
      dispose();
    });
  });

  it('onMediaStats callback handles null gracefully', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      onMediaStatsCallback?.(null);
      expect(hook.stats().totalTimeSpent).toBe(0);
      dispose();
    });
  });

  it('recordWord adds new word entry', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordWord('hello', 2.0);

      const entry = hook.stats().wordsEncountered['hello'];
      expect(entry).toBeDefined();
      expect(entry.word).toBe('hello');
      expect(entry.ease).toBe(2.0);
      expect(entry.timesSeen).toBe(1);
      expect(entry.timesHovered).toBe(0);
      dispose();
    });
  });

  it('recordWord increments timesSeen on existing word', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordWord('hello', 2.5);
      hook.recordWord('hello', 2.0);

      const entry = hook.stats().wordsEncountered['hello'];
      expect(entry.timesSeen).toBe(2);
      expect(entry.ease).toBe(2.0);
      dispose();
    });
  });

  it('recordWord is a no-op when not active', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.recordWord('hello', 2.0);
      expect(hook.stats().wordsEncountered).toEqual({});
      dispose();
    });
  });

  it('recordWordHover adds new word with hover count', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordWordHover('world', 2.0);

      const entry = hook.stats().wordsEncountered['world'];
      expect(entry).toBeDefined();
      expect(entry.timesHovered).toBe(1);
      expect(entry.timesSeen).toBe(0);
      dispose();
    });
  });

  it('recordWordHover increments timesHovered on existing word', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordWordHover('world', 2.5);
      hook.recordWordHover('world', 2.3);

      const entry = hook.stats().wordsEncountered['world'];
      expect(entry.timesHovered).toBe(2);
      expect(entry.ease).toBe(2.3);
      dispose();
    });
  });

  it('recordWordHover is a no-op when not active', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.recordWordHover('hello', 2.0);
      expect(hook.stats().wordsEncountered).toEqual({});
      dispose();
    });
  });

  it('recordGrammar adds new grammar entry', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordGrammar('ている', 2.0);

      const entry = hook.stats().grammarEncountered['ている'];
      expect(entry).toBeDefined();
      expect(entry.pattern).toBe('ている');
      expect(entry.ease).toBe(2.0);
      expect(entry.timesFailed).toBe(0);
      dispose();
    });
  });

  it('recordGrammar updates ease on existing pattern', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordGrammar('ている', 2.5);
      hook.recordGrammar('ている', 1.8);

      const entry = hook.stats().grammarEncountered['ている'];
      expect(entry.ease).toBe(1.8);
      expect(entry.timesFailed).toBe(0);
      dispose();
    });
  });

  it('recordGrammar is a no-op when not active', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.recordGrammar('ている', 2.0);
      expect(hook.stats().grammarEncountered).toEqual({});
      dispose();
    });
  });

  it('recordGrammarFailed increments timesFailed', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordGrammarFailed('ている', 1.5);

      const entry = hook.stats().grammarEncountered['ている'];
      expect(entry.timesFailed).toBe(1);
      expect(entry.ease).toBe(1.5);
      dispose();
    });
  });

  it('recordGrammarFailed accumulates failures', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordGrammarFailed('ている', 2.0);
      hook.recordGrammarFailed('ている', 1.5);

      const entry = hook.stats().grammarEncountered['ている'];
      expect(entry.timesFailed).toBe(2);
      expect(entry.ease).toBe(1.5);
      dispose();
    });
  });

  it('recordGrammarFailed is a no-op when not active', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.recordGrammarFailed('ている', 1.5);
      expect(hook.stats().grammarEncountered).toEqual({});
      dispose();
    });
  });

  it('cacheOcrPage stores tokens for a page number', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('book.pdf');

      const tokens = [{ word: 'hello', actual_word: 'hello', type: 'noun' }];
      hook.cacheOcrPage(1, tokens);

      expect(hook.getCachedOcrPage(1)).toEqual(tokens);
      dispose();
    });
  });

  it('getCachedOcrPage returns null for uncached page', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('book.pdf');
      expect(hook.getCachedOcrPage(99)).toBeNull();
      dispose();
    });
  });

  it('cacheOcrPage is a no-op when not active', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.cacheOcrPage(1, [{ word: 'x', actual_word: 'x', type: 'n' }]);
      expect(hook.getCachedOcrPage(1)).toBeNull();
      dispose();
    });
  });

  it('setAssessedLevel updates stats.assessedLevel', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.setAssessedLevel(3);
      expect(hook.stats().assessedLevel).toBe(3);
      dispose();
    });
  });

  it('setAssessedLevel is a no-op when not active', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setAssessedLevel(3);
      expect(hook.stats().assessedLevel).toBeNull();
      dispose();
    });
  });

  it('saveStats calls bridge with current hash and stats', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      mockSaveMediaStats.mockClear();

      hook.saveStats();

      expect(mockSaveMediaStats).toHaveBeenCalledTimes(1);
      const [hash, savedStats] = mockSaveMediaStats.mock.calls[0];
      expect(hash).toBe(hook.mediaHash());
      expect(savedStats.mediaName).toBe('video.mp4');
      expect(savedStats.lastAccessed).toBeGreaterThan(0);
      dispose();
    });
  });

  it('saveStats is a no-op when no media hash', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.saveStats();
      expect(mockSaveMediaStats).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('respects mediaType book option', () => {
    createRoot((dispose) => {
      const hook = useMediaStats({ mediaType: 'book', language: 'de' });
      expect(hook.stats().mediaType).toBe('book');
      expect(hook.stats().language).toBe('de');
      dispose();
    });
  });

  it('recordWord and recordWordHover can both update the same word entry', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordWord('mixed', 2.5);
      hook.recordWordHover('mixed', 2.0);

      const entry = hook.stats().wordsEncountered['mixed'];
      expect(entry.timesSeen).toBe(1);
      expect(entry.timesHovered).toBe(1);
      expect(entry.ease).toBe(2.0);
      dispose();
    });
  });

  it('new word entries start with default ease of 2.5', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordWord('test', 3.0);

      const entry = hook.stats().wordsEncountered['test'];
      expect(entry.ease).toBe(3.0);
      expect(entry.word).toBe('test');
      dispose();
    });
  });

  it('tracks multiple distinct words', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordWord('hello', 2.5);
      hook.recordWord('world', 2.0);
      hook.recordWord('foo', 1.5);

      expect(Object.keys(hook.stats().wordsEncountered)).toHaveLength(3);
      dispose();
    });
  });

  it('tracks multiple distinct grammar patterns', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('video.mp4');
      hook.recordGrammar('ている', 2.5);
      hook.recordGrammar('ていた', 2.0);

      expect(Object.keys(hook.stats().grammarEncountered)).toHaveLength(2);
      dispose();
    });
  });

  it('produces consistent hash for same media name', () => {
    createRoot((dispose) => {
      const hook1 = createHook();
      hook1.setMedia('test-media.mp4');
      const hash1 = hook1.mediaHash();

      const hook2 = createHook();
      hook2.setMedia('test-media.mp4');
      const hash2 = hook2.mediaHash();

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^mh_[0-9a-f]+$/);
      dispose();
    });
  });

  it('produces different hashes for different media names', () => {
    createRoot((dispose) => {
      const hook1 = createHook();
      hook1.setMedia('video1.mp4');

      const hook2 = createHook();
      hook2.setMedia('video2.mp4');

      expect(hook1.mediaHash()).not.toBe(hook2.mediaHash());
      dispose();
    });
  });
});
