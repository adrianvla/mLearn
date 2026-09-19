import { describe, expect, it, vi, afterEach } from 'vitest';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { useDecisionPin } from './useDecisionPin';
import { selectNextEncounter } from '../learning/engine';
import type { PolicyDecision } from '../learning/types';
import type { FlashcardLike } from '../learning/candidateSources';

const card = (id: string): FlashcardLike => ({
  id,
  word: id,
  language: 'de',
  targets: [{ entityId: `de:surface:${id}`, capability: 'surface-recognition' }],
  // dueDate 2s overdue over a 4-day interval: both cards score an equal
  // retention-need of 1, so the weighted draw alone decides the pick.
  dueDate: 8_000,
  interval: 4,
  state: 'review',
  scheduledForToday: true,
});

const policyInputs = (pool: readonly FlashcardLike[]) => ({
  preset: 'RETENTION' as const,
  nowMs: 10_000,
  reviewQueueEntries: pool,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDecisionPin', () => {
  it('computes once per fallback and re-serves the identical decision', () => {
    const pin = useDecisionPin();
    const compute = vi.fn(() => ({ candidate: { key: 'c1' } } as unknown as PolicyDecision));
    const first = pin.pin('c1', compute);
    const second = pin.pin('c1', compute);
    expect(second).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('caches a null decision (defer) rather than recomputing', () => {
    const pin = useDecisionPin();
    const compute = vi.fn(() => null);
    expect(pin.pin('c1', compute)).toBeNull();
    expect(pin.pin('c1', compute)).toBeNull();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('keeps one pin per fallback: a cycled A→B→A fallback never re-draws', () => {
    const pin = useDecisionPin();
    const computeA = vi.fn(() => ({ candidate: { key: 'a' } } as unknown as PolicyDecision));
    const computeB = vi.fn(() => ({ candidate: { key: 'b' } } as unknown as PolicyDecision));
    const firstA = pin.pin('a', computeA);
    expect(pin.pin('b', computeB)?.candidate.key).toBe('b');
    // The context's fallback can legitimately cycle back to A without an
    // explicit action: A re-serves its OWN pin instead of re-drawing.
    expect(pin.pin('a', computeA)).toBe(firstA);
    expect(computeA).toHaveBeenCalledTimes(1);
    expect(computeB).toHaveBeenCalledTimes(1);
  });

  it('drops every pin on advance so the same fallback recomputes', () => {
    const pin = useDecisionPin();
    let generation = 0;
    const compute = vi.fn(() => {
      generation += 1;
      return { candidate: { key: `c1@${generation}` } } as unknown as PolicyDecision;
    });
    expect(pin.pin('c1', compute)?.candidate.key).toBe('c1@1');
    expect(pin.pin('c1', compute)?.candidate.key).toBe('c1@1');
    pin.advance();
    expect(pin.pin('c1', compute)?.candidate.key).toBe('c1@2');
    // The old pin is gone, not re-served: advance() invalidated it.
    expect(pin.pin('b', compute)?.candidate.key).toBe('c1@3');
  });
});

describe('useDecisionPin — surface encounter pattern (R20 repair)', () => {
  it('keeps the displayed pick stable across an unrelated reactive re-run even when a second rng outcome is forced', () => {
    createRoot((dispose) => {
      const randomSpy = vi.spyOn(Math, 'random');
      // Draw sequence 1 over the equal pool [c1, c2]: smaller weighted key
      // (-draw) wins, so c1 (-0.9) beats c2 (-0.1). Sequence 2 would pick c2.
      randomSpy.mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);

      const [fallback, setFallback] = createSignal(card('c1'));
      const pin = useDecisionPin();
      // The exact production wiring: a reactive memo that rebuilds the
      // scheduler's queue and calls the UNSEEDED policy inside the pin.
      const displayed = createMemo(() => {
        const current = fallback();
        const decision = pin.pin(current.id, () => selectNextEncounter(policyInputs([card('c1'), card('c2')])));
        return decision?.candidate.key ?? current.id;
      });
      expect(displayed()).toBe('c1');
      expect(randomSpy).toHaveBeenCalledTimes(2);

      // Unrelated reactive update: the fallback signal fires with a fresh
      // instance of the SAME card (id and fields unchanged). Pre-fix, the
      // memo re-ran the unseeded draw; the forced second outcome (0.1, 0.9)
      // would have flipped the displayed card to c2.
      randomSpy.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
      setFallback(card('c1'));

      expect(displayed()).toBe('c1');
      // The pin re-served the decision: the rng was never consulted again.
      expect(randomSpy).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('never replays a just-rated non-fallback pick through a stale pin', () => {
    createRoot((dispose) => {
      const randomSpy = vi.spyOn(Math, 'random');
      // Sequence 1 picks c2 — a policy pick that is NOT the fallback c1.
      randomSpy.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);

      const [fallback, setFallback] = createSignal(card('c1'));
      const pin = useDecisionPin();
      const displayed = createMemo(() => {
        const current = fallback();
        const decision = pin.pin(current.id, () => selectNextEncounter(policyInputs([card('c1'), card('c2')])));
        return decision?.candidate.key ?? current.id;
      });
      expect(displayed()).toBe('c2');

      // The learner rates the DISPLAYED card (c2), not the fallback. The pin
      // is keyed by the fallback id, so without an epoch bump a same-id
      // fallback re-run would replay c2 through the stale pin.
      randomSpy.mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);
      pin.advance();
      setFallback(card('c1'));

      // The encounter ended: the next read re-selects (fresh draw picks c1)
      // instead of replaying the rated c2.
      expect(displayed()).toBe('c1');
      expect(randomSpy).toHaveBeenCalledTimes(4);
      dispose();
    });
  });
});
