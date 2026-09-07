// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { WordSyncRating, type WordSyncStatement } from './WordSyncRating';
import type { ProfileObservation } from '../../components/common';
import type { CapabilityKind } from '../../../shared/graph/types';
import type { RatingKeyboardMode } from '../../../shared/constants';

const mockT = (key: string): string => key;

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: mockT }),
}));

describe('WordSyncRating', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | null = null;
  const onSubmit = vi.fn();
  const onStatement = vi.fn();
  // Display order mirrors production rows: sense, reading, prosody, written.
  const CAPABILITIES = ['sense-recognition', 'surface-reading', 'prosodic-pattern', 'surface-recognition'] as const;
  // The accesses a collapsed whole-word rating MEASURES: prosody has no task
  // in the presentation flow, so it never receives fabricated evidence.
  const MEASURED = CAPABILITIES.filter((capability) => capability !== 'prosodic-pattern');
  const [resetKey, setResetKey] = createSignal('word-1');

  const key = (k: string, opts: KeyboardEventInit = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...opts }));
  };

  interface RenderOptions {
    keyboardMode?: RatingKeyboardMode;
    accesses?: readonly CapabilityKind[];
    armed?: boolean;
    hasSpokenForm?: boolean;
    hasCharacterComponents?: boolean;
  }

  const renderRating = (options: RenderOptions = {}) => {
    dispose?.();
    dispose = render(
      () => (
        <WordSyncRating
          accesses={options.accesses ?? CAPABILITIES}
          keyboardMode={options.keyboardMode ?? 'mnemonic'}
          armed={options.armed ?? true}
          resetKey={resetKey()}
          hasSpokenForm={options.hasSpokenForm ?? true}
          hasCharacterComponents={options.hasCharacterComponents ?? false}
          onSubmit={(observations, opts) => onSubmit(observations, opts)}
          onStatement={(statement) => onStatement(statement)}
        />
      ),
      container,
    );
  };

  const adjustButton = () => container.querySelector<HTMLButtonElement>('.word-sync-rating__adjust')!;
  const expand = () => adjustButton().click();
  const isExpanded = () => adjustButton().getAttribute('aria-expanded') === 'true';
  const barButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.word-sync-rating__quality'));
  // Unfolded rows in order: All row first, then one row per access.
  const rows = () => Array.from(container.querySelectorAll('.word-sync-rating__row'));
  const rowCells = (row: Element) => Array.from(row.querySelectorAll<HTMLButtonElement>('.word-sync-rating__cell'));
  const isSelected = (cell: HTMLButtonElement) => cell.className.includes('word-sync-rating__cell--selected');
  const statements = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.word-sync-rating__statement'));
  const submittedByCapability = () =>
    Object.fromEntries(
      ((onSubmit.mock.calls[0]?.[0] as readonly ProfileObservation[] | undefined) ?? []).map((o) => [o.capability, o]),
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

  it('collapsed quality clicks submit only the MEASURED accesses, exactly once', () => {
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
      expect(onSubmit.mock.calls[0][0]).toEqual(MEASURED.map((capability) => ({ capability, ...evidence })));
      expect(onSubmit.mock.calls[0][1]).toEqual(index === 3 ? { easy: true } : undefined);
      // Acceptance C: prosody is never fabricated by the whole-word action.
      expect(submittedByCapability()['prosodic-pattern']).toBeUndefined();
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
      expect(onSubmit.mock.calls[0][0]).toEqual(MEASURED.map((capability) => ({ capability, ...evidence })));
    }
  });

  it('collapsed digits work in spatial mode too; Alt marks inference on the whole set', () => {
    renderRating({ keyboardMode: 'spatial' });
    key('1', { altKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(
      MEASURED.map((capability) => ({ capability, quality: 'missed', method: 'inference' })),
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

  it('Adjust unfolds in place: All row first, then exactly the tested access rows', () => {
    renderRating({ accesses: ['sense-recognition', 'surface-reading'] });
    expect(isExpanded()).toBe(false);
    expand();
    expect(isExpanded()).toBe(true);
    const allRows = rows();
    expect(allRows.length).toBe(3);
    expect(allRows[0].textContent).toContain('mlearn.WordSync.Rating.AllRow');
    expect(allRows[1].textContent).toContain('mlearn.Knowledge.Capability.sense-recognition');
    expect(allRows[2].textContent).toContain('mlearn.Knowledge.Capability.surface-reading');
  });

  it('an access cell only drafts — partial states never submit', () => {
    renderRating();
    expand();
    rowCells(rows()[1])[0].click(); // Sense × Missed
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[1])[0])).toBe(true);
    expect(isSelected(rowCells(rows()[1])[2])).toBe(false);
  });

  it('All-row click fills only unresolved accesses (explicit drafts stand) and completes the word', () => {
    renderRating();
    expand();
    rowCells(rows()[1])[0].click(); // Sense × Missed draft
    rowCells(rows()[0])[2].click(); // All × Fluent
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByCapability()['sense-recognition']).toEqual({ capability: 'sense-recognition', quality: 'missed' });
    expect(submittedByCapability()['surface-reading']).toEqual({ capability: 'surface-reading', quality: 'fluent' });
    // All is an explicit everything-rating: it covers every tested access.
    expect(onSubmit.mock.calls[0][0]).toHaveLength(CAPABILITIES.length);
  });

  it('All-row Easy fills fluent+easy and reports the scheduler preference', () => {
    renderRating();
    expand();
    rowCells(rows()[0])[3].click(); // All × Easy
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(CAPABILITIES.map((capability) => ({ capability, quality: 'fluent', easy: true })));
    expect(onSubmit.mock.calls[0][1]).toEqual({ easy: true });
  });

  it('Alt on the All row marks only the FILLED accesses as inference', () => {
    renderRating();
    expand();
    rowCells(rows()[1])[0].click(); // Sense × Missed (explicit, no method)
    rowCells(rows()[0])[2].dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true })); // All × Fluent + Alt
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByCapability()['sense-recognition']).toEqual({ capability: 'sense-recognition', quality: 'missed' });
    expect(submittedByCapability()['surface-reading']).toEqual({ capability: 'surface-reading', quality: 'fluent', method: 'inference' });
    expect(onSubmit.mock.calls[0][1]).toEqual({ method: 'inference' });
  });

  it('an explicit prosody row is measurable — the task is only defaulted away, never hidden', () => {
    renderRating();
    expand();
    // Prosody row (third access row) explicit draft + complete the rest via All.
    rowCells(rows()[3])[1].click(); // Prosody × Struggled
    rowCells(rows()[0])[2].click(); // All × Fluent
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByCapability()['prosodic-pattern']).toEqual({ capability: 'prosodic-pattern', quality: 'struggled' });
  });

  it('manual completion of every access auto-submits exactly once; extra keystrokes are guarded', () => {
    renderRating();
    expand();
    key('1'); key('m'); // sense missed
    key('2'); key('r'); // reading struggled
    key('3'); key('p'); // prosody fluent
    expect(onSubmit).not.toHaveBeenCalled();
    key('4'); key('w'); // written easy → set complete
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByCapability()['sense-recognition']).toEqual({ capability: 'sense-recognition', quality: 'missed' });
    expect(submittedByCapability()['surface-reading']).toEqual({ capability: 'surface-reading', quality: 'struggled' });
    expect(submittedByCapability()['prosodic-pattern']).toEqual({ capability: 'prosodic-pattern', quality: 'fluent' });
    expect(submittedByCapability()['surface-recognition']).toEqual({ capability: 'surface-recognition', quality: 'fluent', easy: true });
    // Same-tick strays cannot double-fire.
    key('1'); key('m');
    key('3');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a single-access word auto-submits on its one rating', () => {
    renderRating({ accesses: ['sense-recognition'] });
    expand();
    rowCells(rows()[1])[2].click(); // Sense × Fluent — its only row completes
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([{ capability: 'sense-recognition', quality: 'fluent' }]);
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
    rowCells(rows()[1])[0].click(); // Sense × Missed draft
    key('Escape'); // fold (no pending chord)
    expand();
    expect(isSelected(rowCells(rows()[1])[0])).toBe(true);
    key('Escape');
    barButtons()[2].click(); // collapsed Fluent — absolute, discards drafts
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByCapability()['sense-recognition']).toEqual({ capability: 'sense-recognition', quality: 'fluent' });
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
    expect(submittedByCapability()['sense-recognition']).toEqual({ capability: 'sense-recognition', quality: 'missed' });
    expect(submittedByCapability()['surface-reading']).toEqual({ capability: 'surface-reading', quality: 'missed' });
  });

  it('mnemonic 4+letter is the easy chord; Alt on the chord letter marks inference', () => {
    renderRating({ accesses: ['sense-recognition'] });
    expand();
    key('4'); key('m');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([{ capability: 'sense-recognition', quality: 'fluent', easy: true }]);

    renderRating({ accesses: ['surface-reading'] });
    expand();
    key('1'); key('r', { altKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toEqual([{ capability: 'surface-reading', quality: 'missed', method: 'inference' }]);
  });

  it('spatial digits are the All row; q/w/e/r draft the first access row', () => {
    renderRating({ keyboardMode: 'spatial' });
    expand();
    key('q'); // first access row × missed
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[1])[0])).toBe(true);
    key('r'); // first access row × easy (replaces the draft)
    expect(isSelected(rowCells(rows()[1])[3])).toBe(true);
    expect(isSelected(rowCells(rows()[1])[0])).toBe(false);
    key('2'); // digit = All row × struggled → completes the word
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submittedByCapability()['sense-recognition']).toEqual({ capability: 'sense-recognition', quality: 'fluent', easy: true });
    expect(submittedByCapability()['prosodic-pattern']).toEqual({ capability: 'prosodic-pattern', quality: 'struggled' });
  });

  it('spatial 7/8/9/0 rate the fifth displayed row; rows beyond it are keyboard-less', () => {
    renderRating({ keyboardMode: 'spatial', accesses: [...CAPABILITIES, 'gender'] });
    expand();
    key('7'); // fifth displayed row (Written form) × missed
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[4])[0])).toBe(true);
    key('9'); // Written form × fluent
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isSelected(rowCells(rows()[4])[2])).toBe(true);
    // Sixth displayed row (Gender) has no keys, only the keyboard-less hint.
    expect(rowCells(rows()[5])[0].textContent).toContain('·');
    key('p'); // not a spatial key — nothing fires
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('resetKey change clears drafts, folds, and re-arms the submitted guard', async () => {
    renderRating({ accesses: ['sense-recognition'] });
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
    expect(onSubmit.mock.calls[1][0]).toEqual([{ capability: 'sense-recognition', quality: 'missed' }]);
  });

  it('natural statements emit onStatement instead of observations', () => {
    renderRating({ accesses: ['sense-recognition', 'surface-recognition'] });
    expand();
    const chips = statements();
    // Order: known-spoken (hasSpokenForm), meaning-not-form, never-seen,
    // inferred-from-parts. No pitch/characters without data.
    expect(chips.length).toBe(4);
    chips[1].click();
    expect(onStatement).toHaveBeenCalledTimes(1);
    expect(onStatement.mock.calls[0][0]).toEqual({ kind: 'known-meaning-unknown-form' } satisfies WordSyncStatement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('statement availability follows the word data: pitch needs prosody, characters need the graph', () => {
    renderRating({ accesses: ['sense-recognition', 'surface-reading'], hasSpokenForm: false, hasCharacterComponents: false });
    expand();
    const kinds = statements().map((chip) => chip.textContent);
    expect(kinds).toContain('mlearn.WordSync.Statement.MeaningNotForm');
    expect(kinds).toContain('mlearn.WordSync.Statement.NeverSeenForm');
    expect(kinds).toContain('mlearn.WordSync.Statement.InferredFromParts');
    expect(kinds).not.toContain('mlearn.WordSync.Statement.KnownSpoken');
    expect(kinds).not.toContain('mlearn.WordSync.Statement.ReadablePitchWrong');
    expect(kinds).not.toContain('mlearn.WordSync.Statement.KnownCharacters');

    renderRating({
      accesses: ['sense-recognition', 'surface-reading', 'prosodic-pattern'],
      hasSpokenForm: true,
      hasCharacterComponents: true,
    });
    expand();
    const full = statements().map((chip) => chip.textContent);
    expect(full).toContain('mlearn.WordSync.Statement.KnownSpoken');
    expect(full).toContain('mlearn.WordSync.Statement.ReadablePitchWrong');
    expect(full).toContain('mlearn.WordSync.Statement.KnownCharacters');
  });
  it('statements complete the word; the submitted guard makes repeats inert', () => {
    renderRating({ accesses: ['sense-recognition'] });
    expand();
    statements()[0].click();
    expect(onStatement).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    // After submit the guard blocks both channels; chips render disabled.
    expect(statements().every((chip) => chip.disabled)).toBe(true);
    statements()[0].click();
    key('3'); // submitted guard absorbs strays
    expect(onStatement).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
