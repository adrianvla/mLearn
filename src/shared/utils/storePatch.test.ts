import { describe, expect, it } from 'vitest';
import {
  applyStorePatch,
  applyStorePatchInPlace,
  copyStoreWithPatch,
  snapshotStorePaths,
  getStorePath,
  setStorePath,
  storePatchRecorder,
  type StorePatch,
} from './storePatch';

const store = () => ({
  flashcards: { a: { id: 'a', reviews: 1 }, b: { id: 'b', reviews: 2 } },
  meta: { perLanguage: { ja: { newCardsToday: 0 } } },
  dailyStats: {},
});

describe('storePatchRecorder', () => {
  it('keeps only the last write to a path', () => {
    const base = store() as unknown as Record<string, unknown>;
    const recorder = storePatchRecorder(base);
    recorder.set(['flashcards', 'a'], { id: 'a', reviews: 2 });
    recorder.set(['flashcards', 'a'], { id: 'a', reviews: 3 });
    const patch = recorder.build(7);
    expect(patch.entries).toHaveLength(1);
    expect(patch.baseRev).toBe(7);
    expect(patch.entries[0].after).toEqual({ id: 'a', reviews: 3 });
  });

  it('captures the pre-image so a concurrent sibling edit can be preserved', () => {
    const base = store() as unknown as Record<string, unknown>;
    const recorder = storePatchRecorder(base);
    recorder.set(['flashcards', 'a'], { id: 'a', reviews: 9 });
    expect(recorder.build(0).entries[0].before).toEqual({ id: 'a', reviews: 1 });
  });

  it('lets a later remove win over an earlier set', () => {
    const base = store() as unknown as Record<string, unknown>;
    const recorder = storePatchRecorder(base);
    recorder.set(['flashcards', 'a'], { id: 'a' });
    recorder.remove(['flashcards', 'a']);
    const entry = recorder.build(0).entries[0];
    expect(entry.after).toBeUndefined();
    expect(entry.before).toEqual({ id: 'a', reviews: 1 });
  });

  it('detaches recorded values from the object that was recorded', () => {
    const base = store() as unknown as Record<string, unknown>;
    const recorder = storePatchRecorder(base);
    const live = { id: 'a', reviews: 1 };
    recorder.set(['flashcards', 'a'], live);
    live.reviews = 99;
    expect(recorder.build(0).entries[0].after).toEqual({ id: 'a', reviews: 1 });
  });

  it('reports emptiness before anything is recorded', () => {
    const recorder = storePatchRecorder(store() as unknown as Record<string, unknown>);
    expect(recorder.isEmpty).toBe(true);
    recorder.set(['meta'], {});
    expect(recorder.isEmpty).toBe(false);
  });
});

describe('applyStorePatch', () => {
  /** Builds a patch that changes `after` at `path` relative to the live base. */
  const patchFor = (path: string[], after: unknown, before: unknown = undefined): StorePatch => ({
    baseRev: 1,
    entries: [{ path: path.split('.'), before, after }],
  });

  it('applies a nested path without touching sibling entries', () => {
    const target = store();
    applyStorePatch(target as unknown as Record<string, unknown>,
      patchFor('flashcards.a', { id: 'a', reviews: 5 }, { id: 'a', reviews: 1 }));
    expect(target.flashcards.a.reviews).toBe(5);
    expect(target.flashcards.b.reviews).toBe(2);
  });

  it('creates intermediate records that do not exist yet', () => {
    const target = store();
    applyStorePatch(target as unknown as Record<string, unknown>,
      patchFor('dailyStats.2026-09-29.ja', { newCardsStudied: 1 }));
    expect(target.dailyStats['2026-09-29']).toEqual({ ja: { newCardsStudied: 1 } });
  });

  it('deletes when the recorded post-image is undefined', () => {
    const target = store();
    applyStorePatch(target as unknown as Record<string, unknown>,
      patchFor('flashcards.b', undefined, { id: 'b', reviews: 2 }));
    expect(target.flashcards.b).toBeUndefined();
    expect(target.flashcards.a).toBeDefined();
  });

  it('never aliases the patched value into the target', () => {
    const target = store();
    const value = { id: 'a', reviews: 1 };
    applyStorePatch(target as unknown as Record<string, unknown>, {
      baseRev: 1,
      entries: [{ path: ['flashcards', 'a'], before: undefined, after: value }],
    });
    value.reviews = 42;
    expect(target.flashcards.a.reviews).toBe(1);
  });

  it('applies a bare entry array as well as a full patch', () => {
    const target = store();
    applyStorePatch(target as unknown as Record<string, unknown>, [
      { path: ['meta', 'perLanguage', 'ja'], before: { newCardsToday: 0 }, after: { newCardsToday: 3 } },
    ]);
    expect(target.meta.perLanguage.ja.newCardsToday).toBe(3);
  });

  it('applies entries in order so a later entry wins', () => {
    const target = store();
    applyStorePatch(target as unknown as Record<string, unknown>, [
      { path: ['flashcards', 'a'], before: { reviews: 1 }, after: { reviews: 2 } },
      { path: ['flashcards', 'a'], before: { reviews: 2 }, after: { reviews: 3 } },
    ]);
    expect(target.flashcards.a.reviews).toBe(3);
  });
});

