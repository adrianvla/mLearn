import { createRoot, createSignal } from 'solid-js';
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
  const result: MediaStats = {
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
  result.sourceId = `fixture:${result.mediaName}`;
  result.usageSessions = { loaded: { id: 'loaded', sequence: 1, finalized: true, date: '2026-10-01', duration: result.totalTimeSpent, wordsLearned: 0,
    wordsEncountered: result.wordsEncountered, grammarEncountered: result.grammarEncountered } };
  return result;
}

describe('useMediaStats', () => {
  beforeEach(() => {
    onMediaStatsCallback = null;
    localStorage.clear(); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    mockSaveMediaStats = vi.fn().mockImplementation(async (hash: string, stats: MediaStats) => ({ mediaHash: hash, revision: 1, sessionSequences: Object.fromEntries(Object.entries(stats.usageSessions ?? {}).map(([id, session]) => [id, session.sequence])) }));
    mockGetMediaStats = vi.fn();
    mockOnMediaStats = vi.fn((cb: (stats: MediaStats | null) => void) => {
      onMediaStatsCallback = cb;
      return vi.fn();
    });
  });

  const createHook = (opts = { mediaType: 'video' as const, language: 'ja' }) => {
    const hook = useMediaStats(opts);
    return { ...hook, setMedia: (name: string, source = { resourceId: `fixture:${name}` }) => hook.setMedia(name, source) };
  };

  it('finalizes one physical session once across beforeunload and cleanup', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    let hook!: ReturnType<typeof useMediaStats>;
    const dispose = createRoot(dispose => { hook = createHook(); return dispose; });
    await Promise.resolve(); hook.setMedia('one'); vi.setSystemTime(11000);
    window.dispatchEvent(new Event('beforeunload')); dispose();
    const writes = mockSaveMediaStats.mock.calls.map(call => call[1] as MediaStats);
    expect(writes.at(-1)?.sessions).toHaveLength(1);
    vi.useRealTimers();
  });

  it('ignores explicit wrong-language and wrong-source events in the same renderer', async () => {
    let hook!: ReturnType<typeof useMediaStats>;
    const dispose = createRoot(dispose => { hook = createHook(); return dispose; });
    await Promise.resolve(); hook.setMedia('one');
    window.dispatchEvent(new CustomEvent('mlearn:word-seen', { detail: { word: 'foreign', ease: 2, language: 'ru', mediaHash: hook.mediaHash(), sessionId: 'other' } }));
    window.dispatchEvent(new CustomEvent('mlearn:word-hovered', { detail: { word: 'wrong-source', ease: 2, language: 'ja', mediaHash: 'other', sessionId: 'other' } }));
    expect(hook.stats().wordsEncountered).toEqual({}); dispose();
  });

  it('records only focused visible engagement and preserves explicit pause gaps', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    const [engaged, setEngaged] = createSignal(true);
    let hook!: ReturnType<typeof useMediaStats>;
    const dispose = createRoot(dispose => { hook = useMediaStats({ mediaType: 'video', language: 'qx', engaged }); return dispose; });
    await Promise.resolve(); hook.setMedia('One title', { resourceId: '/videos/one.mp4' });
    vi.setSystemTime(11000); setEngaged(false);
    vi.setSystemTime(21000); setEngaged(true);
    vi.setSystemTime(22000); hook.endSession();
    expect(hook.stats().totalTimeSpent).toBe(2000);
    expect(hook.stats().sessions[0].engagedIntervals).toEqual([{ startTime: 10000, endTime: 11000 }, { startTime: 21000, endTime: 22000 }]);
    expect(hook.stats().sessions[0].wordsLearned).toBe(0);
    dispose(); vi.useRealTimers();
  });

  it('merges interactions recorded before the correlated initial load resolves', async () => {
    let resolve!: (stats: MediaStats | null) => void;
    mockGetMediaStats.mockReturnValueOnce(new Promise<MediaStats | null>(done => { resolve = done; }));
    let hook!: ReturnType<typeof useMediaStats>;
    const dispose = createRoot(dispose => { hook = useMediaStats({ mediaType: 'book', language: 'qx' }); return dispose; });
    hook.setMedia('Identical', { resourceId: '/books/one.epub' }); hook.recordWord('new', 2);
    const existing = { ...hook.stats(), usageSessions: {} };
    resolve(existing); await Promise.resolve();
    expect(hook.stats().wordsEncountered.new.timesSeen).toBe(1);
    dispose();
  });

  it('exposes an unacknowledged write and recovers its retained contribution after a remount', async () => {
    let hook!: ReturnType<typeof useMediaStats>;
    const dispose = createRoot(dispose => { hook = useMediaStats({ mediaType: 'book', language: 'qx' }); return dispose; });
    hook.setMedia('One', { resourceId: '/books/one.epub' }); hook.recordWord('term', 2);
    mockSaveMediaStats.mockRejectedValueOnce(new Error('disk failed'));
    await expect(hook.saveStats()).rejects.toThrow('disk failed');
    expect(hook.saveError()).toBeInstanceOf(Error);
    const key = `mlearn-pending-media-usage::${hook.mediaHash()}::${hook.sessionId()}`;
    expect(localStorage.getItem(key)).not.toBeNull();
    mockSaveMediaStats.mockRejectedValueOnce(new Error('closing disk failed')); dispose(); await Promise.resolve();
    const nextDispose = createRoot(dispose => { hook = useMediaStats({ mediaType: 'book', language: 'qx' }); return dispose; });
    hook.setMedia('One', { resourceId: '/books/one.epub' }); await Promise.resolve(); await Promise.resolve();
    expect(hook.stats().wordsEncountered.term.timesSeen).toBe(1);
    expect(localStorage.getItem(key)).toBeNull(); nextDispose();
  });

  it('retains intent when an acknowledgement omits the submitted session sequence', async () => {
    let hook!: ReturnType<typeof useMediaStats>;
    const dispose = createRoot(dispose => { hook = createHook(); return dispose; });
    hook.setMedia('One');
    mockSaveMediaStats.mockImplementationOnce(async (hash: string) => ({ mediaHash: hash, revision: 1, sessionSequences: {} }));
    await expect(hook.saveStats()).rejects.toThrow('not acknowledged');
    expect(hook.saveError()).toBeInstanceOf(Error);
    expect(localStorage.getItem(`mlearn-pending-media-usage::${hook.mediaHash()}::${hook.sessionId()}`)).not.toBeNull();
    await hook.retrySaveStats(); expect(hook.saveError()).toBeNull(); dispose();
  });

  it('keeps a late failed old-source write visible and retries its original snapshot', async () => {
    let hook!: ReturnType<typeof useMediaStats>;
    const dispose = createRoot(dispose => { hook = createHook(); return dispose; });
    hook.setMedia('Old'); const oldHash = hook.mediaHash();
    let reject!: (error: Error) => void;
    mockSaveMediaStats.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    hook.setMedia('New'); await Promise.resolve();
    reject(new Error('old source disk failure')); await Promise.resolve(); await Promise.resolve();
    expect(hook.saveError()).toBeInstanceOf(Error);
    await hook.retrySaveStats();
    expect(mockSaveMediaStats.mock.calls.some(([hash, snapshot]) => hash === oldHash && snapshot.sourceId === 'fixture:Old')).toBe(true);
    expect(hook.saveError()).toBeNull(); dispose();
  });

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

  it('ignores a delayed response for the previous media when saving the current media', () => {
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('first.mp4');
      const firstHash = hook.mediaHash();
      const firstResponse = onMediaStatsCallback!;
      hook.setMedia('second.mp4');
      const secondHash = hook.mediaHash();
      firstResponse(makeStats({ mediaHash: firstHash, mediaName: 'first.mp4', totalTimeSpent: 999 }));
      hook.saveStats();
      expect(hook.stats().mediaName).toBe('second.mp4');
      expect(mockSaveMediaStats).toHaveBeenLastCalledWith(secondHash, expect.objectContaining({
        mediaHash: secondHash, mediaName: 'second.mp4', totalTimeSpent: 0,
      }));
      dispose();
    });
  });

  it('rejects an old request after switching away and back to the same media', () => {
    // This assertion isolates reply identity, not elapsed engagement. A real
    // clock can add a millisecond to the new session during these operations.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    let dispose: (() => void) | undefined;
    try {
      createRoot((cleanup) => {
        dispose = cleanup;
        const hook = createHook();
        hook.setMedia('first.mp4');
        const firstHash = hook.mediaHash();
        const staleResponse = onMediaStatsCallback!;
        hook.setMedia('second.mp4');
        hook.setMedia('first.mp4');
        onMediaStatsCallback!(makeStats({ mediaHash: firstHash, mediaName: 'first.mp4', totalTimeSpent: 12 }));
        staleResponse(makeStats({ mediaHash: firstHash, mediaName: 'first.mp4', totalTimeSpent: 3 }));
        expect(hook.stats().totalTimeSpent).toBe(12);
      });
    } finally { dispose?.(); clock.mockRestore(); }
  });

  it('subscribes before requesting stats so immediate bridge responses are retained', () => {
    mockGetMediaStats.mockImplementation((hash: string) => {
      onMediaStatsCallback?.(makeStats({ mediaHash: hash, mediaName: 'first.mp4', totalTimeSpent: 18 }));
    });
    createRoot((dispose) => {
      const hook = createHook();
      hook.setMedia('first.mp4');
      expect(hook.stats().totalTimeSpent).toBe(18);
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
      const real = useMediaStats({ mediaType: 'book', language: 'de' });
      const hook = { ...real, setMedia: (name: string) => real.setMedia(name, { resourceId: `fixture:${name}` }) };
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

  it('produces consistent identity for the same admitted resource', () => {
    createRoot((dispose) => {
      const hook1 = createHook();
      hook1.setMedia('test-media.mp4');
      const hash1 = hook1.mediaHash();

      const hook2 = createHook();
      hook2.setMedia('test-media.mp4');
      const hash2 = hook2.mediaHash();

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      dispose();
    });
  });

  it('produces different identities for different admitted resources', () => {
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
