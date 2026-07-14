// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { SubtitleWord } from './SubtitleWord';
import type { LanguageData, Token } from '../../../shared/types';

const mockSettings: Record<string, unknown> = {
  blur_words: false,
  blurKnownWords: false,
  showReadingAnnotations: true,
  hideReadingForKnownWords: false,
  language: 'ja',
  readerWordHoverTrigger: 'hover',
  showProsody: true,
};

const mockIsWordKnownComprehensiveSync = vi.fn(() => false);
const mockGetFrequency = vi.fn(() => null as { raw_level: number; level: string } | null);
const mockGetFreqLevelNames = vi.fn(() => ({} as Record<string, string>));
const mockGetCachedTranslation = vi.fn();
let mockLanguageData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
    prosody: {
    type: 'japanese-pitch-accent',
  },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
    readingAnnotation: {
      type: 'script-reading',
      annotationScripts: ['Han'],
      surfaceSuffixScripts: ['Hira', 'Kana'],
      readingSeparator: '',
      stripParentheticalReadings: true,
    },
  },
};

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useLanguage: () => ({
    currentLangData: () => mockLanguageData,
    isTranslatable: () => true,
    isTokenTranslatable: () => true,
    getFrequency: mockGetFrequency,
    getFreqLevelNames: mockGetFreqLevelNames,
    getLanguageFeatures: () => ({
      supportsReadings: Boolean(mockLanguageData.textProcessing?.readingAnnotation?.annotationScripts?.length),
      prosodyRenderer: mockLanguageData.prosody?.type === 'japanese-pitch-accent' ? 'japanese-pitch-accent' : undefined,
    }),
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getReadingVariants: (reading: string) => [reading],
  }),
  useFlashcards: () => ({
    isWordKnownComprehensiveSync: mockIsWordKnownComprehensiveSync,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => 0,
  getCachedReading: () => null,
  getCachedTranslation: (...args: unknown[]) => mockGetCachedTranslation(...args),
}));

describe('SubtitleWord pitch accent reading annotation layout', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockIsWordKnownComprehensiveSync.mockClear();
    mockGetFrequency.mockReset();
    mockGetFrequency.mockReturnValue(null);
    mockGetFreqLevelNames.mockReset();
    mockGetFreqLevelNames.mockReturnValue({});
    mockGetCachedTranslation.mockReset();
    mockGetCachedTranslation.mockReturnValue({
      data: [
        { definitions: ['when'], reading: 'いつ' },
        undefined,
        { pitches: [{ position: 1 }] },
      ],
    });
    mockSettings.language = 'ja';
    mockLanguageData = {
      name: 'Japanese',
      settings: { fixed: {} },
            prosody: {
        type: 'japanese-pitch-accent',
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
          readingSeparator: '',
          stripParentheticalReadings: true,
        },
      },
    };
  });

  afterEach(() => {
    container.remove();
  });

  it('marks ruby pitch overlays so accent lines stay within the reading annotation', () => {
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
    expect(rubyOverlay!.classList.contains('prosody-overlay-wrapper--reading')).toBe(true);
    expect(rubyOverlay!.textContent).toBe('いつ');
    expect(container.querySelector('rt .pitch-accent')).not.toBeNull();

    dispose();
  });

  it('looks up ruby prosody by the surface word while drawing it over the reading', () => {
    mockGetCachedTranslation.mockImplementation((word: string) => (
      word === '望月'
        ? {
            data: [
              { definitions: ['full moon'], reading: 'もちづき' },
              undefined,
              { reading: 'もちづき', pitches: [{ position: 2 }] },
            ],
          }
        : null
    ));
    const token: Token = {
      word: '望月',
      surface: '望月',
      actual_word: '望月',
      reading: 'もちづき',
      type: '名詞',
      partOfSpeech: '名詞',
    };

    const dispose = render(() => (
      <SubtitleWord token={token} index={0} />
    ), container);

    expect(mockGetCachedTranslation).toHaveBeenCalledWith('望月', 'ja', expect.anything());
    expect(container.querySelector('rt .pitch-accent')).not.toBeNull();

    dispose();
  });

  it('does not add ruby readings to tokens already written in reading script', () => {
    const token: Token = {
      word: 'から',
      surface: 'から',
      actual_word: 'から',
      reading: 'から',
      type: '助詞',
      partOfSpeech: '助詞',
    };

    const dispose = render(() => (
      <SubtitleWord token={token} index={0} />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('rt')).toBeNull();
    expect(container.querySelector('.subtitle-word')?.textContent).toBe('から');
    dispose();
  });

  it('checks known status using the current learning language', () => {
    mockSettings.language = 'ar';
    const token: Token = {
      word: 'يكتب',
      surface: 'يكتب',
      actual_word: 'يكتب',
      reading: 'yaktub',
      type: 'noun',
      partOfSpeech: 'noun',
    };

    const dispose = render(() => (
      <SubtitleWord token={token} index={0} />
    ), container);

    expect(mockIsWordKnownComprehensiveSync).toHaveBeenCalledWith('يكتب', 'ar');
    dispose();
  });

  it('uses metadata-selected inline reading annotations for subtitles', () => {
    mockSettings.language = 'ar';
    mockLanguageData = {
      name: 'Arabic',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        readingAnnotation: {
          type: 'script-reading',
          display: 'inline',
          annotationScripts: ['Arab'],
        },
      },
    };
    const token: Token = {
      word: 'بيت',
      surface: 'بيت',
      actual_word: 'بيت',
      reading: 'bayt',
      type: 'noun',
      partOfSpeech: 'noun',
    };

    const dispose = render(() => (
      <SubtitleWord token={token} index={0} />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('.ruby-text-inline')).not.toBeNull();
    expect(container.textContent).toContain('بيت');
    expect(container.textContent).toContain('bayt');
    dispose();
  });

  it('renders non-Japanese words without the Japanese pitch overlay wrapper', () => {
    mockSettings.language = 'de';
    mockLanguageData = {
      name: 'German',
      settings: { fixed: {} },
          };
    const token: Token = {
      word: 'Haus',
      surface: 'Haus',
      actual_word: 'Haus',
      type: 'noun',
      partOfSpeech: 'noun',
    };

    const dispose = render(() => (
      <SubtitleWord token={token} index={0} />
    ), container);

    expect(container.querySelector('.subtitle-word')?.textContent).toContain('Haus');
    expect(container.querySelector('.pitch-overlay-wrapper')).toBeNull();
    dispose();
  });

  it('maps frequency stars through derived level names for higher-is-harder languages', () => {
    mockSettings.language = 'xx';
    mockLanguageData = {
      name: 'CEFR-like Language',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
      frequencyLevels: {
        difficulty: 'higher-is-harder',
      },
    };
    mockGetFrequency.mockReturnValue({ raw_level: 4, level: 'B2' });
    mockGetFreqLevelNames.mockReturnValue({
      '1': 'A1',
      '2': 'A2',
      '3': 'B1',
      '4': 'B2',
    });
    const token: Token = {
      word: 'advanced',
      surface: 'advanced',
      actual_word: 'advanced',
      reading: 'advanced',
      type: 'noun',
      partOfSpeech: 'noun',
    };

    const dispose = render(() => (
      <SubtitleWord token={token} index={0} />
    ), container);

    const stars = container.querySelector('.frequency');
    expect(stars).not.toBeNull();
    expect(stars!.getAttribute('data-raw-level')).toBe('4');
    expect(stars!.getAttribute('data-level')).toBe('1');
    expect(stars!.querySelectorAll('.star')).toHaveLength(1);
    dispose();
  });
});
