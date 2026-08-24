// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
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
  const onProfileSubmit = vi.fn();
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
          onProfileSubmit={(observations) => onProfileSubmit(observations)}
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

  it('F is the explicit all-tested fluent quick action; Shift adds easy; Alt adds inference', () => {
    renderMatrix('mnemonic');
    key('f');
    expect(onAllFluent).toHaveBeenCalledWith(undefined);
    onAllFluent.mockClear();
    key('f', { shiftKey: true });
    expect(onAllFluent).toHaveBeenCalledWith({ easy: true });
    onAllFluent.mockClear();
    key('f', { altKey: true });
    expect(onAllFluent).toHaveBeenCalledWith({ method: 'inference' });
  });

  it('Space and Enter never submit a rating', () => {
    renderMatrix('mnemonic');
    key(' ');
    key('Enter');
    expect(onRate).not.toHaveBeenCalled();
    expect(onAllFluent).not.toHaveBeenCalled();
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

  // ── Profile mode (Word Sync calibration) ────────────────────────────────
  const renderProfile = (keyboardMode: 'mnemonic' | 'spatial' = 'mnemonic', aspects: readonly KnowledgeAspect[] = ASPECTS) => {
    dispose?.();
    dispose = render(
      () => (
        <RatingMatrix
          aspects={aspects}
          keyboardMode={keyboardMode}
          mode="profile"
          resetKey={resetKey()}
          armed
          onRate={(aspect: KnowledgeAspect, quality: AttemptQuality, opts?: RateOptions) => onRate(aspect, quality, opts)}
          onProfileSubmit={(observations) => onProfileSubmit(observations)}
        />
      ),
      container,
    );
  };
  const [resetKey, setResetKey] = createSignal('word-1');

  it('profile fast path: no drafts + F submits all tested fluent, once', () => {
    renderProfile();
    expect(onRate).not.toHaveBeenCalled();
    key('f');
    const obs = onProfileSubmit.mock.calls[0]?.[0];
    expect(obs?.length).toBe(4);
    expect(obs?.every((o: { quality: string }) => o.quality === 'fluent')).toBe(true);
  });

  it('profile two exceptions + F: explicit rows keep quality, rest fluent', () => {
    renderProfile();
    key('1'); key('m');   // Meaning missed
    key('2'); key('p');   // Prosody struggled
    key('f');
    const obs = onProfileSubmit.mock.calls[0]?.[0];
    const byAspect = Object.fromEntries((obs ?? []).map((o: { aspect: string }) => [o.aspect, o]));
    expect(byAspect.meaning.quality).toBe('missed');
    expect(byAspect.prosody.quality).toBe('struggled');
    expect(byAspect.reading.quality).toBe('fluent');
    expect(byAspect.orthography.quality).toBe('fluent');
    // No evidence before submit, one submit only.
    expect(onRate).not.toHaveBeenCalled();
    expect(onProfileSubmit).toHaveBeenCalledTimes(1);
  });

  it('profile replacement: re-selecting a row keeps only the last quality', () => {
    renderProfile();
    key('1'); key('m');
    key('2'); key('m');
    key('f');
    const byAspect = Object.fromEntries((onProfileSubmit.mock.calls[0]?.[0] ?? []).map((o: { aspect: string }) => [o.aspect, o]));
    expect(byAspect.meaning.quality).toBe('struggled');
  });

  it('profile spatial: 1, S, F drafts and submits without early advance', () => {
    renderProfile('spatial');
    key('1'); // Meaning missed (row 1)
    key('s'); // Prosody struggled (row 3)
    expect(onProfileSubmit).not.toHaveBeenCalled();
    key('f');
    const byAspect = Object.fromEntries((onProfileSubmit.mock.calls[0]?.[0] ?? []).map((o: { aspect: string }) => [o.aspect, o]));
    expect(byAspect.meaning.quality).toBe('missed');
    expect(byAspect.prosody.quality).toBe('struggled');
    expect(byAspect.reading.quality).toBe('fluent');
  });

  it('profile drafts reset on resetKey change (new word)', async () => {
    renderProfile();
    key('1'); key('m');
    setResetKey('word-2');
    await Promise.resolve();
    // New word => fresh drafts: meaning must submit as the confirmed Fluent
    // default, not the previous word's draft.
    expect(resetKey()).toBe('word-2');
    key('f');
    const byAspect = Object.fromEntries((onProfileSubmit.mock.calls[0]?.[0] ?? []).map((o: { aspect: string }) => [o.aspect, o]));
    expect(byAspect.meaning.quality).toBe('fluent');
  });

  it('profile not-tested rows never receive observations', () => {
    renderProfile('mnemonic', ['meaning', 'orthography']);
    key('f');
    const obs = onProfileSubmit.mock.calls[0]?.[0] ?? [];
    expect(obs.length).toBe(2);
    expect(obs.map((o: { aspect: string }) => o.aspect)).toEqual(['meaning', 'orthography']);
  });

  it('profile Alt+draft carries per-row inference; submit modifier does not contaminate drafts', () => {
    renderProfile();
    key('1');
    key('m', { altKey: true });
    key('f');           // plain submit
    const byAspect = Object.fromEntries((onProfileSubmit.mock.calls[0]?.[0] ?? []).map((o: { aspect: string }) => [o.aspect, o]));
    expect(byAspect.meaning.method).toBe('inference');
    expect(byAspect.meaning.quality).toBe('missed');
    expect(byAspect.reading.method).toBeUndefined();
    expect(byAspect.reading.quality).toBe('fluent');
  });

  it('profile click parity: clicking cells matches chord drafts', () => {
    renderProfile();
    const rows = container.querySelectorAll('.rating-matrix__row');
    (rows[0].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[0]).click();
    (rows[2].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[1]).click();
    key('f');
    const byAspect = Object.fromEntries((onProfileSubmit.mock.calls[0]?.[0] ?? []).map((o: { aspect: string }) => [o.aspect, o]));
    expect(byAspect.meaning.quality).toBe('missed');
    expect(byAspect.prosody.quality).toBe('struggled');
  });

  it('quick all-fluent produces the same profile as manually marking every row fluent', () => {
    renderProfile();
    for (const row of Array.from(container.querySelectorAll('.rating-matrix__row'))) {
      row.querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[2].click();
    }
    key('f');
    const manual = onProfileSubmit.mock.calls[0]?.[0];

    onProfileSubmit.mockClear();
    renderProfile();
    key('f');

    expect(onProfileSubmit.mock.calls[0]?.[0]).toEqual(manual);
  });

  it('a dominant task emits only its intended capability', () => {
    renderMatrix('mnemonic', ['reading']);
    key('1');
    key('r');
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate).toHaveBeenCalledWith('reading', 'missed', undefined);
  });

  it('profile button copy switches to EverythingElseFluent once drafts exist', () => {
    renderProfile();
    expect(container.textContent).toContain('mlearn.Rating.Matrix.AllFluent');
    key('1'); key('m');
    expect(container.textContent).toContain('mlearn.Rating.Matrix.EverythingElseFluent');
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
