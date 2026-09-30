import { describe, expect, it } from 'vitest';
import { isStaleFlashcardRevision, staleFlashcardRevisionMessage } from './flashcardWriteRevision';

describe('flashcard write revision contract', () => {
  it('builds a refusal message the authority and the client agree on', () => {
    expect(staleFlashcardRevisionMessage(7, 3)).toBe('Stale flashcard store revision: expected 7, received 3');
  });

  it('recognizes a refusal delivered in-process', () => {
    const error = new Error(staleFlashcardRevisionMessage(9, 8));
    expect(isStaleFlashcardRevision(error)).toBe(true);
  });

  it('recognizes a refusal that crossed the IPC boundary', () => {
    // Electron wraps a main-process rejection before handing it to the
    // renderer. Without this the repair path never engages and a repairable
    // write is reported as a failure.
    const wrapped = new Error(
      "Error invoking remote method 'save-flashcards': Error: "
      + staleFlashcardRevisionMessage(9, 8),
    );
    expect(isStaleFlashcardRevision(wrapped)).toBe(true);
  });

  it('recognizes a refusal delivered as a bare string', () => {
    expect(isStaleFlashcardRevision(staleFlashcardRevisionMessage(9, 8))).toBe(true);
  });

  it('leaves other write failures alone', () => {
    expect(isStaleFlashcardRevision(new Error('ENOSPC: no space left on device'))).toBe(false);
    expect(isStaleFlashcardRevision(new Error('EACCES: permission denied'))).toBe(false);
    expect(isStaleFlashcardRevision(undefined)).toBe(false);
    expect(isStaleFlashcardRevision(null)).toBe(false);
    expect(isStaleFlashcardRevision({ message: staleFlashcardRevisionMessage(1, 0) })).toBe(false);
  });
});
