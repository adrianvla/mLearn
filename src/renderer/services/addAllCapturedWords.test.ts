// @vitest-environment happy-dom

/**
 * "Add All" was twenty duplicated lines in three surfaces, and the copies had
 * already drifted once: the video and overlay copies reported nothing on
 * failure, so their batch branch was dead code. These tests pin the five parts
 * of the behaviour so a fourth surface cannot re-decide them, and so the drift
 * cannot come back through a renamed predicate.
 *
 * The failure test is not hypothetical. Breaking `crypto.subtle.digest`, which
 * `SRS.hashWord` awaits inside `addFlashcard`, made every capture in a real
 * 35-word reader Add All reject at once; the store stayed at its original 450
 * cards and exactly one batch toast appeared, naming 35. That is the shape
 * asserted below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addAllCapturedWords } from './addAllCapturedWords';

const toasts: { message: string; variant?: string }[] = [];

vi.mock('../components/common/Feedback/Toast', () => ({
  showToast: (options: { message: string; variant?: string }) => {
    toasts.push(options);
    return toasts.length;
  },
}));

/** Echo the params back so a test can assert what the message was built from. */
const t = (path: string, params?: Record<string, string | number>) =>
  params ? `${path} ${JSON.stringify(params)}` : path;

interface WordEntry {
  word: string;
}

/** In-flight state, so a test can assert the mark is set and cleared. */
function inFlight() {
  let value = false;
  return {
    is: () => value,
    set: (next: boolean) => {
      value = next;
    },
    /** Whether the mark is currently held, read at a chosen moment. */
    get held() {
      return value;
    },
  };
}

beforeEach(() => {
  toasts.length = 0;
});

describe('a successful Add All', () => {
  it('captures every eligible entry and announces nothing', async () => {
    const entries: WordEntry[] = [{ word: '猫' }, { word: '犬' }];
    const addFlashcard = vi.fn(async () => {});
    const state = inFlight();

    await addAllCapturedWords({
      entries,
      addFlashcard,
      isEligible: () => true,
      isInFlight: state.is,
      setInFlight: state.set,
      translate: t,
    });

    expect(addFlashcard.mock.calls).toEqual([[entries[0]], [entries[1]]]);
    expect(toasts).toHaveLength(0);
  });

  it('marks the run in flight while it runs, and clears it afterwards', async () => {
    const state = inFlight();
    let heldDuringRun = false;

    await addAllCapturedWords({
      entries: [{ word: '猫' }],
      addFlashcard: async () => {
        heldDuringRun = state.held;
      },
      isInFlight: state.is,
      setInFlight: state.set,
      translate: t,
    });

    expect(heldDuringRun).toBe(true);
    expect(state.held).toBe(false);
  });
});