describe('applyStorePatch concurrent-edit preservation', () => {
  it('keeps a sibling field another writer changed while the patch was in flight', () => {
    const base = { meta: { maxReviewsPerDay: -1, perLanguage: { ja: { newCardsToday: 0 } } } };
    // The command's pre-image: it only advanced the per-language counter.
    const before = { maxReviewsPerDay: -1, perLanguage: { ja: { newCardsToday: 0 } } };
    const after = { maxReviewsPerDay: -1, perLanguage: { ja: { newCardsToday: 1 } } };
    // Meanwhile another writer set maxReviewsPerDay on the live store.
    const target = { meta: { maxReviewsPerDay: 37, perLanguage: { ja: { newCardsToday: 0 } } } };

    applyStorePatch(target as unknown as Record<string, unknown>, {
      baseRev: 1,
      entries: [{ path: ['meta'], before, after }],
    });

    expect(target.meta.maxReviewsPerDay).toBe(37);
    expect(target.meta.perLanguage.ja.newCardsToday).toBe(1);
  });

  it('merges a deeply nested sibling rather than replacing the whole entry', () => {
    const target: any = { dailyStats: { today: { ja: { newCardsStudied: 0, timeSpent: 500 } } } };
    applyStorePatch(target as unknown as Record<string, unknown>, {
      baseRev: 1,
      entries: [{
        path: ['dailyStats'],
        before: { today: { ja: { newCardsStudied: 0, timeSpent: 0 } } },
        after: { today: { ja: { newCardsStudied: 1, timeSpent: 0 } } },
      }],
    });
    // The command incremented newCardsStudied; timeSpent was set concurrently.
    expect(target.dailyStats.today.ja.newCardsStudied).toBe(1);
    expect(target.dailyStats.today.ja.timeSpent).toBe(500);
  });

  it('applies the post-image for a field the command did change', () => {
    const target: any = { flashcards: { a: { id: 'a', reviews: 1, interval: 10 } } };
    applyStorePatch(target as unknown as Record<string, unknown>, {
      baseRev: 1,
      entries: [{
        path: ['flashcards', 'a'],
        before: { id: 'a', reviews: 1, interval: 10 },
        after: { id: 'a', reviews: 2, interval: 86400000 },
      }],
    });
    expect(target.flashcards.a.reviews).toBe(2);
    expect(target.flashcards.a.interval).toBe(86400000);
  });
});

describe('getStorePath / setStorePath', () => {
  it('reads a nested value', () => {
    expect(getStorePath(store() as unknown as Record<string, unknown>, ['flashcards', 'a', 'reviews'])).toBe(1);
  });

  it('returns undefined for a path through a non-record', () => {
    expect(getStorePath(store() as unknown as Record<string, unknown>, ['flashcards', 'a', 'reviews', 'x'])).toBeUndefined();
  });

  it('writes a nested value in place', () => {
    const target = store();
    setStorePath(target as unknown as Record<string, unknown>, ['meta', 'perLanguage', 'ja'], { newCardsToday: 9 });
    expect(target.meta.perLanguage.ja.newCardsToday).toBe(9);
  });
});

