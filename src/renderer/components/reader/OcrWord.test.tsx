// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { OcrWord } from './OcrWord';
import type { LanguageData, Token } from '../../../shared/types';
import type { ComprehensiveWordStatusResult } from '../../utils/comprehensiveKnowledge';

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
const originalMockLanguageData = mockLanguageData;
const mockGetComprehensiveWordStatusWithSourceSync = vi.fn(
  (): ComprehensiveWordStatusResult => ({ status: 'unknown', source: 'None', timesSeen: 0 }),
);
const mockGetCachedTranslation = vi.fn();

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => 0,
  getCachedReading: () => null,
  getCachedTranslation: (...args: unknown[]) => mockGetCachedTranslation(...args),
}));

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useFlashcards: () => ({
    getWordTrackingSync: () => ({ tracker: 'nothing' as const }),
    trackWordHovered: mockTrackWordHovered,
    cancelWordHover: mockCancelWordHover,
    getComprehensiveWordStatusWithSourceSync: mockGetComprehensiveWordStatusWithSourceSync,
    getAspectStatus: () => ({ status: 'unknown' as const, ease: 0, source: 'None', untracked: true }),
  }),
  useLanguage: () => ({
    currentLangData: () => mockLanguageData,
    langData: {},
    getLanguageFeatures: () => ({
      tokenizerCapabilities: {
        providesLemmas: true,
      },
    }),
    getCanonicalForm: (word: string) => mockGetCanonicalForm(word),
    getWordVariants: (word: string) => [word],
    getReadingVariants: (reading: string) => [reading],
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
    mockGetComprehensiveWordStatusWithSourceSync.mockClear();
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

    it('does not force an inline font-family on the ruby wrapper (reader font stack applies)', () => {
      const dispose = render(() => (
        <OcrWord token={rubyToken} withReadingAnnotation />
      ), container);

      const ruby = container.querySelector('ruby') as HTMLElement;
      expect(ruby).not.toBeNull();
      expect(ruby.getAttribute('style') ?? '').not.toContain('font-family');
      expect(ruby.getAttribute('style')).toContain('unicode-bidi');
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

  describe('colored prosody', () => {
    const coloredSettings: Record<string, unknown> = {
      coloredProsodyEnabled: true,
      enableWordColoring: true,
      colorKnownWords: true,
      do_colour_codes: true,
      colour_codes: {},
      coloredProsodyPalettes: {},
      coloredProsodyStatusLimit: 'known',
      coloredProsodyEaseMixEnabled: false,
      coloredProsodyEaseMixTarget: 'white',
      coloredProsodySaturation: 100,
      coloredProsodyRelevantOnly: false,
    };

    const toneMarkedLanguageData: LanguageData = {
      name: 'Mandarin',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hani', 'Latn'] },
      },
      prosody: {
        type: 'tone',
        coloring: {
          renderer: 'tone-marked-syllables',
          paletteId: 'tones',
          colors: { 'tone-1': '#ff00ff', neutral: '#006eff' },
          labels: {},
        },
      },
    };

    const pitchAccentLanguageData: LanguageData = {
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
      prosody: {
        type: 'japanese-pitch-accent',
        coloring: {
          renderer: 'pitch-accent-category',
          paletteId: 'pitch',
          colors: { heiban: '#00b84a', atamadaka: '#ffa500', nakadaka: '#00aaff', odaka: '#ff0000' },
          labels: {},
        },
      },
    };

    const toneToken: Token = {
      word: '妈妈',
      surface: '妈妈',
      actual_word: '妈妈',
      reading: 'mā ma',
      type: 'noun',
      partOfSpeech: 'noun',
    };

    beforeEach(() => {
      mockLanguageData = toneMarkedLanguageData;
      Object.assign(mockSettings, coloredSettings);
      mockGetCachedTranslation.mockReset();
      mockGetCachedTranslation.mockReturnValue(null);
    });

    afterEach(() => {
      mockLanguageData = originalMockLanguageData;
      for (const key of Object.keys(coloredSettings)) {
        delete mockSettings[key];
      }
    });

    it('colors the word slot via the tone-marked renderer when reading annotations are shown', () => {
      const dispose = render(() => (
        <OcrWord token={toneToken} withReadingAnnotation />
      ), container);

      const segments = container.querySelectorAll<HTMLElement>('.colored-prosody__segment');
      expect(segments).toHaveLength(2);
      expect(segments[0]?.dataset.prosodyValue).toBe('tone-1');
      expect(segments[0]?.style.color).toBe('#ff00ff');
      expect(segments[1]?.dataset.prosodyValue).toBe('neutral');
      expect(container.querySelector('.ocr-word')?.textContent).toBe('妈妈');
      dispose();
    });

    it('colors the word slot through the no-annotation fallback when reading annotations are disabled', () => {
      mockSettings.showReadingAnnotations = false;

      const dispose = render(() => (
        <OcrWord token={toneToken} withReadingAnnotation />
      ), container);

      const segment = container.querySelector<HTMLElement>('.colored-prosody__segment');
      expect(segment).not.toBeNull();
      expect(segment?.dataset.prosodyValue).toBe('tone-1');
      expect(container.querySelector('.ocr-word')?.textContent).toBe('妈妈');
      dispose();
    });

    it('keeps plain text when colored prosody is disabled', () => {
      mockSettings.coloredProsodyEnabled = false;

      const dispose = render(() => <OcrWord token={toneToken} />, container);

      expect(container.querySelector('.colored-prosody__segment')).toBeNull();
      expect(container.querySelector('.ocr-word')?.textContent).toBe('妈妈');
      dispose();
    });

    it('restores old behavior (no reader coloring) when relevantOnly is on', () => {
      mockSettings.coloredProsodyRelevantOnly = true;

      const dispose = render(() => <OcrWord token={toneToken} />, container);

      expect(container.querySelector('.colored-prosody__segment')).toBeNull();
      expect(container.querySelector('.ocr-word')?.textContent).toBe('妈妈');
      dispose();
    });

    it('colors the reading slot via the pitch-accent renderer using the cached prosody position', () => {
      mockLanguageData = pitchAccentLanguageData;
      mockGetCachedTranslation.mockReturnValue({
        data: [
          { definitions: ['when'], reading: 'いつ' },
          undefined,
          { pitches: [{ position: 1 }] },
        ],
      });
      const pitchToken: Token = {
        word: '何時',
        surface: '何時',
        actual_word: '何時',
        reading: 'いつ',
        type: '名詞',
        partOfSpeech: '名詞',
      };

      const dispose = render(() => (
        <OcrWord token={pitchToken} withReadingAnnotation />
      ), container);

      const segment = container.querySelector<HTMLElement>('.colored-prosody__segment');
      expect(segment).not.toBeNull();
      expect(segment?.dataset.prosodyValue).toBe('atamadaka');
      expect(segment?.style.color).toBe('#ffa500');
      dispose();
    });
  });
});
