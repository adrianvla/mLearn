// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { OcrWord } from './OcrWord';
import type { LanguageData, Token } from '../../../shared/types';

const mockSettings: Record<string, unknown> = {
  readerWordHoverTrigger: 'hover',
  readerWordHoverKey: 'Alt',
  showReadingAnnotations: true,
  language: 'ar',
};

// Annotation-capable metadata fixture: Han script requires readings, rendered as ruby.
let mockLanguageData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
    readingAnnotation: {
      type: 'script-reading',
      display: 'ruby',
      annotationScripts: ['Han'],
      surfaceSuffixScripts: ['Hira', 'Kana'],
      readingSeparator: '',
      stripParentheticalReadings: true,
    },
  },
};

const mockTrackWordHovered = vi.fn();
const mockCancelWordHover = vi.fn();
const mockGetCanonicalForm = vi.fn((word: string) => (word === 'يكتب' ? 'كتب' : word));

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useFlashcards: () => ({
    getWordTrackingSync: () => ({ tracker: 'nothing' as const }),
    trackWordHovered: mockTrackWordHovered,
    cancelWordHover: mockCancelWordHover,
  }),
  useLanguage: () => ({
    currentLangData: () => mockLanguageData,
    langData: {},
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
    mockSettings.showReadingAnnotations = true;
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

  it('can provide immediate hover without passively tracking an untokenized fallback', () => {
    const onWordEnter = vi.fn();
    const dispose = render(() => (
      <OcrWord
        token={token}
        onWordEnter={onWordEnter}
        trackPassiveHover={false}
      />
    ), container);

    container.querySelector('.ocr-word')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    expect(onWordEnter).toHaveBeenCalledOnce();
    expect(mockTrackWordHovered).not.toHaveBeenCalled();
    dispose();
  });

  describe('opt-in reading annotations', () => {
    const rubyToken: Token = {
      word: '豚',
      actual_word: '豚',
      type: '名詞',
      reading: 'ぶた',
    };

    it('renders plain text when the withReadingAnnotation prop is omitted (OCR overlay regression)', () => {
      const dispose = render(() => <OcrWord token={rubyToken} />, container);

      expect(container.querySelector('ruby')).toBeNull();
      expect(container.querySelector('.ocr-word')?.textContent).toBe('豚');
      dispose();
    });

    it('renders ruby with the reading when enabled and the metadata supports it', () => {
      const dispose = render(() => (
        <OcrWord token={rubyToken} withReadingAnnotation />
      ), container);

      const ruby = container.querySelector('ruby');
      expect(ruby).not.toBeNull();
      expect(ruby!.querySelector('rt')?.textContent).toBe('ぶた');
      expect(ruby!.textContent).toContain('豚');
      dispose();
    });

    it('renders no ruby when showReadingAnnotations is disabled', () => {
      mockSettings.showReadingAnnotations = false;

      const dispose = render(() => (
        <OcrWord token={rubyToken} withReadingAnnotation />
      ), container);

      expect(container.querySelector('ruby')).toBeNull();
      expect(container.querySelector('.ocr-word')?.textContent).toBe('豚');
      dispose();
    });

    it('renders no reading when the reading equals the surface word', () => {
      const sameReadingToken: Token = {
        word: '豚',
        actual_word: '豚',
        type: '名詞',
        reading: '豚',
      };

      const dispose = render(() => (
        <OcrWord token={sameReadingToken} withReadingAnnotation />
      ), container);

      expect(container.querySelector('rt')).toBeNull();
      expect(container.querySelector('.ocr-word')?.textContent).toBe('豚');
      dispose();
    });

    it('renders plain text without crashing when the token has no reading', () => {
      const noReadingToken: Token = {
        word: '豚',
        actual_word: '豚',
        type: '名詞',
      };

      const dispose = render(() => (
        <OcrWord token={noReadingToken} withReadingAnnotation />
      ), container);

      expect(container.querySelector('ruby')).toBeNull();
      expect(container.querySelector('.ocr-word')?.textContent).toBe('豚');
      dispose();
    });
  });
});
