// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { SubtitleWord } from './SubtitleWord';
import type { Token } from '../../../shared/types';

const mockSettings: Record<string, unknown> = {
  blur_words: false,
  blurKnownWords: false,
  furigana: true,
  hideReadingForKnownWords: false,
  language: 'ja',
  readerWordHoverTrigger: 'hover',
  showFurigana: true,
  showPitchAccent: true,
};

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useLanguage: () => ({
    currentLangData: () => ({ code: 'ja' }),
    isTranslatable: () => true,
    getFrequency: () => null,
    getLanguageFeatures: () => ({ supportsReadings: true, supportsPitchAccent: true }),
    getCanonicalForm: (word: string) => word,
  }),
  useFlashcards: () => ({
    isWordKnownComprehensiveSync: () => false,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => 0,
  getCachedReading: () => null,
  getCachedTranslation: () => ({
    data: [
      { definitions: ['when'], reading: 'いつ' },
      undefined,
      { pitches: [{ position: 1 }] },
    ],
  }),
}));

describe('SubtitleWord pitch accent furigana layout', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('marks furigana pitch overlays so accent lines stay within the reading annotation', () => {
    const token: Token = {
      word: '何時',
      surface: '何時',
      actual_word: '何時',
      reading: 'いつ',
      type: '名詞',
      partOfSpeech: '名詞',
    };

    const dispose = render(() => (
      <SubtitleWord token={token} index={0} />
    ), container);

    const rubyOverlay = container.querySelector('rt .pitch-overlay-wrapper');
    expect(rubyOverlay).not.toBeNull();
    expect(rubyOverlay!.classList.contains('pitch-overlay-wrapper--ruby')).toBe(true);
    expect(rubyOverlay!.textContent).toContain('いつ');
    expect(container.querySelector('rt .pitch-accent')).not.toBeNull();

    dispose();
  });
});
