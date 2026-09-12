// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { WordSyncRating } from './WordSyncRating';
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.useRealTimers(); });

const ACCESSES = ['sense-recognition', 'surface-reading', 'prosodic-pattern', 'surface-recognition'] as const;

describe('Word Sync rating', () => {
  it('collapsed digit rates every tested access at one quality, exactly once', () => {
    const onSubmit = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordSyncRating accesses={ACCESSES} armed resetKey="a" keyboardMode="mnemonic" onSubmit={onSubmit} />, container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(ACCESSES.map((capability) => ({ capability, quality: 'fluent' })));
    // The submitted guard absorbs stray repeats until resetKey changes.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('collapsed Alt marks the whole-word rating as worked out', () => {
    const onSubmit = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordSyncRating accesses={['sense-recognition', 'surface-reading']} armed resetKey="a" keyboardMode="mnemonic" onSubmit={onSubmit} />, container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', altKey: true }));
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { capability: 'sense-recognition', quality: 'struggled', method: 'inference' },
      { capability: 'surface-reading', quality: 'struggled', method: 'inference' },
    ]);
  });

  it('collapsed 4 stays fluent evidence with an easy scheduling preference', () => {
    const onSubmit = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordSyncRating accesses={['sense-recognition', 'surface-reading']} armed resetKey="a" keyboardMode="mnemonic" onSubmit={onSubmit} />, container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { capability: 'sense-recognition', quality: 'fluent', easy: true },
      { capability: 'surface-reading', quality: 'fluent', easy: true },
    ]);
    expect(onSubmit.mock.calls[0][1]).toEqual({ easy: true });
  });
  it('Adjust exposes every tested row — revealed cues never remove Reading or Prosody', () => {
    const container = document.createElement('div'); document.body.append(container);
    const onSubmit = vi.fn();
    dispose = render(() => <WordSyncRating accesses={ACCESSES} armed resetKey="a" keyboardMode="mnemonic" onSubmit={onSubmit} />, container);
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Rating.Compact.Adjust')?.click();
    const labels = Array.from(container.querySelectorAll('.rating-matrix__row .rating-matrix__label')).map((label) => label.textContent);
    expect(labels).toEqual([
      'mlearn.Rating.Matrix.AllRow',
      'mlearn.Knowledge.Capability.sense-recognition',
      'mlearn.Knowledge.Capability.surface-reading',
      'mlearn.Knowledge.Capability.prosodic-pattern',
      'mlearn.Knowledge.Capability.surface-recognition',
    ]);
  });

  it('expanded doubled digit is the explicit All-row bulk; an explicit draft stands', () => {
    const onSubmit = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordSyncRating accesses={ACCESSES} armed resetKey="a" keyboardMode="mnemonic" onSubmit={onSubmit} />, container);
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Rating.Compact.Adjust')?.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' })); // meaning missed (draft)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' })); // All fluent
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { capability: 'sense-recognition', quality: 'missed' },
      { capability: 'surface-reading', quality: 'fluent' },
      { capability: 'prosodic-pattern', quality: 'fluent' },
      { capability: 'surface-recognition', quality: 'fluent' },
    ]);
  });

  it('expanded 4-4 bulk applies easy as a preference, not a fourth evidence level', () => {
    const onSubmit = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordSyncRating accesses={['sense-recognition', 'surface-reading']} armed resetKey="a" keyboardMode="mnemonic" onSubmit={onSubmit} />, container);
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Rating.Compact.Adjust')?.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { capability: 'sense-recognition', quality: 'fluent', easy: true },
      { capability: 'surface-reading', quality: 'fluent', easy: true },
    ], { easy: true });
  });

  it('partial drafts never submit; drafting the last row submits the full set exactly once', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordSyncRating accesses={['sense-recognition', 'surface-reading', 'prosodic-pattern']} armed resetKey="a" keyboardMode="mnemonic" onSubmit={onSubmit} />, container);
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Rating.Compact.Adjust')?.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' })); // reading struggled
    vi.advanceTimersByTime(1600);
    expect(onSubmit).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    expect(onSubmit).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', altKey: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { capability: 'sense-recognition', quality: 'missed' },
      { capability: 'surface-reading', quality: 'struggled' },
      { capability: 'prosodic-pattern', quality: 'fluent', method: 'inference' },
    ]);
  });

  it('spatial mode: digits are the All row, letters draft their displayed row', () => {
    const onSubmit = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordSyncRating accesses={['sense-recognition', 'surface-reading']} armed resetKey="a" keyboardMode="spatial" onSubmit={onSubmit} />, container);
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Rating.Compact.Adjust')?.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); // struggled × row 1 (meaning)
    expect(onSubmit).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' })); // All row easy
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { capability: 'sense-recognition', quality: 'struggled' },
      { capability: 'surface-reading', quality: 'fluent', easy: true },
    ]);
  });

  it('resetKey clears drafts and the submitted guard for the next presentation', async () => {
    const onSubmit = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    const [presentation, setPresentation] = createSignal(1);
    dispose = render(() => <WordSyncRating accesses={['sense-recognition', 'surface-reading']} armed resetKey={presentation()} keyboardMode="mnemonic" onSubmit={onSubmit} />, container);
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Rating.Compact.Adjust')?.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    expect(onSubmit).not.toHaveBeenCalled();
    setPresentation(2);
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { capability: 'sense-recognition', quality: 'struggled' },
      { capability: 'surface-reading', quality: 'struggled' },
    ]);
  });
});
