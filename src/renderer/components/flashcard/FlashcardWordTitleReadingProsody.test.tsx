// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { LanguageData } from '../../../shared/types';
import { FlashcardWordTitle } from './FlashcardWordTitle';

let mockLanguageData: LanguageData | null = null;
let mockLanguageMap: Record<string, LanguageData> = {};
let mockHasProsodyOverlay = false;
const mockGetCachedTranslation = vi.fn();
const mockGetCanonicalFormForLanguage = vi.fn((language: string, word: string) => `${language}:${word}:canonical`);
const mockGetWordVariantsForLanguage = vi.fn((language: string, word: string) => [`${language}:${word}:variant`]);

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: {
      language: 'de',
      uiLanguage: 'en',
      dictionaryTargetLanguages: {
        de: 'en',
        ja: 'fr',
      },
      showProsody: true,
    },
  }),
  useLanguage: () => ({
    langData: mockLanguageMap,
    currentLangData: () => mockLanguageData,
    getLanguageFeatures: () => ({
      prosodyRenderer: mockHasProsodyOverlay ? 'japanese-pitch-accent' : undefined,
    }),
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getCanonicalFormForLanguage: mockGetCanonicalFormForLanguage,
    getWordVariantsForLanguage: mockGetWordVariantsForLanguage,
  }),
  useLocalization: () => ({
    t: (key: string) => {
      if (key === 'mlearn.CardEditor.Fields.ProsodyPosition') return 'Prosody position';
      return key;
    },
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => 0,
  getCachedTranslation: (...args: unknown[]) => mockGetCachedTranslation(...args),
}));

function makeLanguageData(overrides: Partial<LanguageData>): LanguageData {
  return {
    name: 'Test language',
    settings: { fixed: {} },
    ...overrides,
  };
}

