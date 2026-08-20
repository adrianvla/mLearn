// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { RatingMatrix, type RateOptions } from './RatingMatrix';
import type { AttemptQuality, KnowledgeAspect } from '../../../../shared/constants';

const mockT = (key: string): string => key;

vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: mockT }),
}));

describe('RatingMatrix', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | null = null;
  const onRate = vi.fn();
  const onAllFluent = vi.fn();
  const ASPECTS = ['meaning', 'reading', 'prosody', 'orthography'] as const;

  const key = (k: string, opts: KeyboardEventInit = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...opts }));
  };

  const renderMatrix = (keyboardMode: 'mnemonic' | 'spatial' = 'mnemonic', aspects: readonly KnowledgeAspect[] = ASPECTS) => {
    dispose?.();
    dispose = render(
      () => (
        <RatingMatrix
          aspects={aspects}
          keyboardMode={keyboardMode}
          armed
          onRate={(aspect: KnowledgeAspect, quality: AttemptQuality, opts?: RateOptions) => onRate(aspect, quality, opts)}
          onAllFluent={(opts?: RateOptions) => onAllFluent(opts)}
        />
      ),
      container,
    );
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Solid dispose removes the window keydown listener; without it every test
    // leaks a live matrix that double-fires later tests.
    dispose?.();
    dispose = null;
    container.remove();
  });

  it('mnemonic chord: 1 then R rates Reading missed', () => {
    renderMatrix('mnemonic');
    key('1');
    key('r');
    expect(onRate).toHaveBeenCalledWith('reading', 'missed', undefined);
  });

  it('a lone quality key arms the chord with an immediate hint and no mutation', () => {
    renderMatrix('mnemonic');
    key('2');
    expect(onRate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('mlearn.Rating.Matrix.PendingHint');
    // Pending column hints expose the valid continuations.
    expect(container.textContent).toContain('2+R');
  });

  it('the pending chord expires silently after ~1.5s', () => {
    vi.useFakeTimers();
    try {
      renderMatrix('mnemonic');
      key('1');
      vi.advanceTimersByTime(1600);
      expect(onRate).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('mlearn.Rating.Matrix.PendingHint');
      // Expired chord is inert: a later letter does nothing.
      key('r');
      expect(onRate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape cancels a pending chord immediately', () => {
    renderMatrix('mnemonic');
    key('3');
    key('Escape');
    expect(container.textContent).not.toContain('mlearn.Rating.Matrix.PendingHint');
    key('m');
    expect(onRate).not.toHaveBeenCalled();
  });

  it('Alt marks the attempt as worked out (method=inference)', () => {
    renderMatrix('mnemonic');
    key('1');
    key('m', { altKey: true });
    expect(onRate).toHaveBeenCalledWith('meaning', 'missed', { method: 'inference' });
  });

  it('spatial mode: keys mean quality column × displayed row, not fixed aspects', () => {
    renderMatrix('spatial');
    // Row 2 is Reading here…
    key('q');
    expect(onRate).toHaveBeenCalledWith('reading', 'missed', undefined);
    // …but with different rows displayed, the SAME key hits a different aspect.
    onRate.mockClear();
    renderMatrix('spatial', ['meaning', 'orthography']);
    key('q');
    expect(onRate).toHaveBeenCalledWith('orthography', 'missed', undefined);
    // 'e' = fluent × row 2 of the CURRENT matrix (orthography with these rows).
    key('e');
    expect(onRate).toHaveBeenCalledWith('orthography', 'fluent', undefined);
  });

  it('rows beyond the fourth spatial row are click-only', () => {
    renderMatrix('spatial', ['meaning', 'reading', 'prosody', 'orthography', 'gender']);
    key('p'); // 'p' is not a spatial key — nothing fires
    expect(onRate).not.toHaveBeenCalled();
    // Fifth row (Gender) still renders and clicks.
    const rows = container.querySelectorAll('.rating-matrix__row');
    expect(rows.length).toBe(5);
    const genderCells = rows[4].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell');
    expect(genderCells[0].textContent).toContain('·');
    genderCells[1].click();
    expect(onRate).toHaveBeenCalledWith('gender', 'struggled', undefined);
  });

  it('Space/Enter = all tested fluent; Shift adds easy; Alt adds inference', () => {
    renderMatrix('mnemonic');
    key(' ');
    expect(onAllFluent).toHaveBeenCalledWith(undefined);
    onAllFluent.mockClear();
    key('Enter', { shiftKey: true });
    expect(onAllFluent).toHaveBeenCalledWith({ easy: true });
    onAllFluent.mockClear();
    key(' ', { altKey: true });
    expect(onAllFluent).toHaveBeenCalledWith({ method: 'inference' });
  });

  it('auto-repeat and typing-in-field keydowns are ignored', () => {
    renderMatrix('mnemonic');
    key('1', { repeat: true });
    expect(container.textContent).not.toContain('mlearn.Rating.Matrix.PendingHint');
    const input = document.createElement('input');
    container.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    expect(onRate).not.toHaveBeenCalled();
  });

  it('clicking a cell emits the same action as its chord', () => {
    renderMatrix('mnemonic');
    const rows = container.querySelectorAll('.rating-matrix__row');
    const prosodyCells = rows[2].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell');
    prosodyCells[1].click();
    expect(onRate).toHaveBeenCalledWith('prosody', 'struggled', undefined);
  });

  it('disarmed matrix neither rates nor highlights', () => {
    dispose = render(
      () => (
        <RatingMatrix
          aspects={ASPECTS}
          keyboardMode="mnemonic"
          armed={false}
          onRate={(aspect: KnowledgeAspect, quality: AttemptQuality, opts?: RateOptions) => onRate(aspect, quality, opts)}
          onAllFluent={(opts?: RateOptions) => onAllFluent(opts)}
        />
      ),
      container,
    );
    key('1');
    key('m');
    key(' ');
    expect(onRate).not.toHaveBeenCalled();
    expect(onAllFluent).not.toHaveBeenCalled();
  });
});
