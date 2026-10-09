// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type LanguageData, type Settings, type Token } from '../../../../shared/types';

const { mockWarmTranslationCache } = vi.hoisted(() => ({ mockWarmTranslationCache: vi.fn() }));

vi.mock('../../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks')>();
  return { ...actual, warmTranslationCache: mockWarmTranslationCache };
});

import { warmReaderPageTranslations } from './ReaderRoute';

const toneLanguage: LanguageData = {
  name: 'Chinese',
  settings: { fixed: {} },
  prosody: {
    type: 'tone',
    coloring: {
      renderer: 'tone-marked-syllables',
      paletteId: 'tones',
      colors: { 'tone-1': '#ff00ff' },
      labels: {},
    },
  },
};

const pitchAccentLanguage: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  prosody: {
    type: 'japanese-pitch-accent',
    coloring: {
      renderer: 'pitch-accent-category',
      paletteId: 'pitch',
      colors: { heiban: '#00b84a' },
      labels: {},
    },
  },
};

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

const pageTokens: Token[] = [
  { word: '猫', surface: '猫', actual_word: '猫', type: '名詞' },
  { word: '犬', surface: '犬', actual_word: '犬', type: '名詞' },
  { word: '猫', surface: '猫', actual_word: '猫', type: '名詞' },
];

describe('warmReaderPageTranslations', () => {
  it('does not warm the translation cache for a tone-marked renderer (no dictionary lookup needed)', () => {
    warmReaderPageTranslations('tone-page', [pageTokens], {
      sourceLanguage: 'ja',
      settings: makeSettings({ coloredProsodyEnabled: true }),
      languageData: toneLanguage,
      tokenizerCapabilities: { providesLemmas: true },
    });

    expect(mockWarmTranslationCache).not.toHaveBeenCalled();
  });

  it('does not warm when colored prosody is disabled', () => {
    warmReaderPageTranslations('disabled-page', [pageTokens], {
      sourceLanguage: 'ja',
      settings: makeSettings({ coloredProsodyEnabled: false }),
      languageData: pitchAccentLanguage,
      tokenizerCapabilities: { providesLemmas: true },
    });

    expect(mockWarmTranslationCache).not.toHaveBeenCalled();
  });

  it('does not warm when relevant-only is on', () => {
    warmReaderPageTranslations('relevant-page', [pageTokens], {
      sourceLanguage: 'ja',
      settings: makeSettings({ coloredProsodyEnabled: true, coloredProsodyRelevantOnly: true }),
      languageData: pitchAccentLanguage,
      tokenizerCapabilities: { providesLemmas: true },
    });

    expect(mockWarmTranslationCache).not.toHaveBeenCalled();
  });

  it('warms the deduplicated page words for a pitch-accent renderer', () => {
    warmReaderPageTranslations('pitch-page', [pageTokens], {
      sourceLanguage: 'ja',
      settings: makeSettings({ coloredProsodyEnabled: true, language: 'ja' }),
      languageData: pitchAccentLanguage,
      dictionaryTargetLanguage: 'en',
      tokenizerCapabilities: { providesLemmas: true },
    });

    expect(mockWarmTranslationCache).toHaveBeenCalledTimes(1);
    expect(mockWarmTranslationCache.mock.calls[0][0]).toEqual(['猫', '犬']);
    expect(mockWarmTranslationCache.mock.calls[0][3]).toBe('ja');
    expect(mockWarmTranslationCache.mock.calls[0][4]).toBe('en');
  });

  it('warms only once per page id', () => {
    warmReaderPageTranslations('once-page', [pageTokens], {
      sourceLanguage: 'ja',
      settings: makeSettings({ coloredProsodyEnabled: true }),
      languageData: pitchAccentLanguage,
      tokenizerCapabilities: { providesLemmas: true },
    });
    warmReaderPageTranslations('once-page', [pageTokens], {
      sourceLanguage: 'ja',
      settings: makeSettings({ coloredProsodyEnabled: true }),
      languageData: pitchAccentLanguage,
      tokenizerCapabilities: { providesLemmas: true },
    });

    expect(mockWarmTranslationCache).toHaveBeenCalledTimes(1);
  });
  it('does not reuse a successful guard across source, target or package revisions', async () => {
    mockWarmTranslationCache.mockResolvedValue(undefined);
    const options = { sourceLanguage: 'ja', sourceKey: 'resource-one', settings: makeSettings({ coloredProsodyEnabled: true }),
      languageData: pitchAccentLanguage, dictionaryTargetLanguage: 'en' };
    warmReaderPageTranslations('scoped-page', [pageTokens], options);
    await Promise.resolve(); await Promise.resolve();
    warmReaderPageTranslations('scoped-page', [pageTokens], options);
    expect(mockWarmTranslationCache).toHaveBeenCalledTimes(1);
    warmReaderPageTranslations('scoped-page', [pageTokens], { ...options, sourceLanguage: 'future-package' });
    warmReaderPageTranslations('scoped-page', [pageTokens], { ...options, dictionaryTargetLanguage: 'fr' });
    warmReaderPageTranslations('scoped-page', [pageTokens], { ...options, languageData: { ...pitchAccentLanguage, resolvedVariantId: 'new-revision' } });
    expect(mockWarmTranslationCache).toHaveBeenCalledTimes(4);
  });

  it('permits a later retry after failed optional warming', async () => {
    mockWarmTranslationCache.mockRejectedValueOnce(new Error('dictionary unavailable')).mockResolvedValue(undefined);
    const options = { sourceLanguage: 'ja', settings: makeSettings({ coloredProsodyEnabled: true }), languageData: pitchAccentLanguage };
    warmReaderPageTranslations('retry-page', [pageTokens], options);
    await vi.waitFor(() => expect(mockWarmTranslationCache).toHaveBeenCalledOnce());
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    warmReaderPageTranslations('retry-page', [pageTokens], options);
    expect(mockWarmTranslationCache).toHaveBeenCalledTimes(2);
  });

});