describe('patch equivalence with a structural diff', () => {
  const isRec = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  /** The diff-based apply this module replaced, kept as the oracle. */
  const applyStoreDelta = (target: Record<string, unknown>, base: Record<string, unknown>, next: Record<string, unknown>): void => {
    for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
      const before = base[key];
      const after = next[key];
      if (Object.is(before, after)) continue;
      if (!(key in next)) {
        delete target[key];
      } else if (isRec(before) && isRec(after)) {
        if (!isRec(target[key])) target[key] = {};
        applyStoreDelta(target[key] as Record<string, unknown>, before, after);
      } else {
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        target[key] = after === undefined ? undefined : JSON.parse(JSON.stringify(after)) as unknown;
      }
    }
  };

  /** A store big enough that a whole-collection walk would be obvious. */
  const bigStore = () => {
    const base: Record<string, unknown> = { flashcards: {}, wordKnowledge: {}, wordStatsMap: {}, meta: { perLanguage: {} }, dailyStats: {} };
    const flashcards = base.flashcards as Record<string, unknown>;
    const wordKnowledge = base.wordKnowledge as Record<string, unknown>;
    const wordStatsMap = base.wordStatsMap as Record<string, unknown>;
    for (let index = 0; index < 200; index++) {
      flashcards[`c${index}`] = { id: `c${index}`, reviews: index % 7, content: { type: 'word', front: `w${index}`, back: `b${index}` } };
      wordKnowledge[`ja:k${index}`] = { word: `w${index}`, ease: 1.3, access: {} };
      wordStatsMap[`ja:k${index}`] = { reviews: index % 7 };
    }
    return base;
  };

  it('yields the same post-image as diffing a mutated clone onto the live store', () => {
    const base = bigStore();

    const oracleCandidate = clone(base) as any;
    oracleCandidate.flashcards.c5 = { ...oracleCandidate.flashcards.c5, reviews: 6, lastReviewed: 111 };
    oracleCandidate.wordKnowledge['ja:k5'].ease = 2.5;
    oracleCandidate.wordKnowledge['ja:k5'].access = { 'sense-recognition': { status: 'known' } };
    oracleCandidate.wordStatsMap['ja:k5'] = { reviews: 6 };
    oracleCandidate.meta.perLanguage.ja = { newCardsToday: 1, reviewsToday: 2, newCardsDate: '2026-09-29' };
    oracleCandidate.dailyStats['2026-09-29'] = { ja: { date: '2026-09-29', newCardsStudied: 1, reviewCardsStudied: 0, lapses: 0, timeSpent: 500, graduated: 0 } };
    const oracleResult = clone(base);
    applyStoreDelta(oracleResult as any, base, oracleCandidate);

    const recorder = storePatchRecorder(base);
    const candidate = clone(base) as any;
    candidate.flashcards.c5 = { ...candidate.flashcards.c5, reviews: 6, lastReviewed: 111 };
    recorder.set(['flashcards', 'c5'], candidate.flashcards.c5);
    candidate.wordKnowledge['ja:k5'].ease = 2.5;
    candidate.wordKnowledge['ja:k5'].access = { 'sense-recognition': { status: 'known' } };
    recorder.set(['wordKnowledge', 'ja:k5'], candidate.wordKnowledge['ja:k5']);
    candidate.wordStatsMap['ja:k5'] = { reviews: 6 };
    recorder.set(['wordStatsMap', 'ja:k5'], candidate.wordStatsMap['ja:k5']);
    candidate.meta.perLanguage.ja = { newCardsToday: 1, reviewsToday: 2, newCardsDate: '2026-09-29' };
    recorder.set(['meta'], candidate.meta);
    candidate.dailyStats['2026-09-29'] = { ja: { date: '2026-09-29', newCardsStudied: 1, reviewCardsStudied: 0, lapses: 0, timeSpent: 500, graduated: 0 } };
    recorder.set(['dailyStats'], candidate.dailyStats);

    const patched = clone(base);
    applyStorePatch(patched as any, recorder.build(0));

    expect(patched).toEqual(oracleResult);
  });
});


