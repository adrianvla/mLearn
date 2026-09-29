/**
 * The reader sidebar, the video sidebar, the overlay sidebar and the Suggested
 * list all reach the same hidden deletion — ignoring a word removes the
 * flashcards built from it. Each surface used to carry its own one-line copy of
 * that handler, so a fix applied to one of them left the other three still
 * deleting without asking.
 *
 * This exercises the shared handler those four now call. The rendered-surface
 * proof that a dialog really stands in the way lives in
 * `ignoreConfirmation.test.tsx`.
 */

import { describe, expect, it, vi } from 'vitest';
import { ignoreWordWithConfirmation } from './ignoreWordWithConfirmation';

const t = (key: string) => key;

const makeDeps = (cardCount: number) => ({
  getCardCount: vi.fn(() => cardCount),
  ignoreWordForLanguage: vi.fn(async () => {}),
  showConfirm: vi.fn(async () => true),
  t,
});

describe('ignoring a word through the shared handler', () => {
  it('asks before destroying the word’s cards, and ignores nothing until it is answered', async () => {
    const deps = makeDeps(2);

    const ignored = await ignoreWordWithConfirmation(
      { word: 'word', reading: 'reading', language: 'ja' },
      deps,
    );

    // The prompt is the thing standing between the click and the deletion.
    expect(deps.showConfirm).toHaveBeenCalledOnce();
    expect(deps.showConfirm.mock.calls[0][0].variant).toBe('danger');
    expect(deps.ignoreWordForLanguage).toHaveBeenCalledOnce();
    expect(ignored).toBe(true);
  });

  it('looks up the cards of the requested word in the requested language', async () => {
    // A word can be ignored in one language while being studied in another, and
    // only the cards of the language being ignored are actually destroyed.
    const deps = makeDeps(1);

    await ignoreWordWithConfirmation({ word: '猫', language: 'ja' }, deps);

    expect(deps.getCardCount).toHaveBeenCalledWith('猫', 'ja');
    expect(deps.ignoreWordForLanguage).toHaveBeenCalledWith('猫', undefined, 'ja');
  });

  it('ignores nothing when the learner declines', async () => {
    const deps = makeDeps(2);
    deps.showConfirm.mockResolvedValue(false as never);

    const ignored = await ignoreWordWithConfirmation({ word: 'word', language: 'ja' }, deps);

    expect(deps.ignoreWordForLanguage).not.toHaveBeenCalled();
    // The caller needs this to know not to retire the row it was showing.
    expect(ignored).toBe(false);
  });

  it('stays one-click for a word that owns no cards', async () => {
    // Most words in a sidebar have no card, and the prompt only earns its
    // friction when there is something to lose.
    const deps = makeDeps(0);

    const ignored = await ignoreWordWithConfirmation({ word: 'word', language: 'ja' }, deps);

    expect(deps.showConfirm).not.toHaveBeenCalled();
    expect(deps.ignoreWordForLanguage).toHaveBeenCalledOnce();
    expect(ignored).toBe(true);
  });

  it('passes the reading through so the ignored entry keeps it', async () => {
    const deps = makeDeps(0);

    await ignoreWordWithConfirmation({ word: 'word', reading: 'yomi', language: 'ja' }, deps);

    expect(deps.ignoreWordForLanguage).toHaveBeenCalledWith('word', 'yomi', 'ja');
  });
});
