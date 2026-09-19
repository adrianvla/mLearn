import { describe, expect, it } from 'vitest';
import { createEncounterTimer, STALL_INTERRUPT_MS, type EncounterTimer, type EncounterTimerOptions } from './encounterTiming';
import { attemptActiveLatencyMs, type KnowledgeEvent } from './knowledgeEvents';

/** Minimal event-target harness: registered handlers keyed by event name. */
type Handlers = Map<string, (event?: unknown) => void>;

function makeHarness() {
  const winHandlers: Handlers = new Map();
  const docHandlers: Handlers = new Map();
  const win = {
    addEventListener: (type: string, handler: (event?: unknown) => void) => winHandlers.set(type, handler),
    removeEventListener: (type: string) => winHandlers.delete(type),
  };
  const doc = {
    addEventListener: (type: string, handler: (event?: unknown) => void) => docHandlers.set(type, handler),
    removeEventListener: (type: string) => docHandlers.delete(type),
    hidden: false,
    visibilityState: 'visible',
    hasFocus: () => true,
  };
  return { win, doc, winHandlers, docHandlers };
}

function makeOptions(clock: { now: number }, harness: ReturnType<typeof makeHarness>): EncounterTimerOptions {
  return {
    now: () => clock.now,
    win: harness.win,
    doc: harness.doc as unknown as Document,
  };
}

function blur(harness: ReturnType<typeof makeHarness>): void {
  harness.winHandlers.get('blur')?.();
}

function focus(harness: ReturnType<typeof makeHarness>): void {
  harness.winHandlers.get('focus')?.();
}

function hide(harness: ReturnType<typeof makeHarness>): void {
  harness.doc.hidden = true;
  harness.docHandlers.get('visibilitychange')?.();
}

function show(harness: ReturnType<typeof makeHarness>): void {
  harness.doc.hidden = false;
  harness.docHandlers.get('visibilitychange')?.();
}

function engage(harness: ReturnType<typeof makeHarness>): void {
  harness.winHandlers.get('pointerdown')?.();
}

