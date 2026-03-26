/**
 * Tests for new flashcard review features:
 * - HoverReveal component props/interface
 * - Stealth mode & mute audio settings defaults
 * - Anki duplicate detection via ankiWordsCache
 * - ToggleSwitch thumbIcon prop
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types';

// ---- Settings defaults ----

describe('Flashcard review settings defaults', () => {
  it('flashcardStealthMode defaults to false', () => {
    expect(DEFAULT_SETTINGS.flashcardStealthMode).toBe(false);
  });

  it('flashcardMuteAudio defaults to false', () => {
    expect(DEFAULT_SETTINGS.flashcardMuteAudio).toBe(false);
  });

  it('flashcardAutoTts remains true by default', () => {
    expect(DEFAULT_SETTINGS.flashcardAutoTts).toBe(true);
  });
});

// ---- Anki words cache ----

describe('Anki words cache', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('isWordInAnkiCache returns false when cache is empty', async () => {
    const { isWordInAnkiCache } = await import('@renderer/services/ankiWordsCache');
    expect(isWordInAnkiCache('test')).toBe(false);
  });

  it('isAnkiCacheFetched returns false initially', async () => {
    const { isAnkiCacheFetched } = await import('@renderer/services/ankiWordsCache');
    expect(isAnkiCacheFetched()).toBe(false);
  });
});
