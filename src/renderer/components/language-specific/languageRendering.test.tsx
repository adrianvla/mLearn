// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { LanguageData } from '../../../shared/types';
import { JapanesePitchAccentOverlay } from './JapanesePitchAccentOverlay';
import { ProsodyOverlay } from './ProsodyOverlay';
import { WordWithReading } from './WordWithReading';

let mockActiveLanguageData: LanguageData | null = null;
let mockLanguageMap: Record<string, LanguageData> = {};
const mockGetCachedTranslation = vi.fn();
let getMockCacheVersion = () => 0;
const mockGetCanonicalFormForLanguage = vi.fn((language: string, word: string) => `${language}:${word}:canonical`);
const mockGetWordVariantsForLanguage = vi.fn((language: string, word: string) => [`${language}:${word}:variant`]);

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: {
      language: 'de',
      dictionaryTargetLanguages: { ja: 'fr' },
      showProsody: true,
    },
  }),
  useLanguage: () => ({
    langData: mockLanguageMap,
    currentLangData: () => mockActiveLanguageData,
    getCanonicalFormForLanguage: mockGetCanonicalFormForLanguage,
    getWordVariantsForLanguage: mockGetWordVariantsForLanguage,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => getMockCacheVersion(),
  getCachedTranslation: (...args: unknown[]) => mockGetCachedTranslation(...args),
}));

function makeLanguageData(overrides: Partial<LanguageData>): LanguageData {
  return {
    name: 'Test language',
    settings: { fixed: {} },
    ...overrides,
  };
}

