// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { OcrWord } from './OcrWord';
import type { AccessStatusResult } from '../../utils/accessKnowledge';
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
  (): ComprehensiveWordStatusResult => ({ status: 'unknown', basis: 'unmeasured', evidenceStatus: 'unknown', source: 'None', timesSeen: 0 }),
);
const mockGetAccessStatus = vi.fn<() => AccessStatusResult>(() => ({ status: 'unknown', ease: 0, source: 'None', untracked: true }));
const mockGetCachedTranslation = vi.fn();
const mockCacheState = vi.hoisted(() => ({ read: (): number => 0, bump: (): void => {} }));

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => mockCacheState.read(),
  getCachedReading: () => null,
  getCachedTranslation: (...args: unknown[]) => mockGetCachedTranslation(...args),
}));

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    trackWordHovered: mockTrackWordHovered,
    cancelWordHover: mockCancelWordHover,
    getComprehensiveWordStatusWithSourceSync: mockGetComprehensiveWordStatusWithSourceSync,
    getAccessStatus: mockGetAccessStatus,
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
    const [read, set] = createSignal(0);
    mockCacheState.read = read;
    mockCacheState.bump = () => set((version) => version + 1);
    container = document.createElement('div');
    document.body.appendChild(container);
    mockGetAccessStatus.mockReset();
    mockGetAccessStatus.mockReturnValue({ status: 'unknown', ease: 0, source: 'None', untracked: true });
    mockSettings.showReadingAnnotations = true;
    mockSettings.readerWordHoverTrigger = 'hover';
    mockSettings.readerWordHoverKey = 'Alt';
    mockTrackWordHovered.mockClear();
    mockCancelWordHover.mockClear();
    mockGetCanonicalForm.mockClear();
    mockGetComprehensiveWordStatusWithSourceSync.mockClear();
    mockGetCachedTranslation.mockReset();
    mockGetCachedTranslation.mockReturnValue(null);
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

  it('reads the exact presented access separately from lexical meaning', () => {
    mockGetComprehensiveWordStatusWithSourceSync.mockReturnValue({ status: 'known', basis: 'claim', evidenceStatus: 'unknown', source: 'Manual', timesSeen: 0 });
    mockGetAccessStatus.mockReturnValueOnce({ status: 'unknown', ease: 0, source: 'None', untracked: true })
      .mockReturnValueOnce({ status: 'known', ease: 2.5, source: 'Manual' });
    const dispose = render(() => <OcrWord token={token} />, container);
    expect(mockGetAccessStatus).toHaveBeenCalledWith('يكتب', 'surface-recognition', 'ar');
    expect(mockGetAccessStatus).toHaveBeenCalledWith('يكتب', 'sense-recognition', 'ar');
    dispose();
  });

  it('does not admit a lookup when key-hover has no key held, even past the passive dwell delay', () => {
    vi.useFakeTimers();
    mockSettings.readerWordHoverTrigger = 'key-hover';
    const onWordEnter = vi.fn();
    const dispose = render(() => <OcrWord token={token} onWordEnter={onWordEnter} />, container);

    const word = container.querySelector('.ocr-word')!;
    word.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(500);

    expect(onWordEnter).not.toHaveBeenCalled();
    expect(mockTrackWordHovered).not.toHaveBeenCalled();
    expect(mockCancelWordHover).not.toHaveBeenCalled();
    dispose();
    vi.useRealTimers();
  });

  it('does not admit a long-hover cancelled at 400 ms before the 500 ms reveal', () => {
    vi.useFakeTimers();
    mockSettings.readerWordHoverTrigger = 'long-hover';
    const onWordEnter = vi.fn();
    const dispose = render(() => <OcrWord token={token} onWordEnter={onWordEnter} />, container);

    const word = container.querySelector('.ocr-word')!;
    word.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(400);
    word.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(200);

    expect(onWordEnter).not.toHaveBeenCalled();
    expect(mockTrackWordHovered).not.toHaveBeenCalled();
    expect(mockCancelWordHover).not.toHaveBeenCalled();
    dispose();
    vi.useRealTimers();
  });

  it('opens a qualified long-hover once and passes tracking eligibility to the owner', () => {
    vi.useFakeTimers();
    mockSettings.readerWordHoverTrigger = 'long-hover';
    const onWordEnter = vi.fn();
    const dispose = render(() => <OcrWord token={token} onWordEnter={onWordEnter} />, container);

    const word = container.querySelector('.ocr-word')!;
    word.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(500);
    word.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    word.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    expect(onWordEnter).toHaveBeenCalledOnce();
    expect(onWordEnter.mock.calls[0]?.[0].surface).toBe('يكتب');
    expect(onWordEnter.mock.calls[0]?.[2]).toBe(true);
    expect(mockTrackWordHovered).not.toHaveBeenCalled();
    dispose();
    vi.useRealTimers();
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
    expect(onWordEnter.mock.calls[0]?.[2]).toBe(false);
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

    it('uses a corrected interpretation for the inline reading and passes its encounter context', () => {
      const context = { surface: rubyToken.word, text: 'synthetic encounter', hints: { arbitrary: { value: 7 } } };
      mockGetCachedTranslation.mockImplementation((_word, _language, options) => options.context === context
        ? { data: [{ word: rubyToken.word, reading: 'corrected' }], resolution: { selectedId: 'chosen', basis: 'learner-selection', candidates: [] } }
        : null);
      const dispose = render(() => <OcrWord token={rubyToken} lookupContext={context} withReadingAnnotation />, container);
      expect(container.querySelector('rt')?.textContent).toBe('corrected');
      dispose();
      mockGetCachedTranslation.mockReset();
    });

    it('keeps a source-authored reading even when the dictionary cache resolves another reading', () => {
      mockGetCachedTranslation.mockReturnValueOnce({
        data: [{ word: '端', reading: 'はし' }],
        resolution: { selectedId: 'dictionary', basis: 'dictionary', candidates: [] },
      });
      const sourceToken: Token = { word: '端', actual_word: '端', type: '名詞', reading: 'ば' };
      const dispose = render(() => (
        <OcrWord token={sourceToken} authoredReading="ば" withReadingAnnotation />
      ), container);
      expect(container.querySelector('rt')?.textContent).toBe('ば');
      dispose();
    });

    it('keeps publisher-authored ruby visible when generated annotations are disabled', () => {
      mockSettings.showReadingAnnotations = false;
      const sourceToken: Token = { word: '端', actual_word: '端', type: '名詞', reading: 'ば' };
      const dispose = render(() => (
        <OcrWord token={sourceToken} authoredReading="ば" withReadingAnnotation />
      ), container);
      expect(container.querySelector('rt')?.textContent).toBe('ば');
      dispose();
    });

    it('keeps the occurrence reading through hover and an asynchronous dictionary-cache refresh', () => {
      const onWordEnter = vi.fn();
      const sourceToken: Token = { word: '端', actual_word: '端', type: '名詞', reading: 'はし' };
      mockGetCachedTranslation.mockReturnValue(null);
      const dispose = render(() => (
        <OcrWord token={sourceToken} authoredReading="ば" withReadingAnnotation onWordEnter={onWordEnter} />
      ), container);

      const word = container.querySelector('.ocr-word')!;
      expect(container.querySelector('rt')?.textContent).toBe('ば');
      word.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(mockTrackWordHovered).not.toHaveBeenCalled();
      expect(onWordEnter.mock.calls[0]?.[0].reading).toBe('ば');
      expect(onWordEnter.mock.calls[0]?.[2]).toBe(true);

      mockGetCachedTranslation.mockReturnValue({
        data: [{ word: '端', reading: 'はし' }],
        resolution: { selectedId: 'dictionary', basis: 'dictionary', candidates: [] },
      });
      mockCacheState.bump();
      expect(container.querySelector('rt')?.textContent).toBe('ば');

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
      expect(segments[0]?.style.getPropertyValue('--language-word-ink')).toBe('color-mix(in srgb, #ff00ff 40%, var(--language-word-foreground))');
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
      expect(segment?.style.getPropertyValue('--language-word-ink')).toBe('color-mix(in srgb, #ffa500 40%, var(--language-word-foreground))');
      dispose();
    });
  });
});