describe('a partly failed Add All', () => {
  it('keeps going after a failure and reports the batch once', async () => {
    // The verified runtime shape: every capture throws, so the whole batch
    // fails, the store is untouched, and one toast names the count.
    const failure = new Error('probe: hashing backend unavailable');
    const entries: WordEntry[] = [{ word: '猫' }, { word: '犬' }, { word: '鳥' }];
    const addFlashcard = vi.fn(async () => {
      throw failure;
    });
    const logged: { word?: string; error: unknown }[] = [];

    await addAllCapturedWords({
      entries,
      addFlashcard,
      isEligible: () => true,
      isInFlight: () => false,
      setInFlight: () => {},
      translate: t,
      logEntryError: (entry, error) => logged.push({ word: entry.word, error }),
    });

    // Every entry was attempted; one failing did not abandon the rest.
    expect(addFlashcard).toHaveBeenCalledTimes(3);
    // One toast for the batch, naming the count and the cause, not one per word.
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain('"count":3');
    expect(toasts[0].message).toContain('probe: hashing backend unavailable');
    expect(toasts[0].variant).toBe('error');
    // The log is where the individual words stay recoverable.
    expect(logged.map((l) => l.word)).toEqual(['猫', '犬', '鳥']);
  });

  it('describes the first failure when the causes differ', async () => {
    const entries: WordEntry[] = [{ word: '猫' }, { word: '犬' }];
    await addAllCapturedWords({
      entries,
      addFlashcard: async (entry) => {
        throw new Error(entry.word === '猫' ? 'first cause' : 'second cause');
      },
      isEligible: () => true,
      isInFlight: () => false,
      setInFlight: () => {},
      translate: t,
      logEntryError: () => {},
    });

    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain('first cause');
    expect(toasts[0].message).not.toContain('second cause');
  });

  it('clears the in-flight mark when the run is aborted from outside the capture', async () => {
    // `bulkAddWords` cannot throw: it catches every per-entry rejection and
    // routes it to `onEntryError`. Its one unprotected call is the `skip`
    // predicate, which sits outside that try. So a store read that throws
    // while eligibility is being re-checked unwinds the whole run, abandoning
    // the entries after it - and a sidebar left holding the in-flight mark can
    // never be re-entered, because the mark is what refuses a second run.
    const state = inFlight();
    const entries: WordEntry[] = [{ word: '猫' }, { word: '犬' }];
    const addFlashcard = vi.fn(async () => {});
    const boom = new Error('store unavailable while re-checking eligibility');

    await expect(
      addAllCapturedWords({
        entries,
        addFlashcard,
        isEligible: (entry) => {
          if (entry.word === '犬') throw boom;
          return true;
        },
        isInFlight: state.is,
        setInFlight: state.set,
        translate: t,
        logEntryError: () => {},
      }),
    ).rejects.toBe(boom);

    // Only the entry before the failure was attempted, and the mark is clear
    // so the learner can try the batch again.
    expect(addFlashcard.mock.calls).toEqual([[entries[0]]]);
    expect(state.held).toBe(false);
  });
});

describe('entries that may no longer become cards', () => {
  it('skips an entry that became a card after the list was built', async () => {
    const entries: WordEntry[] = [{ word: '猫' }, { word: '犬' }];
    const addFlashcard = vi.fn(async () => {});
    const eligible = new Set(['猫']);

    await addAllCapturedWords({
      entries,
      addFlashcard,
      // Re-checked per entry, so a word that changed mid-run is still caught.
      isEligible: (entry) => eligible.has(entry.word),
      isInFlight: () => false,
      setInFlight: () => {},
      translate: t,
    });

    expect(addFlashcard.mock.calls).toEqual([[entries[0]]]);
  });

  it('captures everything when the caller supplies no rule of its own', async () => {
    const entries: WordEntry[] = [{ word: '猫' }, { word: '犬' }];
    const addFlashcard = vi.fn(async () => {});

    await addAllCapturedWords({
      entries,
      addFlashcard,
      isInFlight: () => false,
      setInFlight: () => {},
      translate: t,
    });

    expect(addFlashcard).toHaveBeenCalledTimes(2);
  });
});

describe('a run that must not happen', () => {
  it('refuses to re-enter while a run is in flight', async () => {
    const state = inFlight();
    state.set(true);
    const addFlashcard = vi.fn(async () => {});

    await addAllCapturedWords({
      entries: [{ word: '猫' }],
      addFlashcard,
      isInFlight: state.is,
      setInFlight: state.set,
      translate: t,
    });

    expect(addFlashcard).not.toHaveBeenCalled();
    // The refused run must not clear the mark belonging to the live one.
    expect(state.held).toBe(true);
  });

  it('refuses an empty run without marking anything', async () => {
    const state = inFlight();
    const addFlashcard = vi.fn(async () => {});

    await addAllCapturedWords({
      entries: [],
      addFlashcard,
      isInFlight: state.is,
      setInFlight: state.set,
      translate: t,
    });

    expect(addFlashcard).not.toHaveBeenCalled();
    expect(state.held).toBe(false);
  });
});
