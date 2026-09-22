// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { RatingMatrix } from './RatingMatrix';
import type { WordStatus } from '../../../../shared/constants';
import type { CapabilityKey } from '../../../../shared/graph/types';

const mockT = (key: string): string => key;

vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: mockT }),
}));

describe('RatingMatrix (canonical rating control)', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | null = null;
  const onSubmit = vi.fn();
  const CAPABILITIES = ['sense-recognition', 'surface-reading', 'prosodic-pattern', 'surface-recognition'] as const;

  const key = (k: string, opts: KeyboardEventInit = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...opts }));
  };

  const renderMatrix = (
    keyboardMode: 'mnemonic' | 'spatial' = 'mnemonic',
    capabilities: readonly CapabilityKey[] = CAPABILITIES,
    armed = true,
    resetKey?: () => string | number,
  ) => {
    dispose?.();
    dispose = render(
      () => (
        <RatingMatrix
          capabilities={capabilities}
          keyboardMode={keyboardMode}
          armed={armed}
          resetKey={resetKey ? resetKey() : 'word-1'}
          onSubmit={(observations, opts) => onSubmit(observations, opts)}
        />
      ),
      container,
    );
  };

  const adjust = () => {
    const button = container.querySelector<HTMLButtonElement>('.rating-matrix__adjust');
    if (!button) throw new Error('Missing Adjust toggle');
    button.click();
    return button;
  };

  const rows = () => Array.from(container.querySelectorAll('.rating-matrix__row'));

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

  it('completes the remaining clicked row without turning selected claims into observations', () => {
    const [claims, setClaims] = createSignal<Partial<Record<CapabilityKey, WordStatus>>>({});
    dispose = render(() => <RatingMatrix capabilities={CAPABILITIES} keyboardMode="mnemonic" armed
      claims={claims()} onSubmit={onSubmit} />, container);
    adjust();
    setClaims({ 'sense-recognition': 'learning', 'surface-reading': 'learning', 'prosodic-pattern': 'known' });
    expect(onSubmit).not.toHaveBeenCalled();
    rows()[4].querySelectorAll('button')[0].click();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith([{ capability: 'surface-recognition', quality: 'missed' }], undefined);
    rows()[4].querySelectorAll('button')[0].click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders a package label for an opaque capability key', () => {
    dispose = render(() => <RatingMatrix
      capabilities={['x-test::evidentiality']}
      capabilityLabels={{ 'x-test::evidentiality': 'Evidentiality' }}
      keyboardMode="mnemonic"
      armed
      onSubmit={onSubmit}
    />, container);
    adjust();
    expect(container.textContent).toContain('Evidentiality');
  });

  it('requires an answer again after an access claim is undone', () => {
    const [claims, setClaims] = createSignal<Partial<Record<CapabilityKey, WordStatus>>>({
      'sense-recognition': 'learning', 'surface-reading': 'learning', 'prosodic-pattern': 'known',
    });
    dispose = render(() => <RatingMatrix capabilities={CAPABILITIES} keyboardMode="mnemonic" armed claims={claims()} onSubmit={onSubmit} />, container);
    adjust();
    setClaims({ 'sense-recognition': 'learning', 'prosodic-pattern': 'known' });
    rows()[4].querySelectorAll('button')[0].click();
    expect(onSubmit).not.toHaveBeenCalled();
    rows()[2].querySelectorAll('button')[0].click();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith([
      { capability: 'surface-reading', quality: 'missed' },
      { capability: 'surface-recognition', quality: 'missed' },
    ], undefined);
  });

  it('selects claim qualities in the same buttons, including sound recognition, and clears on undo', () => {
    const [claims, setClaims] = createSignal<Partial<Record<CapabilityKey, WordStatus>>>({});
    dispose = render(() => <RatingMatrix capabilities={CAPABILITIES} keyboardMode="mnemonic" armed
      claims={claims()} onSubmit={onSubmit} />, container);
    adjust();
    key('1'); key('p');
    setClaims({ 'prosodic-pattern': 'known', 'spoken-recognition': 'learning', 'surface-recognition': 'unknown' });
    const selected = () => Array.from(container.querySelectorAll('[aria-pressed="true"]')).map(b => b.getAttribute('aria-label'));
    expect(selected()).toEqual([
      'mlearn.Knowledge.Capability.prosodic-pattern: mlearn.Rating.Matrix.Fluent',
      'mlearn.Knowledge.Capability.surface-recognition: mlearn.Rating.Matrix.Missed',
      'mlearn.Knowledge.Capability.spoken-recognition: mlearn.Rating.Matrix.Struggled',
    ]);
    expect(container.querySelector('.rating-matrix__claim')).toBeNull();
    setClaims({});
    expect(selected()).toEqual([]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('selects the whole tested profile from a word claim, with specific exceptions and explicit Easy override', () => {
    const [wordClaim, setWordClaim] = createSignal<WordStatus | null>('known');
    const [claims, setClaims] = createSignal<Partial<Record<CapabilityKey, WordStatus>>>({});
    dispose = render(() => <RatingMatrix capabilities={CAPABILITIES} keyboardMode="mnemonic" armed
      wordClaim={wordClaim()} claims={claims()} onSubmit={onSubmit} />, container);
    adjust();
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(5);
    expect(rows()[0].querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    setClaims({ 'surface-recognition': 'unknown' });
    expect(rows()[0].querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    key('4'); key('p');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith([{ capability: 'prosodic-pattern', quality: 'fluent', easy: true }], { easy: true });
    setWordClaim(null);
    setClaims({});
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  });

  it('collapsed digits rate the whole word exactly once; strays are absorbed', () => {
    renderMatrix();
    key('1');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [observations, opts] = onSubmit.mock.calls[0];
    expect(observations.map((o: { capability: string }) => o.capability)).toEqual([...CAPABILITIES]);
    expect(observations.every((o: { quality: string }) => o.quality === 'missed')).toBe(true);
    expect(opts).toBeUndefined();
    key('3');
    key('1');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Alt marks a collapsed whole-word rating as worked out', () => {
    renderMatrix();
    key('2', { altKey: true });
    const [observations, opts] = onSubmit.mock.calls[0];
    expect(observations.every((o: { method?: string }) => o.method === 'inference')).toBe(true);
    expect(opts).toEqual({ method: 'inference' });
  });

  it('collapsed Easy is fluent evidence plus the scheduler preference', () => {
    renderMatrix();
    key('4');
    const [observations, opts] = onSubmit.mock.calls[0];
    expect(observations.every((o: { quality: string; easy?: boolean }) => o.quality === 'fluent' && o.easy === true)).toBe(true);
    expect(opts).toEqual({ easy: true });
  });

  it('does nothing while disarmed', () => {
    renderMatrix('mnemonic', CAPABILITIES, false);
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')).every((b) => b.disabled)).toBe(true);
    key('1');
    adjust();
    key('1');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Adjust unfolds the All row plus every tested capability, package keys included', () => {
    renderMatrix('mnemonic', ['sense-recognition', 'trainer::tone' as CapabilityKey]);
    expect(container.querySelector('.rating-matrix__unfold')).toBeNull();
    const button = adjust();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const labels = rows().map((row) => row.querySelector('.rating-matrix__label')?.textContent);
    expect(labels).toEqual(['mlearn.Rating.Matrix.AllRow', 'mlearn.Knowledge.Capability.sense-recognition', 'trainer::tone']);
  });

  it('expanded mnemonic digits arm the pending column; the same digit again is the All row', () => {
    renderMatrix();
    adjust();
    key('3');
    expect(container.querySelector('.rating-matrix__col--pending')?.textContent).toBe('mlearn.Rating.Matrix.Fluent');
    expect(onSubmit).not.toHaveBeenCalled();
    key('3');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [observations] = onSubmit.mock.calls[0];
    expect(observations.every((o: { quality: string }) => o.quality === 'fluent')).toBe(true);
  });

  it('mnemonic chords draft their row; partial states never submit', () => {
    renderMatrix();
    adjust();
    key('1');
    key('m'); // sense-recognition missed
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.rating-matrix__cell--selected').length).toBe(1);
    key('2');
    key('r'); // surface-reading struggled
    expect(onSubmit).not.toHaveBeenCalled();
    key('1');
    key('p'); // prosodic-pattern missed
    expect(onSubmit).not.toHaveBeenCalled();
    key('3');
    key('w'); // surface-recognition fluent — the word completes
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [observations] = onSubmit.mock.calls[0];
    expect(observations.map((o: { capability: string; quality: string }) => `${o.capability}:${o.quality}`)).toEqual([
      'sense-recognition:missed',
      'surface-reading:struggled',
      'prosodic-pattern:missed',
      'surface-recognition:fluent',
    ]);
  });

  it('a fully-Easy drafted completion carries the easy scheduler preference', () => {
    renderMatrix('mnemonic', ['sense-recognition', 'surface-reading']);
    adjust();
    key('4');
    key('m'); // sense easy
    key('4');
    key('r'); // reading easy — the word completes
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [observations, opts] = onSubmit.mock.calls[0];
    expect(observations.every((o: { quality: string; easy?: boolean }) => o.quality === 'fluent' && o.easy === true)).toBe(true);
    expect(opts).toEqual({ easy: true });
  });

  it('the All row keeps explicit drafts and fills only the untouched rows', () => {
    renderMatrix();
    adjust();
    key('1');
    key('m'); // explicit sense miss
    key('3');
    key('3'); // All fluent
    const [observations] = onSubmit.mock.calls[0];
    const byCapability = Object.fromEntries(observations.map((o: { capability: string; quality: string }) => [o.capability, o.quality]));
    expect(byCapability).toEqual({
      'sense-recognition': 'missed',
      'surface-reading': 'fluent',
      'prosodic-pattern': 'fluent',
      'surface-recognition': 'fluent',
    });
  });

  it('spatial mode maps digits to the All row and QWER/ASDF/ZXCV/7890 to rows', () => {
    renderMatrix('spatial');
    adjust();
    key('w'); // row 1 (sense), struggled
    key('a'); // row 2 (reading), missed
    expect(onSubmit).not.toHaveBeenCalled();
    key('3'); // All row — completes with the held drafts standing
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [observations] = onSubmit.mock.calls[0];
    const byCapability = Object.fromEntries(observations.map((o: { capability: string; quality: string }) => [o.capability, o.quality]));
    expect(byCapability).toEqual({
      'sense-recognition': 'struggled',
      'surface-reading': 'missed',
      'prosodic-pattern': 'fluent',
      'surface-recognition': 'fluent',
    });
  });

  it('spatial rows beyond the table are click-only (hint dot, no key route)', () => {
    renderMatrix('spatial', ['sense-recognition', 'surface-reading', 'x-demo::spatial-frame' as CapabilityKey, 'spoken-recognition', 'trainer::evidentiality' as CapabilityKey]);
    adjust();
    const lastRow = rows()[5];
    expect(lastRow.querySelectorAll('.rating-matrix__cell')[0].textContent).toContain('·');
    key('7'); // row 4 (spoken) — the last keyed row, never the fifth
    expect(onSubmit).not.toHaveBeenCalled();
    expect(rows()[4].querySelectorAll('.rating-matrix__cell')[0].classList).toContain('rating-matrix__cell--selected');
    lastRow.querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[1].click(); // click-only row
    key('2'); // All struggled — completes; the explicit click draft stands
    const [observations] = onSubmit.mock.calls[0];
    expect(observations[4]).toMatchObject({ capability: 'trainer::evidentiality', quality: 'struggled' });
    expect(observations[3]).toMatchObject({ capability: 'spoken-recognition', quality: 'missed' });
  });

  it('Escape clears a pending chord first and folds only on the second press', () => {
    renderMatrix();
    adjust();
    key('2');
    expect(container.querySelector('.rating-matrix__col--pending')).not.toBeNull();
    key('Escape');
    expect(container.querySelector('.rating-matrix__col--pending')).toBeNull();
    expect(container.querySelector('.rating-matrix__unfold')).not.toBeNull();
    key('Escape');
    expect(container.querySelector('.rating-matrix__unfold')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('resetKey clears drafts, collapse state and the submitted guard', () => {
    const [resetKey, setResetKey] = createSignal<string | number>('word-1');
    renderMatrix('mnemonic', CAPABILITIES, true, resetKey);
    key('1'); // submit whole word
    expect(onSubmit).toHaveBeenCalledTimes(1);
    setResetKey('word-2');
    key('2');
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0].every((o: { quality: string }) => o.quality === 'struggled')).toBe(true);
  });
});