describe('FlashcardWordTitle', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockHasProsodyOverlay = false;
    mockGetCachedTranslation.mockReturnValue(null);
    mockGetCachedTranslation.mockClear();
    mockGetCanonicalFormForLanguage.mockClear();
    mockGetWordVariantsForLanguage.mockClear();
    mockLanguageData = makeLanguageData({
      name: 'German',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    });
    mockLanguageMap = {};
  });

  afterEach(() => {
    container.remove();
  });

  it('does not force ruby reading annotations for languages without reading annotation metadata', () => {
    const dispose = render(() => (
      <FlashcardWordTitle content={{
        type: 'word',
        front: 'Haus',
        reading: 'haʊs',
        back: 'house',
      }} />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.textContent).toContain('Haus');
    expect(container.textContent).not.toContain('haʊs');

    dispose();
  });

  it('does not treat generic prosody payloads as Japanese reading annotations', () => {
    mockLanguageData = makeLanguageData({
      name: 'Tone language',
            prosody: { type: 'tone-contour' },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
        readingAnnotation: { type: 'none' },
      },
    });

    const dispose = render(() => (
      <FlashcardWordTitle content={{
        type: 'word',
        front: '你好',
        reading: 'ni hao',
        back: 'hello',
        prosody: {
          type: 'tone-contour',
          raw: { toneNumbers: [3, 3] },
        },
      }} />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.textContent).toContain('你好');
    expect(container.textContent).not.toContain('ni hao');

    dispose();
  });

  it('does not render stale legacy pitch fields for package-defined prosody payloads', () => {
    mockLanguageData = makeLanguageData({
      name: 'Tone language',
            prosody: { type: 'tone-contour' },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
        readingAnnotation: { type: 'none' },
      },
    });

    const dispose = render(() => (
      <FlashcardWordTitle content={{
        type: 'word',
        front: '妈',
        reading: 'ma1',
        back: 'mother',
        prosody: {
          type: 'tone-contour',
          raw: { tone: 'high-level' },
        },
      }} />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('.pitch-accent')).toBeNull();
    expect(container.textContent).toContain('妈');
    expect(container.textContent).not.toContain('ma1');

    dispose();
  });

  it('keeps forced reading annotations for languages that declare them', () => {
    mockHasProsodyOverlay = true;
    mockLanguageData = makeLanguageData({
      name: 'Japanese-like',
            prosody: { type: 'japanese-pitch-accent' },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
        },
      },
    });

    const dispose = render(() => (
      <FlashcardWordTitle content={{
        type: 'word',
        front: '赤い',
        reading: 'あかい',
        back: 'red',
        prosody: {
          type: 'japanese-pitch-accent',
          position: 2,
        },
      }} />
    ), container);

    const ruby = container.querySelector('ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.querySelector('rt')?.textContent).toContain('あかい');

    dispose();
  });

  it('keeps stored pitch-accent card readings visible when installed language metadata is stale', () => {
    mockHasProsodyOverlay = false;
    mockLanguageData = makeLanguageData({
      name: 'Stale Japanese metadata',
            settings: { fixed: {} },
    });

    const dispose = render(() => (
      <FlashcardWordTitle content={{
        type: 'word',
        front: '将来',
        reading: 'しょうらい',
        back: 'future',
        prosody: {
          type: 'japanese-pitch-accent',
          position: 1,
        },
      }} />
    ), container);

    const ruby = container.querySelector('ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.querySelector('rt')?.textContent).toContain('しょうらい');
    expect(container.querySelector('.pitch-accent')).not.toBeNull();

    dispose();
  });

  it('does not force IPA as ruby for non-Japanese cards with stale legacy pitch fields', () => {
    mockLanguageData = makeLanguageData({
      name: 'German',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    });

    const dispose = render(() => (
      <FlashcardWordTitle content={{
        type: 'word',
        front: 'Haus',
        reading: 'haʊs',
        back: 'house',
      }} />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('.pitch-accent')).toBeNull();
    expect(container.textContent).toContain('Haus');
    expect(container.textContent).not.toContain('haʊs');

    dispose();
  });

  it('uses the saved card language metadata when active language is different', () => {
    mockHasProsodyOverlay = false;
    mockLanguageData = makeLanguageData({
      name: 'German active language',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    });
    mockLanguageMap = {
      ja: makeLanguageData({
        name: 'Japanese saved card language',
                prosody: { type: 'japanese-pitch-accent' },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
          readingAnnotation: {
            type: 'script-reading',
            annotationScripts: ['Han'],
            surfaceSuffixScripts: ['Hira', 'Kana'],
          },
        },
      }),
    };

    const dispose = render(() => (
      <FlashcardWordTitle
        language="ja"
        content={{
          type: 'word',
          front: '将来',
          reading: 'しょうらい',
          back: 'future',
          prosody: {
            type: 'japanese-pitch-accent',
            position: 1,
          },
        }}
      />
    ), container);

    const ruby = container.querySelector('ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.querySelector('rt')?.textContent).toContain('しょうらい');
    expect(container.querySelector('.pitch-accent')).not.toBeNull();

    dispose();
  });

  it('does not use active Japanese metadata to render German IPA as ruby', () => {
    mockHasProsodyOverlay = true;
    mockLanguageData = makeLanguageData({
      name: 'Japanese active language',
            prosody: { type: 'japanese-pitch-accent' },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
        },
      },
    });
    mockLanguageMap = {
      de: makeLanguageData({
        name: 'German saved card language',
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Latn'] },
          readingAnnotation: { type: 'none' },
        },
      }),
    };

    const dispose = render(() => (
      <FlashcardWordTitle
        language="ja"
        content={{
          type: 'word',
          front: 'Haus',
          reading: 'haʊs',
          back: 'house',
        }}
      />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.textContent).toContain('Haus');
    expect(container.textContent).not.toContain('haʊs');

    dispose();
  });

  it('does not use active language metadata when saved card language metadata is missing', () => {
    mockHasProsodyOverlay = true;
    mockLanguageData = makeLanguageData({
      name: 'Japanese active language',
            prosody: { type: 'japanese-pitch-accent' },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
        },
      },
    });
    mockLanguageMap = {};

    const dispose = render(() => (
      <FlashcardWordTitle
        language="ja"
        content={{
          type: 'word',
          front: 'Haus',
          reading: 'haʊs',
          back: 'house',
        }}
      />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.textContent).toContain('Haus');
    expect(container.textContent).not.toContain('haʊs');

    dispose();
  });

  it('uses the saved card language for cache lookup options instead of the active language', async () => {
    mockHasProsodyOverlay = false;
    mockLanguageData = makeLanguageData({
      name: 'German active language',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    });
    mockLanguageMap = {
      ja: makeLanguageData({
        name: 'Japanese saved card language',
                prosody: { type: 'japanese-pitch-accent' },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
          readingAnnotation: {
            type: 'script-reading',
            annotationScripts: ['Han'],
            surfaceSuffixScripts: ['Hira', 'Kana'],
          },
        },
      }),
    };

    const dispose = render(() => (
      <FlashcardWordTitle
        language="ja"
        content={{
          type: 'word',
          front: '将来',
          reading: 'しょうらい',
          back: 'future',
        }}
      />
    ), container);

    await Promise.resolve();

    expect(mockGetCachedTranslation).toHaveBeenCalled();
    const [, language, options] = mockGetCachedTranslation.mock.calls[0];
    expect(language).toBe('ja');
    expect(options.dictionaryTargetLanguage()).toBe('fr');
    expect(options.getCanonicalForm('将来')).toBe('ja:将来:canonical');
    expect(options.getWordVariants('将来')).toEqual(['ja:将来:variant']);

    dispose();
  });
});
