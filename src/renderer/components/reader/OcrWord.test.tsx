// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { OcrWord } from './OcrWord';
import type { Token } from '../../../shared/types';

const mockSettings: Record<string, unknown> = {
  readerWordHoverTrigger: 'hover',
  readerWordHoverKey: 'Alt',
  language: 'ar',
};

const mockTrackWordHovered = vi.fn();
const mockCancelWordHover = vi.fn();
const mockGetCanonicalForm = vi.fn((word: string) => (word === 'يكتب' ? 'كتب' : word));

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useFlashcards: () => ({
    trackWordHovered: mockTrackWordHovered,
    cancelWordHover: mockCancelWordHover,
  }),
  useLanguage: () => ({
    getLanguageFeatures: () => ({
      tokenizerCapabilities: {
        providesLemmas: true,
      },
    }),
  }),
}));

describe('OcrWord', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockTrackWordHovered.mockClear();
    mockCancelWordHover.mockClear();
    mockGetCanonicalForm.mockClear();
  });

  afterEach(() => {
    container.remove();
  });

  const token: Token = {
    word: 'كتب',
    surface: 'يكتب',
    actual_word: 'يكتب',
    reading: 'yaktub',
    type: 'verb',
    partOfSpeech: 'verb',
  };

  it('tracks hover with the tokenizer lookup word instead of pre-canonicalizing in the UI', () => {
    const dispose = render(() => <OcrWord token={token} />, container);

    container.querySelector('.ocr-word')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    expect(mockTrackWordHovered).toHaveBeenCalledWith('يكتب', 'yaktub', 'ar');
    dispose();
  });

  it('cancels hover with the tokenizer lookup word instead of pre-canonicalizing in the UI', () => {
    const dispose = render(() => <OcrWord token={token} />, container);

    const word = container.querySelector('.ocr-word');
    word?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    word?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(mockCancelWordHover).toHaveBeenCalledWith('يكتب', 'ar');
    dispose();
  });
});