describe('private patch snapshots', () => {
  it('preserves existing entry identities while matching the canonical merge and keeping concurrent fields', () => {
    const source = { entries: { a: { count: 1, concurrent: 99, nested: { changed: 1, retained: 'original' }, removed: 1 } } };
    const before = { count: 1, concurrent: 2, nested: { changed: 1, retained: 'original' }, removed: 1 };
    const after = { count: 2, concurrent: 2, nested: { changed: 2, retained: 'original' }, added: ['arbitrary', { value: 1 }] };
    const patch = { baseRev: 0, entries: [{ path: ['entries', 'a'], before, after }] };
    const oracle = structuredClone(source);
    applyStorePatch(oracle, patch);
    const entry = source.entries.a;
    const nested = entry.nested;
    applyStorePatchInPlace(source, patch);
    expect(source).toEqual(oracle);
    expect(source.entries.a).toBe(entry);
    expect(entry.nested).toBe(nested);
    expect(entry.concurrent).toBe(99);
    after.added.push('changed source');
    expect(source).toEqual(oracle);
  });
  it('copies only declared paths and detaches structured unknown values', () => {
    const source = { wordKnowledge: { a: { access: { 'third-party:unfamiliar': { values: [1, { mode: 'contextual' }] } } }, b: { word: 'untouched' } } };
    const snapshot = snapshotStorePaths(source, [['wordKnowledge', 'a']]);
    expect(snapshot).toEqual({ wordKnowledge: { a: source.wordKnowledge.a } });
    source.wordKnowledge.a.access['third-party:unfamiliar'].values.push(2);
    expect(snapshot).not.toEqual({ wordKnowledge: { a: source.wordKnowledge.a } });
  });

  it('copies touched ancestors once and leaves the previous snapshot untouched', () => {
    const source = { flashcards: { a: { reviews: 1 }, b: { reviews: 2 } }, meta: { perLanguage: { x: { reviewsToday: 0 } }, limit: 20 }, untouched: { nested: [1, 2] } };
    const original = structuredClone(source);
    const result = copyStoreWithPatch(source, { baseRev: 0, entries: [
      { path: ['flashcards', 'a'], before: { reviews: 1 }, after: { reviews: 2 } },
      { path: ['meta', 'perLanguage', 'x'], before: { reviewsToday: 0 }, after: { reviewsToday: 1 } },
      { path: ['flashcards', 'b'], before: { reviews: 2 }, after: { reviews: 3 } },
    ] });
    expect(source).toEqual(original);
    expect(result.flashcards.a.reviews).toBe(2);
    expect(result.flashcards.b.reviews).toBe(3);
    expect(result.meta.perLanguage.x.reviewsToday).toBe(1);
    expect(result.meta.limit).toBe(20);
    expect(result.untouched).toBe(source.untouched);
  });

  it('matches the mutable merge for additions, removals, and repeated nested paths', () => {
    const source = { nested: { a: { counter: 1, concurrent: 99 }, b: [1, 2] } };
    const patch: StorePatch = { baseRev: 0, entries: [
      { path: ['nested', 'a'], before: { counter: 1, concurrent: 2 }, after: { counter: 3, concurrent: 2 } },
      { path: ['nested', 'b'], before: [1, 2], after: undefined },
      { path: ['nested', 'new', 'leaf'], before: undefined, after: { value: [1, 2] } },
    ] };
    const mutable = structuredClone(source);
    applyStorePatch(mutable, patch);
    expect(copyStoreWithPatch(source, patch)).toEqual(mutable);
    expect(source.nested.a.counter).toBe(1);
    expect(source.nested.b).toEqual([1, 2]);
  });
});