describe('createEncounterTimer', () => {
  it('ordinary uninterrupted attempts behave like wall-clock latency', () => {
    const clock = { now: 1_000 };
    const harness = makeHarness();
    const timer = createEncounterTimer(makeOptions(clock, harness));
    timer.start();
    clock.now = 5_400;
    const timing = timer.stop();
    expect(timing).toEqual({ activeLatencyMs: 4_400, wallLatencyMs: 4_400, interruptionCount: 0, interrupted: false, stalled: false });
  });

  it('blur for minutes during a card does not produce minute-long retrieval latency', () => {
    const clock = { now: 1_000 };
    const harness = makeHarness();
    const timer = createEncounterTimer(makeOptions(clock, harness));
    timer.start();
    clock.now = 4_000;
    blur(harness);
    clock.now = 4_000 + 180_000; // learner away for 3 minutes
    focus(harness);
    clock.now = 4_000 + 180_000 + 1_500; // refocus, answers shortly after
    const timing = timer.stop();
    expect(timing).toMatchObject({ activeLatencyMs: 4_500, interruptionCount: 1, interrupted: true, stalled: false });
    expect(timing!.wallLatencyMs).toBeGreaterThan(180_000);
  });

  it('visibility hidden pauses and visible resumes exactly like blur', () => {
    const clock = { now: 0 };
    const harness = makeHarness();
    const timer = createEncounterTimer(makeOptions(clock, harness));
    timer.start();
    clock.now = 2_000;
    hide(harness);
    clock.now = 62_000;
    show(harness);
    clock.now = 63_000;
    expect(timer.stop()).toMatchObject({ activeLatencyMs: 3_000, interruptionCount: 1 });
  });

  it('simultaneous blur and hidden count as one interruption', () => {
    const clock = { now: 0 };
    const harness = makeHarness();
    const timer = createEncounterTimer(makeOptions(clock, harness));
    timer.start();
    clock.now = 1_000;
    blur(harness);
    hide(harness);
    clock.now = 30_000;
    focus(harness);
    show(harness);
    clock.now = 31_500;
    expect(timer.stop()).toMatchObject({ activeLatencyMs: 2_500, interruptionCount: 1 });
  });

  it('a prompt surfaced into an already-unfocused window starts interrupted and excludes the pre-focus stretch (R11)', () => {
    // The review reproduction: the learner alt-tabs, the NEXT prompt appears
    // while the Electron window is visible-but-unfocused, no blur event ever
    // fires for the new timer, and the away stretch must not read as clean.
    const clock = { now: 0 };
    const harness = makeHarness();
    harness.doc.hasFocus = () => false;
    const timer = createEncounterTimer(makeOptions(clock, harness));
    timer.start();
    clock.now = 30_000; // the whole opening stretch happens without focus
    harness.doc.hasFocus = () => true;
    focus(harness); // the learner returns: first active segment opens here
    clock.now = 31_200;
    expect(timer.stop()).toMatchObject({
      activeLatencyMs: 1_200,
      interruptionCount: 1,
      interrupted: true,
      stalled: false,
    });
  });

  it('a prompt surfaced into an already-hidden document starts interrupted and excludes the hidden stretch', () => {
    const clock = { now: 0 };
    const harness = makeHarness();
    harness.doc.hidden = true;
    const timer = createEncounterTimer(makeOptions(clock, harness));
    timer.start();
    clock.now = 40_000;
    show(harness);
    clock.now = 41_500;
    expect(timer.stop()).toMatchObject({ activeLatencyMs: 1_500, interruptionCount: 1, interrupted: true });
  });

  it('initially unfocused AND hidden is ONE pause, resumed only when both return', () => {
    const clock = { now: 0 };
    const harness = makeHarness();
    harness.doc.hidden = true;
    harness.doc.hasFocus = () => false;
    const timer = createEncounterTimer(makeOptions(clock, harness));
    timer.start();
    clock.now = 10_000;
    harness.doc.hasFocus = () => true;
    focus(harness); // focus returns while the document is still hidden
    clock.now = 20_000;
    expect(timer.stop()).toMatchObject({ activeLatencyMs: 0, interruptionCount: 1 });
  });

  it('the no-options production seam reads the real document, not window globals', () => {
    // Production callers (FlashcardReview, PlacementSession, WelcomeRoute,
    // WordSync) create the timer with NO options. In a renderer `globalThis`
    // is the window — `window.hidden` is undefined and `window.hasFocus`
    // does not exist — so the default must resolve `globalThis.document`.
    let docVisibilityChange: (() => void) | undefined;
    const fakeDocument = {
      addEventListener: (type: string, listener: () => void) => { if (type === 'visibilitychange') docVisibilityChange = listener; },
      removeEventListener: () => {},
      // Focused surface: the INITIAL interruption must come from `hidden` —
      // which only resolves if the default doc is the real document. The
      // fallback (`window.hidden` = undefined) would never pause the start.
      hidden: true,
      hasFocus: () => true,
    };
    const globalWithDocument = globalThis as { document?: unknown };
    const previousDocument = globalWithDocument.document;
    globalWithDocument.document = fakeDocument;
    // Node's bare globalThis is not a full EventTarget, so give the no-options
    // timer the two win-side methods it needs (no-op stubs — this test asserts
    // the DOCUMENT seam, not window event routing); saved and restored.
    const globalTarget = globalThis as unknown as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    const previousAdd = globalTarget.addEventListener;
    const previousRemove = globalTarget.removeEventListener;
    globalTarget.addEventListener = () => {};
    globalTarget.removeEventListener = () => {};
    let timer: EncounterTimer | null = null;
    try {
      const clock = { now: 0 };
      timer = createEncounterTimer({ now: () => clock.now });
      timer.start();
      expect(docVisibilityChange).toBeDefined(); // listeners live on the DOCUMENT
      clock.now = 5_000;
      fakeDocument.hidden = false;
      docVisibilityChange!();
      clock.now = 6_000;
      expect(timer.stop()).toMatchObject({ activeLatencyMs: 1_000, interruptionCount: 1, interrupted: true });
    } finally {
      timer?.dispose();
      globalTarget.addEventListener = previousAdd;
      globalTarget.removeEventListener = previousRemove;
      globalWithDocument.document = previousDocument;
    }
  });

  it('a conservative focus stall flags the attempt without subtracting the gap', () => {
    const clock = { now: 0 };
    const harness = makeHarness();
    const timer = createEncounterTimer({ ...makeOptions(clock, harness), stallInterruptMs: 1_000 });
    timer.start();
    clock.now = 500;
    engage(harness);
    // Learner leaves the machine while the window stays focused.
    clock.now = 500 + STALL_INTERRUPT_MS + 2_000;
    engage(harness);
    clock.now += 700;
    const timing = timer.stop();
    expect(timing).toMatchObject({ interruptionCount: 1, interrupted: true, stalled: true });
    expect(timing!.activeLatencyMs).toBe(timing!.wallLatencyMs);
  });

  it('an engagement-free focused stretch past the stall threshold flags at stop', () => {
    const clock = { now: 0 };
    const harness = makeHarness();
    const timer = createEncounterTimer({ ...makeOptions(clock, harness), stallInterruptMs: 1_000 });
    timer.start();
    clock.now = 5_000;
    const timing = timer.stop();
    expect(timing).toMatchObject({ stalled: true, interrupted: true });
  });

  it('stop without start returns null and dispose detaches the listeners', () => {
    const clock = { now: 0 };
    const harness = makeHarness();
    const timer = createEncounterTimer(makeOptions(clock, harness));
    expect(timer.stop()).toBeNull();
    timer.start();
    expect(harness.winHandlers.get('blur')).toBeDefined();
    timer.dispose();
    expect(harness.winHandlers.get('blur')).toBeUndefined();
    expect(timer.stop()).toBeNull();
  });
});

describe('attemptActiveLatencyMs', () => {
  const event = (fields: Partial<KnowledgeEvent>): KnowledgeEvent => ({ t: 0, kind: 'rating', source: 'manual', ...fields });

  it('prefers active latency and falls back to legacy wall latency', () => {
    expect(attemptActiveLatencyMs(event({ activeLatencyMs: 900, latencyMs: 60_000 }))).toBe(900);
    expect(attemptActiveLatencyMs(event({ latencyMs: 60_000 }))).toBe(60_000);
    expect(attemptActiveLatencyMs(event({}))).toBeUndefined();
  });

  it('refuses stall-flagged attempts: their active time still contains the gap', () => {
    expect(attemptActiveLatencyMs(event({ activeLatencyMs: 900, latencyMs: 60_000, stalled: true }))).toBeUndefined();
    expect(attemptActiveLatencyMs(event({ activeLatencyMs: 900, latencyMs: 60_000, interrupted: true }))).toBe(900);
  });
});
