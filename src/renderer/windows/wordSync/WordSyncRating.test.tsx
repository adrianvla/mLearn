// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { WordSyncRating } from './WordSyncRating';
import type { ProfileObservation } from '../../components/common';
import type { KnowledgeAspect, RatingKeyboardMode } from '../../../shared/constants';

const mockT = (key: string): string => key;

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: mockT }),
}));

describe('WordSyncRating', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | null = null;
  const onSubmit = vi.fn();
  const ASPECTS = ['meaning', 'reading', 'prosody', 'orthography'] as const;
  const [resetKey, setResetKey] = createSignal('word-1');

  const key = (k: string, opts: KeyboardEventInit = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...opts }));
  };

  interface RenderOptions {
    keyboardMode?: RatingKeyboardMode;
    aspects?: readonly KnowledgeAspect[];
    armed?: boolean;
  }

  const renderRating = (options: RenderOptions = {}) => {
    dispose?.();
    dispose = render(
      () => (
        <WordSyncRating
          aspects={options.aspects ?? ASPECTS}
          keyboardMode={options.keyboardMode ?? 'mnemonic'}
          armed={options.armed ?? true}
          resetKey={resetKey()}
          onSubmit={(observations, opts) => onSubmit(observations, opts)}
        />
      ),
      container,
    );
  };

  const adjustButton = () => container.querySelector<HTMLButtonElement>('.word-sync-rating__adjust')!;
  const expand = () => adjustButton().click();
  const isExpanded = () => adjustButton().getAttribute('aria-expanded') === 'true';
  const barButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.word-sync-rating__quality'));
  // Unfolded rows in order: All row first, then one row per aspect.
  const rows = () => Array.from(container.querySelectorAll('.word-sync-rating__row'));
  const rowCells = (row: Element) => Array.from(row.querySelectorAll<HTMLButtonElement>('.word-sync-rating__cell'));
  const isSelected = (cell: HTMLButtonElement) => cell.className.includes('word-sync-rating__cell--selected');
  const submittedByAspect = () =>
    Object.fromEntries(
      ((onSubmit.mock.calls[0]?.[0] as readonly ProfileObservation[] | undefined) ?? []).map((o) => [o.aspect, o]),
    );

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    setResetKey('word-1');
  });

  afterEach(() => {
    // Solid dispose removes the window keydown listener; without it every
    // test leaks a live control that double-fires later tests.
    dispose?.();
    dispose = null;
    container.remove();
  });

  it('collapsed quality clicks submit every aspect at that quality, exactly once', () => {
    const evidenceByIndex = [
      { quality: 'missed' },
      { quality: 'struggled' },
      { quality: 'fluent' },
      { quality: 'fluent', easy: true },
    ] as const;
    evidenceByIndex.forEach((evidence, index) => {
      onSubmit.mockClear();
      renderRating();
      expect(container.querySelectorAll('.word-sync-rating__row').length).toBe(0);
      barButtons()[index].click();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0]).toEqual(ASPECTS.map((aspect) => ({ aspect, ...evidence })));
      expect(onSubmit.mock.calls[0][1]).toEqual(index === 3 ? { easy: true } : undefined);
    });
  });

  it('collapsed digits 1-4 submit the whole word at that quality, exactly once', () => {
    const evidenceByKey: Record<string, { quality: string; easy?: boolean }> = {
      '1': { quality: 'missed' },
      '2': { quality: 'struggled' },
      '3': { quality: 'fluent' },
      '4': { quality: 'fluent', easy: true },
    };
    for (const [digit, evidence] of Object.entries(evidenceByKey)) {
      onSubmit.mockClear();
      renderRating();
      key(digit);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0]).toEqual(ASPECTS.map((aspect) => ({ aspect, ...evidence })));
    }
  });

  it('collapsed digits work in spatial mode too; Alt marks inference on the whole set', () => {
    renderRating({ keyboardMode: 'spatial' });
    key('1', { altKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(
      ASPECTS.map((aspect) => ({ aspect, quality: 'missed', method: 'inference' })),
    );
    expect(onSubmit.mock.calls[0][1]).toEqual({ method: 'inference' });
  });

  it('stray keystrokes in the same tick never double-submit (submitted guard)', () => {
    renderRating();
    key('1');
    key('1');
    key('4');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('not armed: keys and clicks are inert', () => {
    renderRating({ armed: false });
    expect(barButtons()[0].disabled).toBe(true);
    expect(adjustButton().disabled).toBe(true);
    key('1');
    key('m');
    barButtons()[0].click();
    expand();
    expect(isExpanded()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Adjust unfolds in place: All row first, then exactly the applicable aspect rows', () => {
    renderRating({ aspects: ['meaning', 'reading'] });
    expect(isExpanded()).toBe(false);
    expand();
    expect(isExpanded()).toBe(true);
    const allRows = rows();
    expect(allRows.length).toBe(3);
    expect(allRows[0].textContent).toContain('mlearn.WordSync.Rating.AllRow');
    expect(allRows[1].textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(allRows[2].textContent).toContain('mlearn.Knowledge.Aspect.Reading');
  });

  it('an aspect cell only drafts — partial states never submit', () => {
    renderRating();
    expand();
    rowCells(rows()[1])[0].click(); // Meaning × Missed
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[1])[0])).toBe(true);
    expect(isSelected(rowCells(rows()[1])[2])).toBe(false);
  });

  it('All-row click fills only unresolved aspects (explicit drafts stand) and completes the word', () => {
    renderRating();
    expand();
    rowCells(rows()[1])[0].click(); // Meaning × Missed draft
    rowCells(rows()[0])[2].click(); // All × Fluent
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByAspect().meaning).toEqual({ aspect: 'meaning', quality: 'missed' });
    expect(submittedByAspect().reading).toEqual({ aspect: 'reading', quality: 'fluent' });
    expect(onSubmit.mock.calls[0][0]).toHaveLength(ASPECTS.length);
  });

  it('All-row Easy fills fluent+easy and reports the scheduler preference', () => {
    renderRating();
    expand();
    rowCells(rows()[0])[3].click(); // All × Easy
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(ASPECTS.map((aspect) => ({ aspect, quality: 'fluent', easy: true })));
    expect(onSubmit.mock.calls[0][1]).toEqual({ easy: true });
  });

  it('Alt on the All row marks only the FILLED aspects as inference', () => {
    renderRating();
    expand();
    rowCells(rows()[1])[0].click(); // Meaning × Missed (explicit, no method)
    rowCells(rows()[0])[2].dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true })); // All × Fluent + Alt
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByAspect().meaning).toEqual({ aspect: 'meaning', quality: 'missed' });
    expect(submittedByAspect().reading).toEqual({ aspect: 'reading', quality: 'fluent', method: 'inference' });
    expect(onSubmit.mock.calls[0][1]).toEqual({ method: 'inference' });
  });

  it('manual completion of every aspect auto-submits exactly once; extra keystrokes are guarded', () => {
    renderRating();
    expand();
    key('1'); key('m'); // meaning missed
    key('2'); key('r'); // reading struggled
    key('3'); key('p'); // prosody fluent
    expect(onSubmit).not.toHaveBeenCalled();
    key('4'); key('o'); // orthography easy → set complete
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByAspect().meaning).toEqual({ aspect: 'meaning', quality: 'missed' });
    expect(submittedByAspect().reading).toEqual({ aspect: 'reading', quality: 'struggled' });
    expect(submittedByAspect().prosody).toEqual({ aspect: 'prosody', quality: 'fluent' });
    expect(submittedByAspect().orthography).toEqual({ aspect: 'orthography', quality: 'fluent', easy: true });
    // Same-tick strays cannot double-fire.
    key('1'); key('m');
    key('3');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a single-aspect word auto-submits on its one rating', () => {
    renderRating({ aspects: ['meaning'] });
    expand();
    rowCells(rows()[1])[2].click(); // Meaning × Fluent — its only row completes
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([{ aspect: 'meaning', quality: 'fluent' }]);
  });

  it('Escape clears the pending chord first, then folds — never submitting', () => {
    renderRating();
    expand();
    key('2');
    expect(container.querySelector('.word-sync-rating__col--pending')).not.toBeNull();
    // Pending hint is visible as the chord continuation on the cells.
    expect(rowCells(rows()[1])[1].textContent).toContain('2+M');
    key('Escape');
    expect(container.querySelector('.word-sync-rating__col--pending')).toBeNull();
    expect(isExpanded()).toBe(true);
    key('Escape');
    expect(isExpanded()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('drafts survive fold+unfold; a collapsed quality click discards them', () => {
    renderRating();
    expand();
    rowCells(rows()[1])[0].click(); // Meaning × Missed draft
    key('Escape'); // fold (no pending chord)
    expand();
    expect(isSelected(rowCells(rows()[1])[0])).toBe(true);
    key('Escape');
    barButtons()[2].click(); // collapsed Fluent — absolute, discards drafts
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByAspect().meaning).toEqual({ aspect: 'meaning', quality: 'fluent' });
  });

  it('mnemonic 1+M drafts the row; 1,1 is the All row and completes the word', () => {
    renderRating();
    expand();
    key('1'); key('m');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[1])[0])).toBe(true);
    key('1'); // re-arm the chord
    key('1'); // same digit while pending = All row at that quality
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByAspect().meaning).toEqual({ aspect: 'meaning', quality: 'missed' });
    expect(submittedByAspect().reading).toEqual({ aspect: 'reading', quality: 'missed' });
  });

  it('mnemonic 4+letter is the easy chord; Alt on the chord letter marks inference', () => {
    renderRating({ aspects: ['meaning'] });
    expand();
    key('4'); key('m');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([{ aspect: 'meaning', quality: 'fluent', easy: true }]);

    renderRating({ aspects: ['reading'] });
    expand();
    key('1'); key('r', { altKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toEqual([{ aspect: 'reading', quality: 'missed', method: 'inference' }]);
  });

  it('spatial digits are the All row; q/w/e/r draft the first aspect row', () => {
    renderRating({ keyboardMode: 'spatial' });
    expand();
    key('q'); // first aspect row × missed
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[1])[0])).toBe(true);
    key('r'); // first aspect row × easy (replaces the draft)
    expect(isSelected(rowCells(rows()[1])[3])).toBe(true);
    expect(isSelected(rowCells(rows()[1])[0])).toBe(false);
    key('2'); // digit = All row × struggled → completes the word
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByAspect().meaning).toEqual({ aspect: 'meaning', quality: 'fluent', easy: true });
    expect(submittedByAspect().prosody).toEqual({ aspect: 'prosody', quality: 'struggled' });
  });

  it('spatial 7/8/9/0 rate the fifth displayed row; rows beyond it are keyboard-less', () => {
    renderRating({ keyboardMode: 'spatial', aspects: [...ASPECTS, 'gender'] });
    expand();
    key('7'); // fifth displayed row (Orthography) × missed
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[4])[0])).toBe(true);
    key('9'); // Orthography × fluent
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[4])[2])).toBe(true);
    // Sixth displayed row (Gender) has no keys, only the keyboard-less hint.
    expect(rowCells(rows()[5])[0].textContent).toContain('·');
    key('p'); // not a spatial key — nothing fires
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('resetKey change clears drafts, folds, and re-arms the submitted guard', async () => {
    renderRating({ aspects: ['meaning'] });
    expand();
    rowCells(rows()[1])[0].click(); // its only row → auto-submit
    expect(onSubmit).toHaveBeenCalledTimes(1);
    key('1'); // guard holds
    expect(onSubmit).toHaveBeenCalledTimes(1);

    setResetKey('word-2');
    await Promise.resolve();
    expect(isExpanded()).toBe(false);
    expand();
    expect(isSelected(rowCells(rows()[1])[0])).toBe(false);
    key('Escape');
    barButtons()[0].click(); // guard is re-armed: whole-word rates again
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toEqual([{ aspect: 'meaning', quality: 'missed' }]);
  });
});