describe('language-specific rendering metadata resolution', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockActiveLanguageData = makeLanguageData({
      name: 'German active language',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
      prosody: { type: 'none' },
    });
    mockLanguageMap = {
      de: mockActiveLanguageData,
      ja: makeLanguageData({
        name: 'Japanese saved-card language',
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
    mockGetCachedTranslation.mockReset();
    mockGetCanonicalFormForLanguage.mockClear();
    mockGetWordVariantsForLanguage.mockClear();
  });

  afterEach(() => {
    container.remove();
  });

  it('uses the supplied language code metadata for cache-driven pitch lookup', async () => {
    mockGetCachedTranslation.mockReturnValue({
      data: [null, null, { reading: 'しょうらい', pitches: [{ position: 1 }] }],
    });

    const dispose = render(() => (
      <JapanesePitchAccentOverlay
        word="将来"
        language="ja"
        mode="pill"
      />
    ), container);

    await Promise.resolve();

    expect(mockGetCachedTranslation).toHaveBeenCalled();
    const [, language, options] = mockGetCachedTranslation.mock.calls[0];
    expect(language).toBe('ja');
    expect(options.dictionaryTargetLanguage()).toBe('fr');
    expect(options.getCanonicalForm('将来')).toBe('ja:将来:canonical');
    expect(options.getWordVariants('将来')).toEqual(['ja:将来:variant']);
    expect(container.querySelector('.pitch-accent')).not.toBeNull();

    dispose();
  });

  it('reads cache-driven pitch from structured dictionary payload slots', async () => {
    mockGetCachedTranslation.mockReturnValue({
      data: [
        { definitions: ['future'], reading: 'しょうらい' },
        { reading: 'しょうらい', pitches: [{ position: 1 }] },
        [],
      ],
    });

    const dispose = render(() => (
      <JapanesePitchAccentOverlay
        word="将来"
        language="ja"
        mode="pill"
      />
    ), container);

    await Promise.resolve();

    expect(container.querySelector('.pitch-accent')).not.toBeNull();

    dispose();
  });

  it('renders cache-driven pitch when the translation arrives after mount', async () => {
    mockGetCachedTranslation.mockReturnValue(null);
    let updateCacheVersion = () => {};

    const CacheUpdatingOverlay = () => {
      const [cacheVersion, setCacheVersion] = createSignal(0);
      getMockCacheVersion = cacheVersion;
      updateCacheVersion = () => setCacheVersion((version) => version + 1);

      return (
        <JapanesePitchAccentOverlay
          word="将来"
          language="ja"
          mode="overlay"
        >
          しょうらい
        </JapanesePitchAccentOverlay>
      );
    };

    const dispose = render(() => (
      <CacheUpdatingOverlay />
    ), container);

    expect(container.querySelector('.pitch-accent')).toBeNull();

    mockGetCachedTranslation.mockReturnValue({
      data: [null, null, { reading: 'しょうらい', pitches: [{ position: 1 }] }],
    });
    updateCacheVersion();
    await Promise.resolve();

    expect(container.querySelector('.pitch-accent')).not.toBeNull();

    dispose();
  });

  it('does not use active language reading metadata when a different language code is supplied', () => {
    mockActiveLanguageData = makeLanguageData({
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
        name: 'German saved-card language',
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Latn'] },
          readingAnnotation: { type: 'none' },
        },
      }),
    };

    const dispose = render(() => (
      <WordWithReading
        word="Haus"
        reading="haʊs"
        language="de"
      />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.textContent).toContain('Haus');
    expect(container.textContent).not.toContain('haʊs');

    dispose();
  });

  it('uses supplied language metadata for text direction', () => {
    mockLanguageMap = {
      ar: makeLanguageData({
        name: 'Arabic saved-card language',
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Arab'] },
          readingAnnotation: { type: 'none' },
        },
      }),
    };

    const dispose = render(() => (
      <WordWithReading
        word="بيت"
        language="ar"
      />
    ), container);

    const word = container.querySelector('span') as HTMLElement | null;
    expect(word?.style.getPropertyValue('direction')).toBe('rtl');
    expect(word?.style.getPropertyValue('unicode-bidi')).toBe('isolate');

    dispose();
  });

  it('can render metadata-selected inline reading annotations without ruby markup', () => {
    mockLanguageMap = {
      ar: makeLanguageData({
        name: 'Arabic saved-card language',
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Arab'] },
          readingAnnotation: {
            type: 'script-reading',
            display: 'inline',
            annotationScripts: ['Arab'],
          },
        },
      }),
    };

    const dispose = render(() => (
      <WordWithReading
        word="بيت"
        reading="bayt"
        language="ar"
      />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('.ruby-text-inline')).not.toBeNull();
    expect(container.textContent).toContain('بيت');
    expect(container.textContent).toContain('bayt');

    dispose();
  });

  it('marks reading annotation slots as reading-script text for generic renderers', () => {
    const seenSlots: Array<{ slot: string; isReadingScript: boolean; text: string }> = [];
    mockLanguageMap = {
      zh: makeLanguageData({
        name: 'Chinese saved-card language',
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Han'] },
          readingAnnotation: {
            type: 'script-reading',
            annotationScripts: ['Han'],
          },
        },
      }),
    };

    const dispose = render(() => (
      <WordWithReading
        word="你好"
        reading="ni hao"
        language="zh"
        renderText={(text, options) => {
          seenSlots.push({
            slot: options.slot,
            isReadingScript: options.isReadingScript,
            text: String(text),
          });
          return <span class={options.class}>{text}</span>;
        }}
      />
    ), container);

    expect(seenSlots).toEqual([
      { slot: 'reading', isReadingScript: true, text: 'ni hao' },
    ]);

    dispose();
  });

  it('marks inline reading annotation slots as reading-script text for generic renderers', () => {
    const seenSlots: Array<{ slot: string; isReadingScript: boolean; text: string }> = [];
    mockLanguageMap = {
      ar: makeLanguageData({
        name: 'Arabic saved-card language',
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Arab'] },
          readingAnnotation: {
            type: 'script-reading',
            display: 'inline',
            annotationScripts: ['Arab'],
          },
        },
      }),
    };

    const dispose = render(() => (
      <WordWithReading
        word="بيت"
        reading="bayt"
        language="ar"
        renderText={(text, options) => {
          seenSlots.push({
            slot: options.slot,
            isReadingScript: options.isReadingScript,
            text: String(text),
          });
          return <span class={options.class}>{text}</span>;
        }}
      />
    ), container);

    expect(seenSlots).toEqual([
      { slot: 'word', isReadingScript: false, text: 'بيت' },
      { slot: 'reading', isReadingScript: true, text: 'bayt' },
    ]);

    dispose();
  });

  it('uses active language metadata when a supplied language code matches the active language and langData is not populated', () => {
    mockActiveLanguageData = makeLanguageData({
      name: 'German active language',
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
      <WordWithReading
        word="赤い"
        reading="あかい"
        language="de"
      />
    ), container);

    expect(container.querySelector('ruby')).not.toBeNull();
    expect(container.textContent).toContain('赤い');
    expect(container.textContent).toContain('あかい');

    dispose();
  });

  it('replaces a surface form with a same-script pronunciation when metadata requests replacement display', () => {
    mockActiveLanguageData = makeLanguageData({
      name: 'Russian',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Cyrl'] },
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Cyrl'],
          readingScripts: ['Cyrl'],
        },
        readingAnnotation: {
          type: 'script-reading',
          display: 'replace',
          annotationScripts: ['Cyrl'],
        },
      },
    });

    const dispose = render(() => (
      <WordWithReading
        word="замок"
        reading="за́мок"
        language="ru"
        languageData={mockActiveLanguageData}
      />
    ), container);

    expect(container.querySelector('ruby')).toBeNull();
    expect(container.textContent).toBe('за́мок');
    expect(container.textContent).not.toContain('замок');

    dispose();
  });

  it('uses active language metadata for explicit-position prosody when the supplied language matches the active language', () => {
    mockActiveLanguageData = makeLanguageData({
      name: 'Japanese active language',
      textProcessing: { scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] } },
      prosody: { type: 'japanese-pitch-accent' },
    });
    mockLanguageMap = {};

    const dispose = render(() => (
      <JapanesePitchAccentOverlay
        word="赤い"
        reading="あかい"
        language="de"
        pitchPosition={1}
        mode="pill"
      />
    ), container);

    expect(container.querySelector('.pitch-accent')).not.toBeNull();
    expect(container.textContent).toContain('あかい');

    dispose();
  });

  it('routes Japanese pitch accent through the generic prosody overlay', () => {
    const dispose = render(() => (
      <ProsodyOverlay
        word="赤い"
        reading="あかい"
        prosodyPosition={1}
        prosodyType="japanese-pitch-accent"
        languageData={mockLanguageMap.ja}
        mode="pill"
      />
    ), container);

    expect(container.querySelector('.pitch-accent')).not.toBeNull();
    expect(container.textContent).toContain('あかい');

    dispose();
  });

  it('does not render Japanese pitch UI for unknown future prosody models', () => {
    const dispose = render(() => (
      <ProsodyOverlay
        word="ma"
        reading="ma"
        prosodyPosition={1}
        prosodyType="tone-contour"
        languageData={makeLanguageData({ prosody: { type: 'tone-contour' } })}
        mode="overlay"
      >
        ma
      </ProsodyOverlay>
    ), container);

    expect(container.textContent).toContain('ma');
    expect(container.querySelector('.pitch-accent')).toBeNull();

    dispose();
  });
});
